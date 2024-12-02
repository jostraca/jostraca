"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.List = void 0;
const jostraca_1 = require("../jostraca");
const List = (0, jostraca_1.cmp)(function List(props, children) {
    const node = props.ctx$.node;
    node.kind = 'content';
    const indent = node.indent = props.indent;
    const item = props.item;
    // TODO: after cmp processing children should ALWAYS be an array
    children = Array.isArray(children) ? children : [children];
    children = children.map((child) => 'string' === typeof child ?
        ({ indent, replace }) => (0, jostraca_1.Content)({ indent, replace }) : child);
    (0, jostraca_1.each)(item, (item) => (0, jostraca_1.each)(children, {
        call: true, args: {
            item,
            indent,
            // TODO: test!
            replace: {
                '/{item(\\.(?<path>[^}]+))?}/': ({ path }) => (0, jostraca_1.getx)(item, path)
            }
        }
    }));
    if (false !== props.line) {
        (0, jostraca_1.Line)('');
    }
});
exports.List = List;
//# sourceMappingURL=List.js.map