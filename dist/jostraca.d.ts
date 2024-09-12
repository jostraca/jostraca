import { Copy } from './cmp/Copy';
type JostracaOptions = {
    folder?: string;
    fs?: any;
    meta?: any;
};
type Node = {
    kind: string;
    children?: Node[];
    name?: string;
    path?: string;
    from?: string;
    content?: any[];
};
type Component = (props: any, children?: any) => void;
declare function Jostraca(): {
    generate: (opts: JostracaOptions, root: Function) => void;
};
declare const Code: Component;
declare const File: Component;
declare const Project: Component;
declare const Folder: Component;
declare function cmp(component: Function): Component;
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
export type { JostracaOptions, Component, Node, };
export { Jostraca, cmp, each, select, get, getx, camelify, snakify, kebabify, cmap, vmap, names, Project, Code, File, Folder, Copy, };
