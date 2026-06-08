"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Content = void 0;
const jostraca_1 = require("../jostraca");
const Content = (0, jostraca_1.cmp)(function Content(props, children) {
    const node = props.ctx$.node;
    node.kind = 'content';
    node.indent = props.indent;
    let src = null != props.arg ? props.arg :
        null != props.src ? props.src :
            'string' === typeof children ? children : '';
    let model = {
        ...props.ctx$.model,
        ...(props.extra || {})
    };
    src = (0, jostraca_1.template)(src, model, {
        replace: props.replace
    });
    node.content = src;
    node.name = props.name;
});
exports.Content = Content;
//# sourceMappingURL=Content.js.map