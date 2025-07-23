import { BuildContext } from './BuildContext';
import { FST, Audit } from '../types';
declare class FileHandler {
    when: number;
    fs: () => FST;
    now: () => number;
    folder: string;
    audit: Audit;
    maxdepth: number;
    existing: {
        txt: any;
        bin: any;
    };
    control: {
        dryrun: boolean;
        duplicate: boolean;
        version: boolean;
    };
    duplicateFolder: () => string;
    last: () => number;
    addmeta: (file: string, meta: any) => void;
    metafile: () => string;
    files: {
        preserved: string[];
        written: string[];
        presented: string[];
        diffed: string[];
        merged: string[];
        conflicted: string[];
        unchanged: string[];
    };
    constructor(bctx: BuildContext, existing: {
        txt: any;
        bin: any;
    }, control: {
        dryrun: boolean;
        duplicate: boolean;
        version: boolean;
    });
    relative(path: string, whence?: string): string;
    save(path: string, content: string | Buffer, write?: boolean | string, whence?: string): void;
    copy(frompath: string, topath: string, write?: boolean | string, whence?: string): void;
    merge(newcontent: string, oldcontent: string, origcontent: string): {
        content: string;
        conflict: boolean;
    };
    diff(oldcontent: string, newcontent: string): string;
    existsFile(path: string, whence?: string): boolean;
    copyFile(frompath: string, topath: string, whence?: string): void;
    loadJSON(path: string, opts?: any | string, whence?: string): any;
    saveJSON(path: string, json: any, opts?: any | string, whence?: string): any;
    loadFile(path: string, opts?: any | string, whence?: string): string | Buffer;
    ensureFolder(path: string): void;
    saveFile(path: string, content: string | Buffer, opts?: any | string, whence?: string): void;
}
declare function validPath(path: string, maxdepth: number, errmark: string): void;
export { validPath, FileHandler };
