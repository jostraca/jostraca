declare function memClean(p: string): string;
declare class MemVolume {
    files: Map<string, Buffer<ArrayBufferLike>>;
    times: Map<string, number>;
    modes: Map<string, number>;
    dirs: Map<string, number>;
    links: Map<string, string>;
    seq: Map<string, number>;
    private nextSeq;
    constructor(json?: any);
    touch(cp: string): void;
    retouch(cp: string): void;
    fromJSON(json?: any): void;
    mkdirp(cp: string): void;
    children(cp: string): string[];
    toJSON(): Record<string, string | null>;
}
declare function memfs(json?: any): {
    fs: {
        existsSync(p: string): boolean;
        readFileSync(p: string, opts?: any): any;
        writeFileSync(p: string, data: any, opts?: any): void;
        appendFileSync(p: string, data: any, opts?: any): void;
        mkdirSync(p: string, opts?: any): void;
        statSync(p: string, opts?: any): any;
        readdirSync(p: string): string[];
        renameSync(from: string, to: string): void;
        unlinkSync(p: string): void;
        chmodSync(p: string, mode: number): void;
        realpathSync(p: string): string;
        symlinkSync(target: string, p: string): void;
    };
    vol: MemVolume;
};
export { memfs, memClean, MemVolume, };
