"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContentOp = void 0;
const jostraca_1 = require("../jostraca");
const ContentOp = {
    before(node, _ctx$, buildctx) {
        const content = buildctx.current.content = node;
        let src = content.content;
        if (null != node.indent) {
            src = (0, jostraca_1.indent)(src, node.indent);
        }
        buildctx.current.file.content.push(src);
    },
    after(_node, _ctx$, _buildctx) {
    },
};
exports.ContentOp = ContentOp;
//# sourceMappingURL=ContentOp.js.map