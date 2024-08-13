type JostracaOptions = {
    folder: string;
    fs: any;
};
type Component = (props: any, children?: any) => void;
declare function Jostraca(): {
    generate: (opts: JostracaOptions, root: Function) => void;
};
declare const Code: Component;
declare const File: Component;
declare const Copy: Component;
declare const Project: Component;
declare const Folder: Component;
declare function cmp(component: Function): Component;
declare function each(subject: any, apply?: any): any;
declare function select(key: any, map: Record<string, Function>): any;
declare function get(root: any, path: string | string[]): any;
declare function camelify(input: any[] | string): string;
declare function snakeify(input: any[] | string): string;
export type { JostracaOptions, Component, };
export { Jostraca, cmp, each, select, get, camelify, snakeify, Project, Code, File, Folder, Copy, };
