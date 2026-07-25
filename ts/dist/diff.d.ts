type DiffLabels = {
    generated?: string;
    existing?: string;
};
type DiffSpec = {
    when?: number;
    last?: number;
    kind?: string;
    labels?: DiffLabels;
};
type MergeOutcome = 'same' | 'clean' | 'unresolved' | 'merged';
type MergeResult = {
    content: string;
    conflict: boolean;
    outcome: MergeOutcome;
};
type DiffOutcome = 'same' | 'changed';
type DiffResult = {
    content: string;
    conflict: boolean;
    outcome: DiffOutcome;
};
declare function hasConflicts(text: string): boolean;
declare function lines(text: string): string[];
declare function lcs(a: string[], b: string[]): string[];
declare function alignLcs(base: string[], target: string[]): number[];
declare function merge(generated: string, baseline: string, existing: string, spec?: DiffSpec): MergeResult;
type Hunk = {
    kind: number;
    generated: string[];
    existing: string[];
};
declare function hunks(generated: string[], existing: string[]): Hunk[];
declare function diff(generated: string, existing: string, spec?: DiffSpec): DiffResult;
export { merge, diff, hasConflicts, lines, lcs, alignLcs, hunks, };
export type { DiffLabels, DiffSpec, DiffOutcome, DiffResult, MergeOutcome, MergeResult, };
