import type { JostracaOptions, Node, Component } from './types';
import { each, select, get, getx, camelify, snakify, kebabify, cmap, vmap, names, template, escre, indent } from './utility';
import { Content } from './cmp/Content';
import { Line } from './cmp/Line';
import { Slot } from './cmp/Slot';
import { Copy } from './cmp/Copy';
import { File } from './cmp/File';
import { Inject } from './cmp/Inject';
import { Fragment } from './cmp/Fragment';
import { Folder } from './cmp/Folder';
import { Project } from './cmp/Project';
import { List } from './cmp/List';
declare const deep: any;
declare function Jostraca(gopts?: JostracaOptions): {
    generate: (opts: JostracaOptions, root: Function) => Promise<any>;
};
declare function cmp(component: Function): Component;
export type { JostracaOptions, Component, Node, };
export { Jostraca, cmp, each, select, get, getx, camelify, snakify, kebabify, cmap, vmap, names, template, escre, indent, deep, Project, Content, File, Inject, Fragment, Folder, Copy, Line, Slot, List, };
