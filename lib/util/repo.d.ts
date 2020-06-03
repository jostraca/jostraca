interface Repo {
    name: string;
    order: number;
    props: object;
}
declare type MapRepo = Repo[] & {
    [key: string]: Repo;
};
interface Template {
    name: string;
    path: string;
    parent_folders: string[];
    text: string;
    kind: string;
    render?: (ctxt: any) => any;
}
interface TemplateContext {
    name: string;
    version: string;
    year: number;
    prefix: string;
    suffix: string;
    parent_folders: string[];
    props: object;
    slots?: {
        [key: string]: string;
    };
}
interface GenerateSpec {
    group: string;
    repo: string;
    basefolder: string;
    repofolder: string;
}
interface GroupSpec {
    name: string;
    repos: MapRepo;
}
interface RepoSpec {
    version: string;
}
declare const intern: {
    generate(spec: GenerateSpec): void;
    render_template(tm: Template, ctxt: TemplateContext, text: string): any;
    load_templates(folder: string): Template[];
    parse_templates(templates: Template[]): void;
    load_repo_spec(spec: GenerateSpec, repo: Repo): RepoSpec;
    load_repo_groups(folder: string): {
        [group: string]: GroupSpec;
    };
    parse_repo_list(text: string): Repo[];
    deep(...rest: any[]): any;
};
declare function generate(spec: GenerateSpec): void;
export { generate, intern };
