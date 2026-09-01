.PHONY: all build test clean build-ts build-go test-ts test-go clean-ts clean-go publish publish-ts publish-go tags tags-ts tags-go reset coverage coverage-ts coverage-go mutation fuzz perf perf-baseline perf-run

all: build test

build: build-ts build-go

test: test-ts test-go

clean: clean-ts clean-go

# TypeScript (canonical implementation, lives in ts/)
build-ts:
	cd ts && npm run build

test-ts:
	cd ts && npm test

# The diff/merge engine must stay at 100% coverage in both stacks; it is
# the one piece that has to be byte-identical across them.
coverage: coverage-ts coverage-go

coverage-ts:
	cd ts && npm run test-diff-coverage

coverage-go:
	cd go && ./check_diff_coverage.sh

# Coverage says the corpus reached every line. Mutation says it would
# notice if a line changed meaning — including which lines that look like
# decisions genuinely are not.
mutation:
	cd ts && npm run test-diff-mutation

# Performance baselines over the shared workloads in
# test/spec/perf/workloads.tsv. Both stacks run the same list; results are
# compared as a ratio against an in-process calibration loop, so a
# baseline recorded on one machine still means something on another.
#
# Deliberately not part of `make test`: it takes ~40s and wall-clock
# numbers do not belong in a correctness gate.
perf: perf-run
	node tools/perf-check.js

# Re-record the baseline. Do this on purpose, in its own commit, with the
# reason in the message -- a baseline quietly rewritten alongside a change
# cannot show whether that change cost anything.
perf-baseline: perf-run
	node tools/perf-check.js --write

# Stale results are deleted first, not overwritten: if a harness fails to
# run, perf-check must error on the missing file rather than silently
# compare last time's numbers.
#
# -count=1 defeats Go's test cache. Without it a repeat run is reported as
# cached, the test body never executes, and latest-go.tsv keeps whatever
# it had.
perf-run:
	rm -f test/spec/perf/latest-ts.tsv test/spec/perf/latest-go.tsv
	cd ts && npm run build
	cd ts && node tools/bench.js
	cd go && JOSTRACA_PERF=1 go test -count=1 -run TestPerfBaseline -v ./...

# Fuzz the engines that take arbitrary user text. Seeds live in
# go/testdata/fuzz and run as ordinary tests; this is the real thing.
# make fuzz FUZZTIME=5m for a longer soak.
FUZZTIME ?= 30s
fuzz:
	cd go && for t in FuzzMerge FuzzDiff FuzzLines FuzzLCS FuzzTemplate; do \
	  echo "== $$t"; \
	  go test -run "$$t" -fuzz "^$$t$$" -fuzztime $(FUZZTIME) ./... || exit 1; \
	done

clean-ts:
	cd ts && rm -rf dist dist-test

# Go
build-go:
	cd go && go build ./...

test-go:
	cd go && go test -v ./...

clean-go:
	cd go && go clean

# Release
#
# The two stacks tag in separate namespaces -- `v$(V)` is the npm/TS release,
# `go/v$(V)` is what the Go module proxy serves -- so one version number can
# carry both without the tags colliding.
#
#   make publish               both stacks, patch bump from the current version
#   make publish    V=0.33.0   both stacks, explicit version
#   make publish-ts            npm only, patch bump
#   make publish-go            Go module only, patch bump
#
# publish-ts/publish-go exist for when the streams have to move apart (a
# port-only fix, an npm-only republish). Reach for plain `publish` otherwise:
# TS is canonical and Go is kept at parity, so a shared version number is the
# honest description of a release that changed both.
#
# Neither stack is published from here any more. npm is published by the
# `.github/workflows/publish.yml` workflow, which fires on the `v$(V)` tag
# and authenticates to the registry over OIDC (npm trusted publishing) -- there
# is no npm token on this machine to leak. The Go module has always published
# by tag alone, via the module proxy.
#
# So the push IS the release, for both stacks, and it has to land last. That
# inverts the old ordering guarantee: an irreversible step can no longer be
# held back until everything local has succeeded. What is left is that
# everything which can fail cheaply -- version check, build, test, bump,
# commit, tag -- still runs before the push, and a failed npm workflow has
# published nothing, so the recovery is to fix the tree, delete the tag on both
# ends, and cut it again.

# A release is a patch bump unless told otherwise, so the ordinary case is a
# bare `make publish`. An explicit V=x.y.z still wins: a command-line variable
# overrides everything, which is also why the default is guarded on `origin`
# rather than `?=` -- `make publish V=` must stay an error for check-version to
# catch, not silently become a patch bump.
#
# A joint release numbers itself from package.json because TS is canonical.
# publish-go on its own reads go/jostraca.go instead: the single-stack targets
# exist precisely so the two streams can drift apart, and each should bump from
# where it actually is rather than from where the other one got to.
#
# Both are computed only for the targets that need them. Otherwise every
# `make test` would pay a node startup to answer a question it never asks.
next-patch = $(shell echo $(1) | awk -F. '{printf "%d.%d.%d", $$1, $$2, $$3+1}')
ts-version = $(shell node -p "require('./ts/package.json').version")
go-version = $(shell sed -n 's/^const Version = "\(.*\)"/\1/p' go/jostraca.go)

ifeq ($(origin V),undefined)
ifneq (,$(filter publish publish-ts,$(MAKECMDGOALS)))
V := $(call next-patch,$(ts-version))
else ifneq (,$(filter publish-go,$(MAKECMDGOALS)))
V := $(call next-patch,$(go-version))
endif
endif

# dist/ and dist-test/ are committed, so the release commit carries the build
# that was just tested rather than leaving the tag pointing at stale output.
TS_RELEASE_FILES = ts/package.json ts/dist ts/dist-test

# sed against a hand-written const is fragile by nature: if the declaration in
# jostraca.go is ever reformatted the substitution silently does nothing and
# the tag ships the previous version. Check the result rather than trust it.
#
# Write to a temp file and mv, rather than `sed -i`. In-place editing is the
# one sed flag whose spelling is NOT portable: BSD/macOS sed requires a suffix
# argument (`-i ''`), while GNU sed takes the suffix ATTACHED (`-i.bak`) and
# so reads a following `''` as the script -- pushing the real script along to
# be read as a filename. This macro used to carry the BSD spelling, which made
# `make publish` macOS-only: on Linux it failed with
# `sed: can't read s/^const Version...`, after bump-ts had already rewritten
# ts/package.json, leaving a half-applied bump in the tree. The grep below did
# its job and caught it, which is why this surfaced as a failure rather than a
# release tagged at the previous version.
#
# The `&&` matters: if sed fails, the mv does not run and jostraca.go is left
# untouched.
define bump-go
	sed 's/^const Version = ".*"/const Version = "$(V)"/' go/jostraca.go \
	  > go/jostraca.go.tmp && mv go/jostraca.go.tmp go/jostraca.go
	@grep -q '^const Version = "$(V)"$$' go/jostraca.go \
	  || (echo "go/jostraca.go: version bump to $(V) failed" && exit 1)
endef

# --no-git-tag-version: npm must not commit or tag, the Makefile owns that.
define bump-ts
	cd ts && npm version $(V) --no-git-tag-version --allow-same-version
endef

publish: check-version build test
	$(bump-ts)
	$(bump-go)
	git add $(TS_RELEASE_FILES) go/jostraca.go
	git commit -m "release v$(V)"
	git tag v$(V)
	git tag go/v$(V)
	git push origin master v$(V) go/v$(V)
	if command -v gh >/dev/null 2>&1; then gh release create go/v$(V) --title "go/v$(V)" --notes "Go module release v$(V)"; fi

publish-ts: check-version build-ts test-ts
	$(bump-ts)
	git add $(TS_RELEASE_FILES)
	git commit -m "ts: v$(V)"
	git tag v$(V)
	git push origin master v$(V)

publish-go: check-version test-go
	$(bump-go)
	git add go/jostraca.go
	git commit -m "go: v$(V)"
	git tag go/v$(V)
	git push origin master go/v$(V)
	if command -v gh >/dev/null 2>&1; then gh release create go/v$(V) --title "go/v$(V)" --notes "Go module release v$(V)"; fi

# A malformed V would otherwise reach the registry and the tag namespace
# before anything complained.
check-version:
	@test -n "$(V)" || (echo "Usage: make $(MAKECMDGOALS) V=x.y.z" && exit 1)
	@echo "$(V)" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)*$$' \
	  || (echo "V=$(V) is not a x.y.z version" && exit 1)

tags: tags-ts tags-go

tags-ts:
	git tag -l 'v*' --sort=-version:refname

tags-go:
	git tag -l 'go/v*' --sort=-version:refname

reset:
	cd ts && npm run reset
	cd go && go clean -cache
	cd go && go build ./...
	cd go && go test -v ./...
