import type { Node, BuildContext } from '../jostraca';
declare const CopyOp: {
    before(node: Node, ctx$: any, buildctx: BuildContext): void;
    after(node: Node, ctx$: any, buildctx: BuildContext): void;
};
export { CopyOp };
