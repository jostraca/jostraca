import type { CheckResult, JostracaResult } from './types';
declare const META_FOLDER = ".jostraca";
declare function checkRun(generate: (opts: any, root: Function) => Promise<JostracaResult>, opts: any, root: Function): Promise<CheckResult>;
export { checkRun, META_FOLDER, };
