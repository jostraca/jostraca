"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Content = void 0;
const jostraca_1 = require("../jostraca");
const Content = (0, jostraca_1.cmp)(function Content(props, _children) {
    const node = props.ctx$.node;
    node.kind = 'content';
    let src = props.arg;
    node.content = src;
});
exports.Content = Content;
//# sourceMappingURL=Content.js.map