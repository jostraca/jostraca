import type { Node, Component, CmpContext, CmpProps, CmpChild, CmpChildren, JostracaResult, CheckDrift, CheckResult } from './types';
import { BuildContext } from './build/BuildContext';
import { each, get, getx, camelify, snakify, kebabify, cmap, vmap, deep, omap, names, template, escre, indent, isbincontent, isbinext, partify, lcf, ucf } from './util/basic';
import * as PointUtil from './util/point';
import * as DiffUtil from './diff';
import { Content } from './cmp/Content';
import { Line } from './cmp/Line';
import { Slot } from './cmp/Slot';
import { CopyFiles, Copy } from './cmp/CopyFiles';
import { File } from './cmp/File';
import { Inject } from './cmp/Inject';
import { Fragment } from './cmp/Fragment';
import { Folder } from './cmp/Folder';
import { Project } from './cmp/Project';
import { ListItems, List } from './cmp/ListItems';
import type { ContentProps } from './cmp/Content';
import type { LineProps } from './cmp/Line';
import type { SlotProps } from './cmp/Slot';
import type { CopyFilesProps, CopyProps } from './cmp/CopyFiles';
import type { FileProps } from './cmp/File';
import type { InjectProps } from './cmp/Inject';
import type { FragmentProps } from './cmp/Fragment';
import type { FolderProps } from './cmp/Folder';
import type { ProjectProps } from './cmp/Project';
import type { ListItemsProps, ListItemProps, ListProps } from './cmp/ListItems';
import { cmpTree, TREE_CMP } from './tree';
import type { CmpTreeNode, CmpTreeOptions } from './tree';
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
        exclude: boolean | undefined;
        existing: {
            txt: {};
            bin: {};
        };
        model: any;
        build: boolean | undefined;
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
        exclude: boolean | undefined;
        existing: {
            txt: {};
            bin: {};
        };
        model: any;
        build: boolean | undefined;
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
        exclude: boolean | undefined;
        existing: {
            txt: {};
            bin: {};
        };
        model: any;
        build: boolean | undefined;
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
        exclude: boolean | undefined;
        existing: {
            txt: {};
            bin: {};
        };
        model: any;
        build: boolean | undefined;
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
    error: (root?: any, ctx?: import("shape").Context) => import("shape").ErrDesc[];
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
        readonly exclude: import("shape").Node<BooleanConstructor | undefined>;
        readonly existing: {
            txt: {};
            bin: {};
        };
        readonly model: any;
        readonly build: import("shape").Node<BooleanConstructor | undefined>;
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
    json: () => any;
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
    error: (root?: any, ctx?: import("shape").Context) => import("shape").ErrDesc[];
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
    json: () => any;
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
    check: (opts: JostracaOptions | {}, root: Function) => Promise<CheckResult>;
};
declare function cmp<P = any, Arg = never, Child = never>(component: (props: CmpProps<P>, children?: any) => any): Component<P, Arg, Child>;
export type { JostracaResult, JostracaOptions, CheckDrift, CheckResult, Component, CmpContext, CmpProps, CmpChild, CmpChildren, Node, Existing, CmpTreeNode, CmpTreeOptions, ProjectProps, FolderProps, FileProps, ContentProps, LineProps, SlotProps, InjectProps, FragmentProps, CopyFilesProps, ListItemsProps, ListItemProps, CopyProps, ListProps, };
export { Jostraca, BuildContext, cmp, each, get, getx, camelify, snakify, kebabify, cmap, vmap, names, template, escre, indent, isbincontent, isbinext, partify, lcf, ucf, deep, omap, Project, Content, File, Inject, Fragment, Folder, Line, Slot, CopyFiles, ListItems, Copy, List, PointUtil, DiffUtil, cmpTree, TREE_CMP, };
