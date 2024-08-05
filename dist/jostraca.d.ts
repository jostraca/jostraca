type JostracaOptions = {
    folder: string;
    fs: any;
};
type Component = (props: any, children?: any) => void;
declare function Jostraca(): {
    cmp: (component: Function) => Component;
    each: (subject: any, apply?: any) => any;
    generate: (opts: JostracaOptions, root: Function) => void;
    Project: Component;
    Code: Component;
    File: Component;
    Folder: Component;
};
export type { JostracaOptions, Component, };
export { Jostraca, };
