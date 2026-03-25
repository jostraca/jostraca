# jostraca-go

This folder contains a Go implementation of Jostraca's template utility.

## Dependency

The Go port is configured to use Shape from the `go/v0.1.0` release:

- `github.com/rjrodger/shape/go`
- commit: `871b412` (release tag `go/v0.1.0`)

## Usage

```go
out, err := jostraca.Template("Hello $$user.name$$", map[string]any{
  "user": map[string]any{"name": "Go"},
}, nil)
```
