.PHONY: all build test clean build-ts build-go test-ts test-go clean-ts clean-go publish-go tags-go reset

all: build test

build: build-ts build-go

test: test-ts test-go

clean: clean-ts clean-go

# TypeScript (canonical implementation, lives in ts/)
build-ts:
	cd ts && npm run build

test-ts:
	cd ts && npm test

clean-ts:
	cd ts && rm -rf dist dist-test

# Go
build-go:
	cd go/jostraca && go build ./...

test-go:
	cd go/jostraca && go test -v ./...

clean-go:
	cd go/jostraca && go clean

# Publish Go module: make publish-go V=0.1.7
publish-go: test-go
	@test -n "$(V)" || (echo "Usage: make publish-go V=x.y.z" && exit 1)
	git tag go/v$(V)
	git push origin master go/v$(V)
	if command -v gh >/dev/null 2>&1; then gh release create go/v$(V) --title "go/v$(V)" --notes "Go module release v$(V)"; fi

tags-go:
	git tag -l 'go/v*' --sort=-version:refname

reset:
	cd ts && npm run reset
	cd go/jostraca && go clean -cache
	cd go/jostraca && go build ./...
	cd go/jostraca && go test -v ./...
