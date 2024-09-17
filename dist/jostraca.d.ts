import type { JostracaOptions, Node, Component } from './utility';
import { each, select, get, getx, camelify, snakify, kebabify, cmap, vmap, names } from './utility';
import { Content } from './cmp/Content';
import { Copy } from './cmp/Copy';
import { File } from './cmp/File';
import { Folder } from './cmp/Folder';
import { Project } from './cmp/Project';
declare function Jostraca(): {
    generate: (opts: JostracaOptions, root: Function) => void;
};
declare function cmp(component: Function): Component;
export type { JostracaOptions, Component, Node, };
export { Jostraca, cmp, each, select, get, getx, camelify, snakify, kebabify, cmap, vmap, names, Project, Content, File, Folder, Copy, };
