"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Line = void 0;
const jostraca_1 = require("../jostraca");
const Line = (0, jostraca_1.cmp)(function Line(props, children) {
    const node = props.ctx$.node;
    node.kind = 'content';
    let src = null != props.arg ? props.arg :
        null != props.src ? props.src :
            'string' === typeof children ? children : '';
    src += '\n';
    src = (0, jostraca_1.template)(src, props.ctx$.model);
    node.content = src;
    node.name = props.name;
});
exports.Line = Line;
//# sourceMappingURL=Line.js.map