# Shared spec corpus

Language-neutral test cases that **both** implementations must satisfy:
`ts/test/spec.test.ts` and `go/spec_test.go` read these same files and
assert the same expectations. A behaviour that only one stack gets right
fails here, which is the point — this is where TS↔Go parity is pinned for
the pure helpers.

This is distinct from `go/testdata/parity`, which is *generated* from a TS
run and covers whole-generation scenarios. The corpus here is committed,
hand-editable, and covers individual functions.

## Format

Tab-separated, one case per line, with a header row. Lines that are blank
or start with `#` are ignored.

| Column   | Meaning |
|----------|---------|
| `id`     | Unique case name within the file. Appears in failure output. |
| `fn`     | Which function to call. Must be in both runners' dispatch tables. |
| `args`   | JSON array of arguments. Arity is significant. |
| `expect` | JSON value the call must return. `-` when `error` is set. |
| `error`  | Substring the failure message must contain. Empty for cases that must succeed. |

Values are JSON so that quoting, escaping, nesting and type are all
unambiguous, and so a literal tab or newline inside a string can never
break the TSV — JSON encodes those as `\t` and `\n`.

Example:

```
id	fn	args	expect	error
camelify-snake	camelify	["foo_bar"]	"FooBar"
deep-nested	deep	[{"a":{"x":1}},{"a":{"y":2}}]	{"a":{"x":1,"y":2}}
template-empty-re	template	["aQb",{},{"replace":{"/Q*/":"Z"}}]	-	empty
```

## Conventions

Three rules make a single expectation work in two languages:

- **`null` covers both misses.** TS returns `undefined` for a lookup miss
  and Go returns `nil`; both normalise to JSON `null`. There is no way to
  write "undefined but not null" in the corpus, and no case needs one.

- **Results are compared as canonical JSON**, with object keys sorted.
  Go's `json.Marshal` sorts map keys and a Go map has no insertion order
  to preserve, so the TS runner sorts to match. HTML escaping is disabled
  on the Go side so `<`, `>` and `&` survive as themselves.

- **Key order is asserted as data, not as object layout.** Where order is
  the property under test, the expectation is an ordered array of
  `[key, value]` pairs rather than an object — see the `omap` cases. This
  is the only form that can express ordering to both stacks.

Error messages are worded differently by the two implementations, so
`error` holds a short portable fragment both must contain, not a full
message.

## The `isbincontent` 8 KB bound

The corpus hands TS a string where it hands Go bytes, so `isbincontent`
cases only mean anything if both bound the scan the same way. They now do:
TS's string branch, TS's Buffer branch and Go's `IsBinContent` all stop
after 8 KB, and all three agree on the exact boundary --  a NUL at index
8191 is binary, at 8192 it is not.

That was not always true. TS's string branch used to scan the whole value,
so identical content classified differently depending on whether the caller
had decoded it yet. Three cases pin the boundary now
(`isbincontent-nul-at-limit-1`, `-at-limit`, `-past-limit`), which is what
stops it drifting apart again.

One asymmetry remains by nature: the string bound counts UTF-16 units and
the Buffer/Go bound counts bytes. They coincide for ASCII, so keep boundary
cases ASCII — anything non-ASCII near 8 KB is measuring the difference
between the two units, not the behaviour.

## Adding cases

Append a row. Both runners pick it up with no code change, provided `fn`
is already dispatched.

Adding a *function* means adding an adapter to both runners. Each runner
fails on an unknown `fn` rather than skipping it, so a corpus entry can
never be silently ignored by one stack — that failure mode would defeat
the whole exercise.

Expectations were originally derived from the canonical TS build, then
confirmed against Go. When the two disagree, TS wins and Go is fixed
(see the repo `CLAUDE.md`); when TS itself is wrong, fix TS and update the
row in the same change.
