import type { Component } from './types';
type CmpTreeNode = {
    cmp: string;
    props?: Record<string, any>;
    children?: CmpTreeNode[];
};
type CmpTreeOptions = {
    cmp?: Record<string, Component>;
};
declare const TREE_CMP: Record<string, Component>;
declare function cmpTree(root: CmpTreeNode | CmpTreeNode[], opts?: CmpTreeOptions): () => void;
export type { CmpTreeNode, CmpTreeOptions, };
export { TREE_CMP, cmpTree, };
