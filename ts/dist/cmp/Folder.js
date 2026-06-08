"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Folder = void 0;
const jostraca_1 = require("../jostraca");
const Folder = (0, jostraca_1.cmp)(function Folder(props, children) {
    const node = props.ctx$.node;
    node.kind = 'folder';
    node.name = props.name;
    (0, jostraca_1.each)(children, { call: true });
});
exports.Folder = Folder;
//# sourceMappingURL=Folder.js.map