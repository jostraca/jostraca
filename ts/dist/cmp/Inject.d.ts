/** The props `Inject` reads. */
type InjectProps = {
    /**
     * Path of the file to edit, below the enclosing folder. It must
     * already exist: Inject rewrites the region between the markers, it
     * does not create a file.
     */
    name: string;
    /**
     * The start and end marker pair. Both must be non-empty; the default
     * pair is `#--START--#\n` and `\n#--END--#`.
     */
    markers?: [string, string];
    /**
     * Leave the target alone. Coerced with `!!`, so any truthy value
     * excludes.
     */
    exclude?: boolean;
};
declare const Inject: import("../types").Component<InjectProps, never, never>;
export { Inject };
export type { InjectProps };
