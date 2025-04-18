type JostracaOptions = {
    folder?: string;
    meta?: any;
    fs?: any;
    log?: Log;
    debug?: boolean;
    exclude?: boolean;
    model?: any;
    build?: boolean;
    mem?: boolean;
    vol?: any;
    cmp?: {
        Copy?: {
            ignore?: RegExp[];
        };
    };
};
type Node = {
    kind: string;
    meta: any;
    content: any[];
    children?: Node[];
    name?: string;
    path: string[];
    from?: string;
    folder?: string;
    after?: any;
    exclude?: boolean | string | (string | RegExp)[];
    indent?: string;
    filter?: (props: any, children: any, component: any) => boolean;
    fullpath?: string;
    replace?: Record<string, any>;
};
type OpStep = (node: Node, ctx$: any, buildctx: any) => Promise<any> | void;
type OpDef = {
    before: OpStep;
    after: OpStep;
};
type Component = (props: any, children?: any) => void;
type Log = {
    trace: (...args: any[]) => any;
    debug: (...args: any[]) => any;
    info: (...args: any[]) => any;
    warn: (...args: any[]) => any;
    error: (...args: any[]) => any;
    fatal: (...args: any[]) => any;
};
type FileEntry = {
    path: string;
    action: 'write' | 'preserve' | 'present' | 'diff';
    copy?: string;
};
type BuildContext = {
    root: Component;
    when: number;
    vol: any;
    folder: string;
    current: {
        project: {
            node: Node;
        };
        folder: {
            node: Node;
            parent: string;
            path: string[];
        };
        file: Node;
        content: any;
    };
    log: {
        exclude: string[];
        last: number;
    };
    util: {
        save: (path: string, content: string | Buffer, write?: boolean) => any;
    };
    file: {
        write: FileEntry[];
        preserve: FileEntry[];
        present: FileEntry[];
        diff: FileEntry[];
    };
};
export type { JostracaOptions, Node, OpStep, OpDef, Component, Log, BuildContext, };
