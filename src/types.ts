/* Copyright (c) 2024 Richard Rodger, MIT License */


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

  // Component specific options.
  cmp?: {
    Copy?: {
      ignore?: RegExp[]
    }
  }
}


type Node = {
  kind: string
  children?: Node[]
  meta: any

  name?: string
  path: string[]
  from?: string
  content?: any[]
  folder?: string
  after?: any
  exclude?: boolean | string | (string | RegExp)[]
  indent?: string
  filter?: (props: any, children: any, component: any) => boolean
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


export type {
  JostracaOptions,
  Node,
  OpStep,
  OpDef,
  Component,
  Log,
}

