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
    children?: Node[];
    meta: any;
    name?: string;
    path: string[];
    from?: string;
    content?: any[];
    folder?: string;
    after?: any;
    exclude?: boolean | string | (string | RegExp)[];
    indent?: string;
    filter?: (props: any, children: any, component: any) => boolean;
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
export type { JostracaOptions, Node, OpStep, OpDef, Component, Log, };
