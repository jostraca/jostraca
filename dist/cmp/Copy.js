"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Copy = void 0;
const jostraca_1 = require("../jostraca");
const Copy = (0, jostraca_1.cmp)(function Copy(props, _children) {
    const node = props.ctx$.node;
    node.kind = 'copy';
    node.name = props.name;
    node.from = props.from;
    node.exclude = null == props.exclude ? node.exclude : props.exclude;
});
exports.Copy = Copy;
//# sourceMappingURL=Copy.js.map