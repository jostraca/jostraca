/* Copyright (c) 2024-2025 Richard Rodger, MIT License */


import * as Fs from 'node:fs'


type FST = typeof Fs

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
  vol?: () => any
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

