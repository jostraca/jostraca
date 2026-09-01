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
    // A STRING child is wrapped in a function that renders it, so it reaches
    // the same per-item `args` a function child does and can interpolate
    // `{item.path}` like one.
    //
    // `src` used to be missing from that Content call, so the string was
    // captured by the typeof test and then dropped on the floor: the wrapper
    // rendered an empty Content and a whole string child emitted nothing at
    // all. `List({item: [...]}, 'n={item.n}\n')` produced just the trailing
    // newline. Nothing caught it because no fixture, test or doc example
    // passes a string child - the component reference documents only the
    // function form. See #44.
    children = children.map((child) => 'string' === typeof child ?
        ({ indent, replace }) => (0, jostraca_1.Content)({ src: child, indent, replace }) :
        child);
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