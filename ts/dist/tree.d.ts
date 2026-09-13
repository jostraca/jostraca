import type { Component } from './types';
type CmpTreeNode = {
    cmp: string;
    props?: Record<string, any>;
    children?: CmpTreeNode[];
};
type CmpTreeOptions = {
    cmp?: Record<string, Component>;
    raw?: boolean;
};
declare const TREE_CMP: Record<string, Component>;
declare const TREE_CMP_DEPRECATED: Record<string, Component>;
declare const TREE_RAW_CMP: Component[];
declare function cmpTree(root: CmpTreeNode | CmpTreeNode[], opts?: CmpTreeOptions): () => void;
export type { CmpTreeNode, CmpTreeOptions, };
export { TREE_CMP, TREE_CMP_DEPRECATED, TREE_RAW_CMP, cmpTree, };
