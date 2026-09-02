type FST = {
    existsSync(path: string): boolean;
    readFileSync(path: string, options?: any): any;
    writeFileSync(path: string, data: any, options?: any): void;
    mkdirSync(path: string, options?: any): any;
    statSync(path: string, options?: any): any;
    readdirSync(path: string, options?: any): any;
    renameSync?: (from: string, to: string) => void;
    chmodSync?: (path: string, mode: any) => void;
    unlinkSync?: (path: string) => void;
    realpathSync?: (path: string) => any;
};
type JostracaResult = {
    when: number;
    files: {
        preserved: string[];
        written: string[];
        presented: string[];
        diffed: string[];
        merged: string[];
        conflicted: string[];
        unchanged: string[];
    };
    audit: () => Audit[];
    vol?: () => any;
    fs?: () => FST;
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
    mode?: number;
    indent?: string | number;
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
type Audit = [string, any][];
export type { JostracaResult, Node, OpStep, OpDef, Component, Log, FileEntry, FST, Audit, };
