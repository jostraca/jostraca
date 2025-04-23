import { BuildContext } from '../BuildContext';
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
    #private;
    constructor(bctx: BuildContext);
    last(): number;
    get(file: any): void;
    add(file: string, meta: any): void;
    done(): BuildMetaData;
}
export { BuildMeta };
