import { Node, FileEntry, Component, FST } from './types';
import { FileHandler } from './FileHandler';
import { BuildMeta } from './meta/BuildMeta';
import type { Existing } from './jostraca';
declare class BuildContext {
    bmeta: BuildMeta;
    fh: FileHandler;
    fs: () => FST;
    audit: [string, any][];
    root: Component;
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
    file: {
        write: FileEntry[];
        preserve: FileEntry[];
        present: FileEntry[];
        diff: FileEntry[];
    };
    constructor(folder: string, existing: Existing, fs: () => FST);
}
export { BuildContext };
