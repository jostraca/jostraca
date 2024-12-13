declare function each(subject?: any[] | Object, // Iterate over subject.
spec?: {
    mark?: boolean;
    oval?: boolean;
    sort?: boolean | string;
    call?: boolean;
    args?: any;
} | ((...a: any[]) => any), apply?: (...a: any[]) => any): any[];
declare function select(key: any, map: Record<string, Function>): any;
declare function getx(root: any, path: string | string[]): any;
declare function get(root: any, path: string | string[]): any;
declare function camelify(input: any[] | string): string;
declare function kebabify(input: any[] | string): string;
declare function snakify(input: any[] | string): string;
declare function names(base: any, name: string, prop?: string): void;
declare function escre(s: string): string;
declare function template(src: string, model: any, spec?: {
    open?: string;
    close?: string;
    ref?: string;
    insert?: RegExp;
    replace?: Record<string, any>;
    handle?: (s?: string) => void;
}): string;
declare function indent(src: string, indent: string | number | undefined): string;
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
declare const BINARY_EXT: string[];
declare function isbinext(path: string): boolean;
export { each, select, get, getx, camelify, snakify, kebabify, cmap, vmap, names, template, escre, indent, isbinext, BINARY_EXT, };
