/**
 * The props `Fragment` reads.
 *
 * Validated, unlike most of the components: the shape below is a closed
 * set, so a misspelled prop stops the run instead of being dropped. The
 * type and the shape say the same thing at two different times.
 */
type FragmentProps = {
    /**
     * Path of the template file. A relative path resolves against the
     * output folder. The file must exist at define time.
     */
    from: string;
    /**
     * A number is that many spaces, a string is a literal prefix, applied
     * to the whole fragment.
     */
    indent?: string | number;
    /**
     * Extra substitutions, applied to the template as it is read. The
     * `<[SLOT]>` markers are added to this, so keep a key of your own
     * distinct from them.
     */
    replace?: Record<string, any>;
    /** A start and end marker pair: only the region between them is read. */
    eject?: (string | RegExp)[];
};
declare const Fragment: import("../types").Component<FragmentProps, never, never>;
export { Fragment };
export type { FragmentProps };
