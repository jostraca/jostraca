"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Copy = void 0;
const jostraca_1 = require("../jostraca");
const shape_1 = require("shape");
const From = (from, _, s) => s.ctx.meta.fs().statSync(from);
const CopyShape = (0, shape_1.Shape)({
    ctx$: Object,
    // The From path is independent of the project folder.
    from: (0, shape_1.Check)(From).String(),
    //from: String,
    // output folder is current folder, this is an optional subfolder,
    // or if copying a file, the output filename, if different.
    to: (0, shape_1.Optional)(String),
    replace: {},
    exclude: (0, shape_1.Optional)((0, shape_1.One)(Boolean, [(0, shape_1.One)(String, RegExp)]))
}, { name: 'Copy' });
const Copy = (0, jostraca_1.cmp)(function Copy(props, _children) {
    const ctx = props.ctx$;
    const node = ctx.node;
    // TODO: expand this to support a file extract and/or source mapping back to ts
    const errstk = new Error();
    const suffixLines = errstk.stack.split('\n')
        .filter((n) => !n.includes('/shape/'))
        .filter((n) => !n.includes('/jostraca/'));
    const suffix = '[' + (suffixLines[1] || '').trim() + ']';
    props = CopyShape(props, {
        prefix: `(${ctx.model.name}: ${node.path.join('/')})`,
        meta: { fs: props.ctx$.fs },
        suffix,
    });
    node.kind = 'copy';
    node.from = props.from;
    // NOTE: props.to is used as the Node name 
    node.name = props.to;
    node.exclude = null == props.exclude ? node.exclude : props.exclude;
    node.replace = props.replace;
});
exports.Copy = Copy;
//# sourceMappingURL=Copy.js.map