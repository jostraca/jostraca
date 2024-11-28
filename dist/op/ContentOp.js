"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContentOp = void 0;
const ContentOp = {
    before(node, _ctx$, buildctx) {
        const content = buildctx.current.content = node;
        buildctx.current.file.content.push(content.content);
    },
    after(_node, _ctx$, buildctx) { },
};
exports.ContentOp = ContentOp;
//# sourceMappingURL=ContentOp.js.map