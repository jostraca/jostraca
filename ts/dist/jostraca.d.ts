import type { Node, Component, JostracaResult } from './types';
import { BuildContext } from './build/BuildContext';
import { each, get, getx, camelify, snakify, kebabify, cmap, vmap, deep, omap, names, template, escre, indent, isbincontent, isbinext, partify, lcf, ucf } from './util/basic';
import * as PointUtil from './util/point';
import * as DiffUtil from './diff';
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
    <V>(root?: V | undefined, ctx?: import("shape").Context): (0 extends 1 & V ? true : false) extends true ? {
        folder: string | undefined;
        name: {
            file: {
                prefix: string | undefined;
                suffix: string | undefined;
            };
            folder: {
                prefix: string | undefined;
                suffix: string | undefined;
            };
            exclude: string | (string | RegExpConstructor)[] | RegExpConstructor | undefined;
        };
        meta: any;
        fs: any;
        now: any;
        log: any;
        debug: string | undefined;
        exclude: boolean;
        existing: {
            txt: {};
            bin: {};
        };
        model: any;
        build: boolean;
        mem: boolean | undefined;
        vol: {} | undefined;
        cmp: {
            Copy: {
                ignore: any[];
            };
        };
        control: {
            dryrun: boolean | undefined;
            duplicate: boolean | undefined;
            version: boolean | undefined;
        };
    } : V extends object ? Omit<V, "build" | "cmp" | "control" | "debug" | "exclude" | "existing" | "folder" | "fs" | "log" | "mem" | "meta" | "model" | "name" | "now" | "vol"> & {
        folder: string | undefined;
        name: {
            file: {
                prefix: string | undefined;
                suffix: string | undefined;
            };
            folder: {
                prefix: string | undefined;
                suffix: string | undefined;
            };
            exclude: string | (string | RegExpConstructor)[] | RegExpConstructor | undefined;
        };
        meta: any;
        fs: any;
        now: any;
        log: any;
        debug: string | undefined;
        exclude: boolean;
        existing: {
            txt: {};
            bin: {};
        };
        model: any;
        build: boolean;
        mem: boolean | undefined;
        vol: {} | undefined;
        cmp: {
            Copy: {
                ignore: any[];
            };
        };
        control: {
            dryrun: boolean | undefined;
            duplicate: boolean | undefined;
            version: boolean | undefined;
        };
    } : {
        folder: string | undefined;
        name: {
            file: {
                prefix: string | undefined;
                suffix: string | undefined;
            };
            folder: {
                prefix: string | undefined;
                suffix: string | undefined;
            };
            exclude: string | (string | RegExpConstructor)[] | RegExpConstructor | undefined;
        };
        meta: any;
        fs: any;
        now: any;
        log: any;
        debug: string | undefined;
        exclude: boolean;
        existing: {
            txt: {};
            bin: {};
        };
        model: any;
        build: boolean;
        mem: boolean | undefined;
        vol: {} | undefined;
        cmp: {
            Copy: {
                ignore: any[];
            };
        };
        control: {
            dryrun: boolean | undefined;
            duplicate: boolean | undefined;
            version: boolean | undefined;
        };
    };
    valid: <V>(root?: V | undefined, ctx?: import("shape").Context) => root is V & {
        folder: string | undefined;
        name: {
            file: {
                prefix: string | undefined;
                suffix: string | undefined;
            };
            folder: {
                prefix: string | undefined;
                suffix: string | undefined;
            };
            exclude: string | (string | RegExpConstructor)[] | RegExpConstructor | undefined;
        };
        meta: any;
        fs: any;
        now: any;
        log: any;
        debug: string | undefined;
        exclude: boolean;
        existing: {
            txt: {};
            bin: {};
        };
        model: any;
        build: boolean;
        mem: boolean | undefined;
        vol: {} | undefined;
        cmp: {
            Copy: {
                ignore: any[];
            };
        };
        control: {
            dryrun: boolean | undefined;
            duplicate: boolean | undefined;
            version: boolean | undefined;
        };
    };
    match: (root?: any, ctx?: import("shape").Context) => boolean;
    error: (root?: any, ctx?: import("shape").Context) => {
        shape: boolean;
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
                node: import("shape").Node<any>;
                value: any;
                path: string;
                pathArr: (string | number)[];
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
        cause?: unknown;
    }[];
    spec: () => any;
    node: () => import("shape").Node<{
        readonly folder: import("shape").Node<StringConstructor | undefined>;
        readonly name: {
            file: {
                prefix: import("shape").Node<StringConstructor | undefined>;
                suffix: import("shape").Node<StringConstructor | undefined>;
            };
            folder: {
                prefix: import("shape").Node<StringConstructor | undefined>;
                suffix: import("shape").Node<StringConstructor | undefined>;
            };
            exclude: import("shape").Node<RegExpConstructor | StringConstructor | readonly [import("shape").Node<RegExpConstructor | StringConstructor>] | undefined>;
        };
        readonly meta: any;
        readonly fs: any;
        readonly now: any;
        readonly log: any;
        readonly debug: import("shape").Node<string | undefined>;
        readonly exclude: false;
        readonly existing: {
            txt: {};
            bin: {};
        };
        readonly model: any;
        readonly build: true;
        readonly mem: import("shape").Node<BooleanConstructor | undefined>;
        readonly vol: import("shape").Node<{} | undefined>;
        readonly cmp: {
            Copy: {
                ignore: any[];
            };
        };
        readonly control: {
            dryrun: import("shape").Node<BooleanConstructor | undefined>;
            duplicate: import("shape").Node<BooleanConstructor | undefined>;
            version: import("shape").Node<BooleanConstructor | undefined>;
        };
    }>;
    stringify: (...rest: any[]) => string;
    jsonify: () => any;
    jsonSchema: () => any;
    toString: (this: any) => string;
    shape: {
        shape$: symbol;
        v$: string;
    };
};
declare const ExistingShape: {
    <V>(root?: V | undefined, ctx?: import("shape").Context): (0 extends 1 & V ? true : false) extends true ? {
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
    } : V extends object ? Omit<V, "bin" | "txt"> & {
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
    } : {
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
    valid: <V>(root?: V | undefined, ctx?: import("shape").Context) => root is V & {
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
    match: (root?: any, ctx?: import("shape").Context) => boolean;
    error: (root?: any, ctx?: import("shape").Context) => {
        shape: boolean;
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
                node: import("shape").Node<any>;
                value: any;
                path: string;
                pathArr: (string | number)[];
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
        cause?: unknown;
    }[];
    spec: () => any;
    node: () => import("shape").Node<{
        readonly txt: {
            readonly write: true;
            readonly preserve: false;
            readonly present: false;
            readonly diff: false;
            readonly merge: false;
        };
        readonly bin: {
            readonly write: true;
            readonly preserve: false;
            readonly present: false;
        };
    }>;
    stringify: (...rest: any[]) => string;
    jsonify: () => any;
    jsonSchema: () => any;
    toString: (this: any) => string;
    shape: {
        shape$: symbol;
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
export type { JostracaResult, JostracaOptions, Component, Node, Existing, };
export { Jostraca, BuildContext, cmp, each, get, getx, camelify, snakify, kebabify, cmap, vmap, names, template, escre, indent, isbincontent, isbinext, partify, lcf, ucf, deep, omap, Project, Content, File, Inject, Fragment, Folder, Copy, Line, Slot, List, PointUtil, DiffUtil, };
