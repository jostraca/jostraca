/** The props `Folder` reads. */
type FolderProps = {
    /**
     * One or more path segments below the enclosing folder. A `..` segment
     * is refused. Absent adds no segment, which makes a Folder a plain
     * grouping of its children.
     */
    name?: string;
};
declare const Folder: import("../types").Component<FolderProps, never, never>;
export { Folder };
export type { FolderProps };
