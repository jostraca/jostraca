/**
 * The props `Project` reads.
 *
 * Also bound for the children: a Project calls each of its children with
 * its own props, so `({folder}) => ...` inside one reads the same object
 * the Project was given.
 */
type ProjectProps = {
    /** Names the project, and joins the node path. No output of its own. */
    name?: string;
    /**
     * Output folder, joined to the run's folder. A tree is refused an
     * absolute path or a `..` segment.
     */
    folder?: string;
};
declare const Project: import("../types").Component<ProjectProps, never, never>;
export { Project };
export type { ProjectProps };
