import { FileHandler } from './FileHandler';
type FileMetaData = {
    path: string;
    size: number;
    last: number;
    exclude: boolean;
};
type BuildMetaData = {
    foldername: string;
    filename: string;
    last: number;
    hlast: number;
    files: Record<string, FileMetaData>;
};
declare class BuildMeta {
    fh: FileHandler;
    prev: BuildMetaData;
    next: BuildMetaData;
    constructor(fh: FileHandler);
    last(): number;
    get(file: any): void;
    add(file: string, meta: any): void;
    done(): BuildMetaData;
}
export { BuildMeta };
