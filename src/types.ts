/* Copyright (c) 2024 Richard Rodger, MIT License */


type JostracaOptions = {
  folder?: string // Base output folder for generated files. Default: `.`.
  meta?: any // Provide meta data to the generation process. Default: `{}`
  exclude?: boolean // Exclude modified output files. Default: `false`.
  fs?: any // File system API (used for testing). Default: `node:fs`
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
  exclude?: boolean | string | string[]
  indent?: string
}


type OpStep = (node: Node, ctx$: any, buildctx: any) => void

type OpDef = {
  before: OpStep,
  after: OpStep,
}


type Component = (props: any, children?: any) => void



export type {
  JostracaOptions,
  Node,
  OpStep,
  OpDef,
  Component,
}

