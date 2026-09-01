/* Copyright (c) 2024-2025 Richard Rodger, MIT License */


// The filesystem contract jostraca actually uses.
//
// Deliberately narrower than `typeof import('node:fs')`, which is what this
// was until the `memfs` package was replaced by src/util/memfs.ts. That
// declaration promised the whole Node API while the code only ever called
// what is listed here, so a provider had to implement far more than jostraca
// needed -- and `res.fs()` advertised methods an in-repo filesystem has no
// reason to carry.
//
// Real `node:fs` satisfies this structurally, so passing it, or any broader
// handle, still works.
type FST = {
  // Required. `existsSync` is the one asserted at runtime, by
  // BuildContext and FileHandler, as the provider-validity check.
  existsSync(path: string): boolean
  readFileSync(path: string, options?: any): any
  writeFileSync(path: string, data: any, options?: any): void
  mkdirSync(path: string, options?: any): any
  statSync(path: string, options?: any): any
  readdirSync(path: string, options?: any): any

  // Feature-detected: each call site tests `typeof` first and has a
  // fallback, so a provider may omit any of these.
  //   renameSync   -- FileHandler falls back to a direct write
  //   chmodSync    -- modes are left at their default
  //   unlinkSync   -- temp files are not cleaned up
  //   realpathSync -- CopyOp falls back to identity, losing cycle detection
  renameSync?: (from: string, to: string) => void
  chmodSync?: (path: string, mode: any) => void
  unlinkSync?: (path: string) => void
  realpathSync?: (path: string) => any
}

/*
// For calling code.
type JostracaOptions = {
  folder?: string // Base output folder for generated files. Default: `.`.
  meta?: any // Provide meta data to the generation process. Default: `{}`
  fs?: any // File system API (used for testing). Default: `node:fs`.
  log?: Log // Logging interface.
  debug?: boolean // Generate additional debugging information.

  // TOOD: needs rethink
  exclude?: boolean // Exclude modified output files. Default: `false`.

  model?: any
  build?: boolean
  mem?: boolean
  vol?: any

  run?: {
    dry?: boolean
  }

  // Component specific options.
  cmp?: {
    Copy?: {
      ignore?: RegExp[]
    }
  }
}
*/


// For calling code.
type JostracaResult = {
  when: number,
  files: {
    preserved: string[],
    written: string[],
    presented: string[],
    diffed: string[],
    merged: string[],
    conflicted: string[],
    unchanged: string[],
  }
  audit: () => Audit[]

  vol?: () => any
  fs?: () => FST
}


type Node = {
  kind: string
  meta: any
  content: any[]

  children?: Node[]
  name?: string
  path: string[]
  from?: string
  folder?: string
  after?: any
  exclude?: boolean | string | (string | RegExp)[]

  // POSIX permission bits for the generated file, e.g. 0o755 to make a
  // script executable. Unset leaves the platform default (or, when the
  // file already exists, its current mode).
  mode?: number
  indent?: string
  filter?: (props: any, children: any, component: any) => boolean
  fullpath?: string
  replace?: Record<string, any>
}


type OpStep = (node: Node, ctx$: any, buildctx: any) => Promise<any> | void

type OpDef = {
  before: OpStep,
  after: OpStep,
}


type Component = (props: any, children?: any) => void


type Log = {
  trace: (...args: any[]) => any
  debug: (...args: any[]) => any
  info: (...args: any[]) => any
  warn: (...args: any[]) => any
  error: (...args: any[]) => any
  fatal: (...args: any[]) => any
}


type FileEntry = {
  path: string
  action: 'write' | 'preserve' | 'present' | 'diff'
  copy?: string
}


type Audit = [string, any][]

export type {
  // JostracaOptions,
  JostracaResult,
  Node,
  OpStep,
  OpDef,
  Component,
  Log,
  FileEntry,
  FST,
  Audit,
}

