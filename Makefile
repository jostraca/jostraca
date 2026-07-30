.PHONY: all build test clean build-ts build-go test-ts test-go clean-ts clean-go publish publish-ts publish-go tags-go reset coverage coverage-ts coverage-go mutation fuzz perf perf-baseline perf-run

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

# Release BOTH stacks with one command (Linux + macOS).
#   make publish                 # patch-bump and publish TS then Go
#   make publish BUMP=minor      # TS bump level (patch|minor|major); default patch
#   make publish V=0.2.0         # explicit Go version (else Go patch-bumps)
#
# TS is published to the npm STAGING area first (not live until you approve
# it with 2FA), so if the Go release fails you can reject the stage and
# nothing has shipped. Go, by contrast, goes live the moment its tag pushes
# -- which is why TS (staged, reversible) runs first.
publish: publish-ts publish-go
	@echo ""
	@echo "Done. Go is LIVE. TS is STAGED -- approve it to publish:"
	@echo "  cd ts && npm run repo-stage-list                    # find the stage-id"
	@echo "  cd ts && npm run repo-stage-approve -- <stage-id>   # 2FA / proof-of-presence"

# TS (npm): clean, install, build, test, patch-bump, tag, stage-publish with
# the vault token. BUMP overrides the version level (default: patch).
publish-ts:
	cd ts && npm_config_bump="$(BUMP)" npm run repo-publish

# Publish Go module. Default: patch-bump the Version const in go/jostraca.go.
# Override with an explicit version: make publish-go V=0.2.0
# Portable in-place edit (temp file + mv) works on both GNU and BSD sed.
publish-go: test-go
	@set -e; \
	V="$(V)"; \
	CUR=`sed -n 's/^const Version = "\(.*\)"/\1/p' go/jostraca.go`; \
	if [ -z "$$V" ]; then \
	  V=`echo "$$CUR" | awk -F. '{printf "%d.%d.%d", $$1, $$2, $$3+1}'`; \
	fi; \
	echo "go: releasing v$$V (was $$CUR)"; \
	sed "s/^const Version = \".*\"/const Version = \"$$V\"/" go/jostraca.go > go/jostraca.go.tmp && mv go/jostraca.go.tmp go/jostraca.go; \
	git add go/jostraca.go; \
	git commit -m "go: v$$V"; \
	git tag "go/v$$V"; \
	git push origin master "go/v$$V"; \
	if command -v gh >/dev/null 2>&1; then gh release create "go/v$$V" --title "go/v$$V" --notes "Go module release v$$V"; fi

tags-go:
	git tag -l 'go/v*' --sort=-version:refname

reset:
	cd ts && npm run reset
	cd go && go clean -cache
	cd go && go build ./...
	cd go && go test -v ./...
