import { BuildContext } from './BuildContext';
import { FST, Audit } from './types';
declare class FileHandler {
    when: number;
    fs: () => FST;
    folder: string;
    audit: Audit;
    maxdepth: number;
    existing: {
        txt: any;
        bin: any;
    };
    preserve: any[];
    constructor(bctx: BuildContext, existing: {
        txt: any;
        bin: any;
    });
    save(path: string, content: string | Buffer, write?: boolean, whence?: string): void;
    diff(when: number, oldcontent: string, newcontent: string): string;
    existsFile(path: string, whence?: string): boolean;
    copyFile(frompath: string, topath: string, whence?: string): void;
    loadFile(path: string, opts?: any, whence?: string): string | Buffer;
    loadJSON(path: string, opts?: any, whence?: string): any;
    saveJSON(path: string, json: any, opts?: any, whence?: string): any;
    saveFile(path: string, content: string | Buffer, opts?: any, whence?: string): void;
}
declare function validPath(path: string, maxdepth: number, errmark: string): void;
export { validPath, FileHandler };
