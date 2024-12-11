"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Fragment = void 0;
const node_path_1 = __importDefault(require("node:path"));
const jostraca_1 = require("../jostraca");
const gubu_1 = require("gubu");
const From = (from, _, s) => s.ctx.fs.statSync(from);
const FragmentShape = (0, gubu_1.Gubu)({
    ctx$: Object,
    from: (0, gubu_1.Check)(From).String(),
    exclude: (0, gubu_1.Optional)((0, gubu_1.One)(Boolean, [String])),
    indent: (0, gubu_1.Optional)((0, gubu_1.One)(String, Number)),
    replace: {},
}, { name: 'Fragment' });
const Fragment = (0, jostraca_1.cmp)(function Fragment(props, children) {
    props = FragmentShape(props, { fs: props.ctx$.fs });
    const node = props.ctx$.node;
    node.kind = 'fragment';
    node.from = props.from;
    node.indent = props.indent;
    const replace = props.replace || {};
    const { fs, folder, model } = props.ctx$;
    let frompath = node.from;
    // TODO: this is relative to the output - but that is just one case - provide more control?
    if (!node_path_1.default.isAbsolute(frompath)) {
        frompath = node_path_1.default.join(folder, ...node.path, frompath);
    }
    let src = fs.readFileSync(frompath, 'utf8');
    const slotnames = {};
    node.filter = (({ props, component }) => (('Slot' === component.name ? slotnames[props.name] = true : null), false));
    (0, jostraca_1.each)(children, { call: true });
    node.filter = undefined;
    replace['/[ \\t]*[-<!/#*]*[ \\t]*<\\[SLOT]>[ \\t]*[->/#*]*[ \\t]*/'] =
        () => {
            node.filter = (({ component }) => 'Slot' !== component.name);
            (0, jostraca_1.each)(children, { call: true });
            node.filter = undefined;
        };
    (0, jostraca_1.each)(slotnames, (slot) => {
        replace['/[ \\t]*[-<!/#*]*[ \\t]*<\\[SLOT:' +
            (0, jostraca_1.escre)(slot.key$) +
            ']>[ \\t]*[->/#*]*[ \\t]*/'] = () => {
            node.filter = (({ props, component }) => 'Slot' === component.name && slot.key$ === props.name);
            (0, jostraca_1.each)(children, { call: true });
            node.filter = undefined;
        };
    });
    (0, jostraca_1.template)(src, model, {
        replace,
        handle: (s) => null == s ? null : (0, jostraca_1.Content)(s)
    });
});
exports.Fragment = Fragment;
//# sourceMappingURL=Fragment.js.map