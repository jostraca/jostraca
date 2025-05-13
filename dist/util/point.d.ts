type PointCtx = {
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
};
declare abstract class Point implements Point {
    id: string;
    name?: string;
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
    add(p: Point): void;
    start(data?: Record<string, any>, sys?: any): Promise<PointCtx>;
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
export type { PointCtx, };
export { Point, RootPoint, SerialPoint, ParallelPoint, FuncPoint, PrintPoint, };
