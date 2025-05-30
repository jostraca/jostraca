import type { Node, Component, JostracaResult } from './types';
import { BuildContext } from './build/BuildContext';
import { each, select, get, getx, camelify, snakify, kebabify, cmap, vmap, names, template, escre, indent, isbinext, partify, lcf, ucf } from './util/basic';
import * as PointUtil from './util/point';
declare const deep: (...args: any[]) => any;
declare const omap: (...args: any[]) => any;
import { Content } from './cmp/Content';
import { Line } from './cmp/Line';
import { Slot } from './cmp/Slot';
import { Copy } from './cmp/Copy';
import { File } from './cmp/File';
import { Inject } from './cmp/Inject';
import { Fragment } from './cmp/Fragment';
import { Folder } from './cmp/Folder';
import { Project } from './cmp/Project';
import { List } from './cmp/List';
declare const OptionsShape: {
    <V>(root?: V | undefined, ctx?: import("gubu").Context): V & {
        folder: any;
        meta: any;
        fs: any;
        now: any;
        log: any;
        debug: any;
        exclude: boolean;
        existing: {
            txt: {};
            bin: {};
        };
        model: any;
        build: boolean;
        mem: boolean;
        vol: {};
        cmp: {
            Copy: {
                ignore: any[];
            };
        };
        control: {
            duplicate: boolean;
            version: boolean;
        };
    };
    valid: <V>(root?: V | undefined, ctx?: import("gubu").Context) => root is V & {
        folder: import("gubu").Node<StringConstructor>;
        meta: any;
        fs: any;
        now: any;
        log: any;
        debug: import("gubu").Node<string>;
        exclude: boolean;
        existing: {
            txt: {};
            bin: {};
        };
        model: any;
        build: boolean;
        mem: boolean;
        vol: {};
        cmp: {
            Copy: {
                ignore: any[];
            };
        };
        control: {
            duplicate: boolean;
            version: boolean;
        };
    };
    match(root?: any, ctx?: import("gubu").Context): boolean;
    error(root?: any, ctx?: import("gubu").Context): {
        gubu: boolean;
        code: string;
        gname: string;
        props: ({
            path: string;
            type: string;
            value: any;
        }[]);
        desc: () => ({
            name: string;
            code: string;
            err: {
                key: string;
                type: string;
                node: import("gubu").Node<any>;
                value: any;
                path: string;
                why: string;
                check: string;
                args: Record<string, any>;
                mark: number;
                text: string;
                use: any;
            }[];
            ctx: any;
        });
        toJSON(): /*elided*/ any & {
            err: any;
            name: string;
            message: string;
        };
        name: string;
        message: string;
        stack?: string;
    }[];
    spec(): any;
    node(): import("gubu").Node<{
        folder: import("gubu").Node<StringConstructor>;
        meta: any;
        fs: any;
        now: any;
        log: any;
        debug: import("gubu").Node<string>;
        exclude: boolean;
        existing: {
            txt: {};
            bin: {};
        };
        model: any;
        build: boolean;
        mem: boolean;
        vol: {};
        cmp: {
            Copy: {
                ignore: any[];
            };
        };
        control: {
            duplicate: boolean;
            version: boolean;
        };
    }>;
    stringify(...rest: any[]): string;
    jsonify(): any;
    toString(this: any): string;
    gubu: {
        gubu$: symbol;
        v$: string;
    };
};
declare const ExistingShape: {
    <V>(root?: V | undefined, ctx?: import("gubu").Context): V & {
        txt: {
            write: boolean;
            preserve: boolean;
            present: boolean;
            diff: boolean;
            merge: boolean;
        };
        bin: {
            write: boolean;
            preserve: boolean;
            present: boolean;
        };
    };
    valid: <V>(root?: V | undefined, ctx?: import("gubu").Context) => root is V & {
        txt: {
            write: boolean;
            preserve: boolean;
            present: boolean;
            diff: boolean;
            merge: boolean;
        };
        bin: {
            write: boolean;
            preserve: boolean;
            present: boolean;
        };
    };
    match(root?: any, ctx?: import("gubu").Context): boolean;
    error(root?: any, ctx?: import("gubu").Context): {
        gubu: boolean;
        code: string;
        gname: string;
        props: ({
            path: string;
            type: string;
            value: any;
        }[]);
        desc: () => ({
            name: string;
            code: string;
            err: {
                key: string;
                type: string;
                node: import("gubu").Node<any>;
                value: any;
                path: string;
                why: string;
                check: string;
                args: Record<string, any>;
                mark: number;
                text: string;
                use: any;
            }[];
            ctx: any;
        });
        toJSON(): /*elided*/ any & {
            err: any;
            name: string;
            message: string;
        };
        name: string;
        message: string;
        stack?: string;
    }[];
    spec(): any;
    node(): import("gubu").Node<{
        txt: {
            write: boolean;
            preserve: boolean;
            present: boolean;
            diff: boolean;
            merge: boolean;
        };
        bin: {
            write: boolean;
            preserve: boolean;
            present: boolean;
        };
    }>;
    stringify(...rest: any[]): string;
    jsonify(): any;
    toString(this: any): string;
    gubu: {
        gubu$: symbol;
        v$: string;
    };
};
type JostracaOptions = ReturnType<typeof OptionsShape>;
type ExistingOptions = ReturnType<typeof ExistingShape>;
type Existing = {
    txt: ExistingOptions["txt"];
    bin: ExistingOptions["bin"];
};
declare function Jostraca(gopts_in?: JostracaOptions | {}): {
    generate: (opts_in: JostracaOptions | {}, root: Function) => Promise<JostracaResult>;
};
declare function cmp(component: Function): Component;
export type { JostracaOptions, Component, Node, Existing, };
export { Jostraca, BuildContext, cmp, each, select, get, getx, camelify, snakify, kebabify, cmap, vmap, names, template, escre, indent, isbinext, partify, lcf, ucf, deep, omap, Project, Content, File, Inject, Fragment, Folder, Copy, Line, Slot, List, PointUtil, };
