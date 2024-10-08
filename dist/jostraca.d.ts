import type { JostracaOptions, Node, Component } from './types';
import { each, select, get, getx, camelify, snakify, kebabify, cmap, vmap, names } from './utility';
import { Content } from './cmp/Content';
import { Copy } from './cmp/Copy';
import { File } from './cmp/File';
import { Inject } from './cmp/Inject';
import { Fragment } from './cmp/Fragment';
import { Folder } from './cmp/Folder';
import { Project } from './cmp/Project';
declare function Jostraca(): {
    generate: (opts: JostracaOptions, root: Function) => Promise<any>;
};
declare function cmp(component: Function): Component;
export type { JostracaOptions, Component, Node, };
export { Jostraca, cmp, each, select, get, getx, camelify, snakify, kebabify, cmap, vmap, names, Project, Content, File, Inject, Fragment, Folder, Copy, };
