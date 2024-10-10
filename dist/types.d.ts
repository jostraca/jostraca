type JostracaOptions = {
    folder?: string;
    meta?: any;
    exclude?: boolean;
    fs?: any;
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
    exclude?: boolean;
    indent?: string;
};
type OpStep = (node: Node, ctx$: any, buildctx: any) => void;
type OpDef = {
    before: OpStep;
    after: OpStep;
};
type Component = (props: any, children?: any) => void;
export type { JostracaOptions, Node, OpStep, OpDef, Component, };
