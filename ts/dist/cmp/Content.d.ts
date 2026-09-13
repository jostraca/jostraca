/**
 * The props `Content` reads.
 *
 * Text comes from one of three places, in this order: `arg`, where the
 * positional form `Content('text')` lands; then `src`; then a string
 * child, `Content({indent: 2}, 'text')`. The first one present wins, and
 * a `Content` with none of them writes nothing.
 */
type ContentProps = {
    /**
     * Source text, as the positional form leaves it. Outranks `src`.
     *
     * Declared `string` because text is what this is for. The runtime is
     * wider -- it stringifies whatever it is handed -- and a caller who
     * means to write a number should say so at the call site.
     */
    arg?: string;
    /** Source text. Read when `arg` is absent. */
    src?: string;
    /** Names the span, and joins the node path. No effect on output. */
    name?: string;
    /** A number is that many spaces, a string is a literal prefix. */
    indent?: string | number;
    /** Merged over the generate model, for this span only. */
    extra?: Record<string, any>;
    /** Extra substitutions, keyed by a literal, a `/regexp/` or a `#Tag`. */
    replace?: Record<string, any>;
    /**
     * Hand the bytes through untouched: no model substitution, and so
     * neither `extra` nor `replace`. Default false: templating is what
     * `Content` is for, and `raw` is for a caller holding final bytes from
     * somewhere else. See the note in the body for why an empty model is
     * not the same guard.
     */
    raw?: boolean;
};
declare const Content: import("../types").Component<ContentProps, string, string>;
export { Content };
export type { ContentProps };
