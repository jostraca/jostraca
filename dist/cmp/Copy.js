"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Copy = void 0;
const jostraca_1 = require("../jostraca");
const gubu_1 = require("gubu");
const From = (from, _, s) => s.ctx.fs().statSync(from);
const CopyShape = (0, gubu_1.Gubu)({
    ctx$: Object,
    // The From path is independent of the project folder.
    from: (0, gubu_1.Check)(From).String(),
    // output folder is current folder, this is an optional subfolder,
    // or if copying a file, the output filename, if different.
    to: (0, gubu_1.Optional)(String),
    replace: {},
    exclude: (0, gubu_1.Optional)((0, gubu_1.One)(Boolean, [(0, gubu_1.One)(String, RegExp)]))
}, { name: 'Copy' });
const Copy = (0, jostraca_1.cmp)(function Copy(props, _children) {
    props = CopyShape(props, { fs: props.ctx$.fs });
    const node = props.ctx$.node;
    node.kind = 'copy';
    node.from = props.from;
    // NOTE: props.to is used as the Node name 
    node.name = props.to;
    node.exclude = null == props.exclude ? node.exclude : props.exclude;
    node.replace = props.replace;
});
exports.Copy = Copy;
//# sourceMappingURL=Copy.js.map