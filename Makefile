.PHONY: all build test clean build-ts build-go test-ts test-go clean-ts clean-go publish-go tags-go reset coverage coverage-ts coverage-go mutation fuzz perf perf-baseline perf-run

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

# Publish Go module: make publish-go V=0.1.7
publish-go: test-go
	@test -n "$(V)" || (echo "Usage: make publish-go V=x.y.z" && exit 1)
	sed -i '' 's/^const Version = ".*"/const Version = "$(V)"/' go/jostraca.go
	git add go/jostraca.go
	git commit -m "go: v$(V)"
	git tag go/v$(V)
	git push origin master go/v$(V)
	if command -v gh >/dev/null 2>&1; then gh release create go/v$(V) --title "go/v$(V)" --notes "Go module release v$(V)"; fi

tags-go:
	git tag -l 'go/v*' --sort=-version:refname

reset:
	cd ts && npm run reset
	cd go && go clean -cache
	cd go && go build ./...
	cd go && go test -v ./...
