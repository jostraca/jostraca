"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CopyOp = void 0;
const node_path_1 = __importDefault(require("node:path"));
const jostraca_1 = require("../jostraca");
const CopyOp = {
    before(node, ctx) {
        const name = ctx.node.name;
        const from = ctx.node.from;
    },
    after(_node, _ctx) {
    },
};
exports.CopyOp = CopyOp;
function walk(ctx, from, to) {
    const fs = ctx.fs;
    const entries = fs.readdirSync(from);
    for (let name of entries) {
        const frompath = node_path_1.default.join(from, name);
        const topath = node_path_1.default.join(to, name);
        const stat = fs.statSync(frompath);
        if (stat.isDirectory()) {
            walk(ctx, frompath, topath);
        }
        else if (isTemplate(name)) {
            const src = fs.readFileSync(frompath, 'utf8');
            const out = genTemplate(ctx, src, { name, frompath, topath });
        }
        else {
            fs.copyFileSync(frompath, topath);
        }
    }
}
function isTemplate(name) {
    return name.match(/\.(ts|js|json|txt|xml|toml|yml|yaml|py|php|rb|go|java|c|cpp|cs|sh|bat)$/i);
}
function genTemplate(ctx, src, spec) {
    let model = { foo: 'FOO', bar: 'BAR' };
    let out = '';
    let remain = src;
    let nextm = true;
    while (nextm) {
        let m = remain.match(/\$\$([^$]+)\$\$/);
        if (m) {
            let ref = m[1];
            out += remain.substring(0, m.index);
            let insert = (0, jostraca_1.getx)(model, ref);
            if (null == insert) {
                out += '$$' + ref + '$$';
                remain = remain.substring(m.index + 4 + ref.length);
            }
            else {
                out += insert;
                remain = remain.substring(m.index + 4 + ref.length);
            }
        }
        else {
            out += remain;
            nextm = false;
        }
    }
    return out;
}
//# sourceMappingURL=CopyOp.js.map