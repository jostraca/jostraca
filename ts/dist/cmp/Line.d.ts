import type { ContentProps } from './Content';
/**
 * The props `Line` reads: exactly `Content`'s.
 *
 * An alias rather than a copy, so the two cannot drift apart. The
 * components are one terminator apart -- `Line` appends a newline and
 * renders the same way -- and the Go port says the same thing by taking
 * `ContentProps` in `LineP`.
 */
type LineProps = ContentProps;
declare const Line: import("../types").Component<ContentProps, string, string>;
export { Line };
export type { LineProps };
