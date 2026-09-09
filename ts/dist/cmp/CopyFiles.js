"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Copy = exports.CopyFiles = void 0;
const jostraca_1 = require("../jostraca");
const shape_1 = require("shape");
const From = (from, _, s) => s.ctx.meta.fs().statSync(from);
const CopyFilesShape = (0, shape_1.Shape)({
    ctx$: Object,
    // The From path is independent of the project folder.
    from: (0, shape_1.Check)(From).String(),
    //from: String,
    // output folder is current folder, this is an optional subfolder,
    // or if copying a file, the output filename, if different.
    to: (0, shape_1.Optional)(String),
    replace: {},
    // A SCALAR String or RegExp is as legal as a list of them, matching
    // File (which shape-validates nothing) and the Go port. The
    // Boolean-or-Array-only spelling made the scalar arm of `state.excludes`
    // in CopyOp unreachable.
    exclude: (0, shape_1.Optional)((0, shape_1.One)(Boolean, String, RegExp, [(0, shape_1.One)(String, RegExp)]))
}, { name: 'CopyFiles' });
const CopyFiles = (0, jostraca_1.cmp)(function CopyFiles(props, _children) {
    const ctx = props.ctx$;
    const node = ctx.node;
    // TODO: expand this to support a file extract and/or source mapping back to ts
    const errstk = new Error();
    const suffixLines = errstk.stack.split('\n')
        .filter((n) => !n.includes('/shape/'))
        .filter((n) => !n.includes('/jostraca/'));
    const suffix = '[' + (suffixLines[1] || '').trim() + ']';
    props = CopyFilesShape(props, {
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
exports.CopyFiles = CopyFiles;
// `Copy` is the name this component shipped under. It stays exported as
// a DEPRECATED ALIAS -- the same function object, so `===` still holds
// and a `component.name` check sees `CopyFiles` either way -- because
// renaming an exported component is not worth breaking every consumer
// over. The name changed to match jostraca's other verb+noun components
// and the aontu functions that drive them (`copyfiles`), where plain
// `copy` was already taken by the builtin that copies a VALUE.
const Copy = CopyFiles;
exports.Copy = Copy;
//# sourceMappingURL=CopyFiles.js.map