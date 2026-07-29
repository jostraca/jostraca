#!/bin/sh
# Gate: diff.go must stay at 100% statement coverage.
#
# The diff engine is the one piece that must be byte-identical to the TS
# original. A branch covered on one side and not the other is exactly how
# the two implementations drifted apart before, so "mostly covered" is not
# good enough here.
set -e

profile="$(mktemp)"
trap 'rm -f "$profile"' EXIT

go test ./... -coverprofile="$profile" -count=1 >/dev/null

fail=0
go tool cover -func="$profile" | grep '/diff\.go:' | while read -r loc fn pct; do
  case "$pct" in
    100.0%) ;;
    *) echo "diff.go: $fn is at $pct, must be 100.0%"; fail=1 ;;
  esac
  [ "$fail" = 0 ] || exit 1
done

echo "diff.go coverage: 100% of statements"
