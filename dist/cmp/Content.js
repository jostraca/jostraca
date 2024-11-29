"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Content = void 0;
const jostraca_1 = require("../jostraca");
const Content = (0, jostraca_1.cmp)(function Content(props, children) {
    const node = props.ctx$.node;
    node.kind = 'content';
    let src = null != props.arg ? props.arg :
        null != props.src ? props.src :
            'string' === typeof children ? children : '';
    src = (0, jostraca_1.template)(src, props.ctx$.model, {
        replace: props.replace
    });
    node.content = src;
    node.name = props.name;
});
exports.Content = Content;
//# sourceMappingURL=Content.js.map