"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Copy = void 0;
const jostraca_1 = require("../jostraca");
const Copy = (0, jostraca_1.cmp)(function Copy(props, children) {
    const fs = props.ctx$.fs;
    const name = props.name;
    const from = props.from;
    const fromStat = fs.statSync(from);
    if (fromStat.isFile()) {
        props.ctx$.node.kind = 'file';
        props.ctx$.node.name = props.name;
        const content = fs.readFileSync(from).toString();
        (0, jostraca_1.Code)(content);
    }
    else if (fromStat.isDirectory()) {
        props.ctx$.node.kind = 'copy';
        props.ctx$.node.name = props.name;
        props.ctx$.node.from = from;
    }
    else {
        throw new Error('Copy: invalid from: ' + from);
    }
});
exports.Copy = Copy;
//# sourceMappingURL=Copy.js.map