type JostracaOptions = {
    folder?: string;
    fs?: any;
    meta?: any;
};
type Node = {
    kind: string;
    children?: Node[];
    name?: string;
    path: string[];
    from?: string;
    content?: any[];
    folder?: string;
    after?: any;
    exclude?: boolean;
};
type OpStep = (node: Node, ctx$: any, buildctx: any) => void;
type OpDef = {
    before: OpStep;
    after: OpStep;
};
type Component = (props: any, children?: any) => void;
declare function each(subject?: any, apply?: any): any;
declare function select(key: any, map: Record<string, Function>): any;
declare function getx(root: any, path: string | string[]): any;
declare function get(root: any, path: string | string[]): any;
declare function camelify(input: any[] | string): string;
declare function kebabify(input: any[] | string): string;
declare function snakify(input: any[] | string): string;
declare function names(base: any, name: string, prop?: string): void;
declare function cmap(o: any, p: any): any;
declare namespace cmap {
    var COPY: (x: any) => any;
    var FILTER: (x: any) => any;
    var KEY: (_: any, p: any) => any;
}
declare function vmap(o: any, p: any): any;
declare namespace vmap {
    var COPY: (x: any) => any;
    var FILTER: (x: any) => any;
    var KEY: (_: any, p: any) => any;
}
export type { JostracaOptions, Node, OpStep, OpDef, Component, };
export { each, select, get, getx, camelify, snakify, kebabify, cmap, vmap, names, };
