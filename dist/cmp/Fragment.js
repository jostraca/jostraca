"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Fragment = void 0;
const jostraca_1 = require("../jostraca");
const Fragment = (0, jostraca_1.cmp)(function Fragment(props, children) {
    const node = props.ctx$.node;
    node.kind = 'fragment';
    node.from = props.from;
    node.indent = props.indent;
    node.meta.replace = props.replace;
    (0, jostraca_1.each)(children, { call: true });
});
exports.Fragment = Fragment;
//# sourceMappingURL=Fragment.js.map