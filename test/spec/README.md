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

## Known limit: `isbincontent` cases must stay under 8 KB

TS `isbincontent` takes a string *or* a Buffer and those two paths differ:
the Buffer path stops after the first 8 KB, the string path scans the whole
value. Go's `IsBinContent` takes bytes and always stops at 8 KB.

The corpus hands TS a string and Go bytes, so a case whose first NUL sits
past 8 KB would compare TS's uncapped string path against Go's capped one
and report a divergence that is really an artefact of the corpus choosing
different paths. Verified: a NUL at offset 9000 is `true` for a TS string,
`false` for a TS Buffer, `false` for Go.

Keep such cases short and the two agree. The underlying inconsistency --
one TS function with a cap on one path and not the other -- is a separate
question from parity and is not settled here.

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
