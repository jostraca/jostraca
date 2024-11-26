"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContentOp = void 0;
const ContentOp = {
    before(node, _ctx$, buildctx) {
        if (null == node.name) {
            const content = buildctx.current.content = node;
            buildctx.current.file.content.push(content.content);
        }
        else {
            let contentMap = buildctx.current.file.meta.content_map = (buildctx.current.file.meta.content_map || {});
            contentMap[node.name] = (contentMap[node.name] || []);
            contentMap[node.name].push(node.content);
            // console.log('CN', node.name, contentMap)
        }
    },
    after(_node, _ctx$, buildctx) { },
};
exports.ContentOp = ContentOp;
//# sourceMappingURL=ContentOp.js.map