type PointCtx = {
    log: LogEntry[];
    data: Record<string, any>;
};
type LogEntry = {
    note: string;
    when: number;
};
declare abstract class Point implements Point {
    id: string;
    constructor(id: string);
    runner(pctx: PointCtx): Promise<void>;
    logger(pctx: PointCtx, entry: Partial<LogEntry>): void;
    abstract run(pctx: PointCtx): Promise<void>;
}
declare class ParentPoint extends Point {
    points: Point[];
    constructor(id: string);
    add(p: Point): void;
    start(data?: Record<string, any>): Promise<PointCtx>;
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
export { PointCtx, Point, ParentPoint, FuncPoint, PrintPoint, };
