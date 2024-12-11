"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Copy = void 0;
const jostraca_1 = require("../jostraca");
const gubu_1 = require("gubu");
const From = (from, _, s) => s.ctx.fs.statSync(from);
const CopyShape = (0, gubu_1.Gubu)({
    ctx$: Object,
    name: (0, gubu_1.Optional)(String),
    from: (0, gubu_1.Check)(From).String(),
    to: (0, gubu_1.Optional)(String),
    exclude: (0, gubu_1.Optional)((0, gubu_1.One)(Boolean, [(0, gubu_1.One)(String, RegExp)]))
}, { name: 'Copy' });
const Copy = (0, jostraca_1.cmp)(function Copy(props, _children) {
    props = CopyShape(props, { fs: props.ctx$.fs });
    const node = props.ctx$.node;
    node.kind = 'copy';
    node.name = props.name;
    node.from = props.from;
    node.exclude = null == props.exclude ? node.exclude : props.exclude;
});
exports.Copy = Copy;
//# sourceMappingURL=Copy.js.map