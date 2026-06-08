"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.File = void 0;
const jostraca_1 = require("../jostraca");
const File = (0, jostraca_1.cmp)(function File(props, children) {
    const node = props.ctx$.node;
    node.kind = 'file';
    node.name = props.name;
    node.exclude = null == props.exclude ? node.exclude : props.exclude;
    (0, jostraca_1.each)(children, { call: true });
});
exports.File = File;
//# sourceMappingURL=File.js.map