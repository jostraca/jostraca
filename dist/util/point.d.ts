type PointCtx = {
    async: boolean;
    log: LogEntry[];
    data: Record<string, any>;
    depth: number;
    sys: (() => {
        now: () => number;
        print: (...s: any) => void;
    }) & {
        plog?: string[];
    };
};
type LogEntry = {
    note: string;
    when: number;
    depth: number;
    args: any;
};
declare abstract class Point implements Point {
    id: string;
    name?: string;
    args?: any;
    constructor(id: string, name?: string);
    runner(pctx: PointCtx): Promise<void>;
    logger(pctx: PointCtx, entry: Partial<LogEntry>): void;
    abstract run(pctx: PointCtx): Promise<void>;
}
declare class SerialPoint extends Point {
    points: Point[];
    constructor(id: string);
    add(p: Point): void;
    run(pctx: PointCtx): Promise<void>;
}
declare class RootPoint extends SerialPoint {
    points: Point[];
    constructor(id: string);
    direct(data?: Record<string, any>, sys?: any): PointCtx;
    start(data?: Record<string, any>, sys?: any): Promise<PointCtx>;
    makePointCtx(async: boolean, data?: Record<string, any>, sys?: any): PointCtx;
}
declare class ParallelPoint extends Point {
    points: Point[];
    constructor(id: string);
    add(p: Point): void;
    run(pctx: PointCtx): Promise<void>;
}
declare class FuncPoint extends Point {
    func: (pctx: PointCtx) => any;
    constructor(id: string, func: (pctx: PointCtx) => any);
    run(pctx: PointCtx): Promise<void>;
}
declare class PrintPoint extends Point {
    path?: string;
    constructor(id: string, path?: string);
    run(pctx: PointCtx): Promise<void>;
}
declare const PointDefShape: {
    <V>(root?: V | undefined, ctx?: import("gubu").Context): V & {
        k: any;
        n: any;
        p: any;
        a: any;
    };
    valid: <V>(root?: V | undefined, ctx?: import("gubu").Context) => root is V & {
        k: import("gubu").Node<StringConstructor>;
        n: import("gubu").Node<StringConstructor>;
        p: import("gubu").Node<never[]>;
        a: import("gubu").Node<unknown>;
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
        k: import("gubu").Node<StringConstructor>;
        n: import("gubu").Node<StringConstructor>;
        p: import("gubu").Node<never[]>;
        a: import("gubu").Node<unknown>;
    }>;
    stringify(...rest: any[]): string;
    jsonify(): any;
    toString(this: any): string;
    gubu: {
        gubu$: symbol;
        v$: string;
    };
};
type PointDef = Partial<ReturnType<typeof PointDefShape>>;
type MakePoint = (id: () => string, pdef: PointDef) => Point;
declare function buildPoints(pdef: PointDef, pm: Record<string, MakePoint>, id?: () => string): Point;
declare function makeFuncDef(fd: (pdef: PointDef) => (pctx: PointCtx) => any): (id: () => string, pdef: PointDef) => FuncPoint;
export type { PointCtx, MakePoint, PointDef, };
export { Point, RootPoint, SerialPoint, ParallelPoint, FuncPoint, PrintPoint, buildPoints, makeFuncDef, };
