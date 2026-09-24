type Decoded = {
    text: string;
    escaped: boolean;
};
declare function decodeText(raw: Buffer | string): Decoded;
declare function encodeText(text: string): Buffer;
declare function escapedInto(node: {
    meta: any;
}, target: {
    meta?: any;
}): void;
export type { Decoded };
export { decodeText, encodeText, escapedInto, };
