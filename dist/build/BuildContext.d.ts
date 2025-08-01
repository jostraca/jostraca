import { Node, FST, Audit } from '../types';
import { FileHandler } from './FileHandler';
import { BuildMeta } from './BuildMeta';
import type { Existing } from '../jostraca';
declare class BuildContext {
    fs: () => FST;
    now: () => number;
    bmeta: BuildMeta;
    fh: FileHandler;
    audit: Audit;
    when: number;
    vol: any;
    folder: string;
    current: {
        project: {
            node: Node;
        };
        folder: {
            node: Node;
            parent: string;
            path: string[];
        };
        file: Node;
        content: any;
    };
    log: {
        exclude: string[];
        last: number;
    };
    dfolder?: string;
    constructor(folder: string, existing: Existing, control: {
        dryrun: boolean;
        duplicate: boolean;
        version: boolean;
    }, fs: () => FST, now: () => number);
    addmeta(file: string, meta: any): void;
    duplicateFolder(): string;
}
export { BuildContext };
