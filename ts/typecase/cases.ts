/* Copyright (c) 2026 Richard Rodger, MIT License */

// WHAT THE PUBLISHED PROP TYPES ACCEPT, AND WHAT THEY REFUSE.
//
// Read and run by ts/test/cmp-props.test.ts, which compiles this project
// and holds the result to the markers below. A line tagged `ERR: <text>`
// must produce a compiler error whose message contains <text>; every
// other line must produce none. So the errors here are the assertions,
// not a mistake -- a props type that refuses nothing is a props type
// nobody needs, and the only way to test a refusal is to write the call
// that earns it.
//
// The import is `'../'`, which resolves through package.json to
// `dist/jostraca.d.ts`: these cases are checked against the declarations
// a consumer installs, not against the source they were emitted from.
//
// ONE CASE PER LINE. The suite maps a marker to a diagnostic by line
// number, so a call wrapped across two lines reports against the wrong
// one.
//
// A MARKER NAMES WHAT THE MESSAGE MUST SAY, which for a misspelling is
// the prop and for a mismatch is the types: TypeScript reports a wrong
// VALUE without naming the key it was under, so `ERR: mode` would pass
// on any wrong type anywhere in the call.

import {
  Project, Folder, File, Content, Line, Slot, Inject, Fragment, CopyFiles,
  ListItems, cmp,
} from '../'


// `ListItems` takes a string CHILD and has no positional form, which is
// the distinction the last line of `positional` holds: two components
// read `arg`, three take literal text as a child, and the two sets are
// not the same set.

// An ordinary tree, written the way the reference documents it.
export const ordinary = () => {
  Project({ folder: 'app' }, () => File({ name: 'a.txt' }, () => Content('x')))
  Folder({ name: 'src' }, () => File({ name: 'a.txt' }))
  Folder(() => File({ name: 'a.txt' }))
  File({ name: 'run.sh', mode: 0o755, exclude: ['a.txt', /\.min\./] })
  File({ name: 'a.txt', exclude: true }, () => Line({ src: 'x', indent: 2 }))
  Inject({ name: 'a.txt', markers: ['/*S*/', '/*E*/'] }, () => Content('x'))
  Fragment({ from: '/f.txt', indent: 2 }, () => Slot({ name: 's' }))
  CopyFiles({ from: '/src', to: 'lib', exclude: /\.map$/ })
  ListItems({ item: [{ n: 1 }], indent: 2 }, ({ item, indent, replace }) => Line({ src: '{item.n}' + item.n, indent, replace }))
  ListItems({ item: [{ n: 1 }], line: false }, 'n={item.n}\n')
}


// The positional form, where a component has one.
export const positional = () => {
  Content('text')
  Line('text')
  Content({ indent: 2 }, 'text')
  File('text') // ERR: FileProps
  Folder(2) // ERR: FolderProps
  ListItems('n={item.n}\n') // ERR: ListItemsProps
}


// Required is required.
export const required = () => {
  File({}) // ERR: name
  Fragment({}) // ERR: from
  CopyFiles({}) // ERR: from
  Inject({}) // ERR: name
}


// A misspelling is a misspelling, whether or not the runtime would have
// dropped it. Eight of the ten components accept an unknown prop and
// drop it; none of the ten accepts one from a caller who compiles.
export const misspelled = () => {
  File({ name: 'a.txt', nosuchprop: 1 }) // ERR: nosuchprop
  Content({ scr: 'x' }) // ERR: scr
  Project({ folder: 'app', naem: 'p' }) // ERR: naem
  ListItems({ items: [1] }) // ERR: items
}


// And a wrong type is a wrong type.
export const wrongtype = () => {
  File({ name: 'a.txt', mode: '755' }) // ERR: 'string' is not assignable to type 'number'
  Content({ src: 'x', raw: 'yes' }) // ERR: 'string' is not assignable to type 'boolean
  Inject({ name: 'a.txt', markers: ['S'] }) // ERR: Source has 1 element(s) but target requires 2
  Folder({ name: 2 }) // ERR: 'number' is not assignable to type 'string'
}


// `ctx$` is the ambient context cmp() writes in, and no props type
// carries it: a caller who passes one is a caller who has misread the
// component.
export const ambient = () => {
  File({ name: 'a.txt', ctx$: {} as any }) // ERR: ctx$
}


// `exclude` on a Fragment was declared, validated, and read by nothing
// on either side. It is gone rather than left as the one declaration
// that means nothing.
export const removed = () => {
  Fragment({ from: '/f.txt' })
  Fragment({ from: '/f.txt', exclude: true }) // ERR: exclude
}


// A component of the caller's own still declares what it likes -- or
// declares nothing, exactly as before there were types to declare.
export const custom = () => {
  const Banner = cmp<{ text: string }>((props) => Content('// ' + props.text + '\n'))
  Banner({ text: 'x' })
  Banner({ txet: 'x' }) // ERR: txet
  const Loose = cmp(function Loose(props: any) { Content(props.anything) })
  Loose({ anything: 1 })
}
