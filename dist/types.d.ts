type JostracaOptions = {
    folder?: string;
    meta?: any;
    exclude?: boolean;
    fs?: any;
    log?: Log;
    debug?: boolean;
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
    exclude?: boolean | string | string[];
    indent?: string;
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
