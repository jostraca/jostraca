/**
 * The props `CopyFiles` reads.
 *
 * Validated, like `Fragment` and unlike the other eight: the shape below
 * is a closed set, so a misspelled prop stops the run instead of being
 * dropped. The type and the shape say the same thing at two different
 * times.
 */
type CopyFilesProps = {
    /**
     * File or directory to copy. Independent of the output folder: a
     * relative path resolves against the process working directory, not
     * against the project. It must exist at define time.
     */
    from: string;
    /**
     * Destination name below the enclosing folder, when it differs from
     * the source name. A directory copy lands under it.
     */
    to?: string;
    /**
     * Substitutions applied to copied text. A binary file is copied
     * through unchanged.
     */
    replace?: Record<string, any>;
    /**
     * Paths to skip, relative to the copied source root. A scalar is as
     * legal as a list; a boolean is accepted and does nothing.
     */
    exclude?: boolean | string | RegExp | (string | RegExp)[];
};
declare const CopyFiles: import("../types").Component<CopyFilesProps, never, never>;
declare const Copy: import("../types").Component<CopyFilesProps, never, never>;
/** @deprecated Use `CopyFilesProps`. */
type CopyProps = CopyFilesProps;
export { CopyFiles, Copy, };
export type { CopyFilesProps, CopyProps, };
