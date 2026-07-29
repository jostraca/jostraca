"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Fragment = void 0;
const node_path_1 = __importDefault(require("node:path"));
const jostraca_1 = require("../jostraca");
const shape_1 = require("shape");
const From = (from, _, s) => s.ctx.fs().statSync(from);
const FragmentShape = (0, shape_1.Shape)({
    ctx$: Object,
    from: (0, shape_1.Check)(From).String(),
    exclude: (0, shape_1.Optional)((0, shape_1.One)(Boolean, [String])),
    indent: (0, shape_1.Optional)((0, shape_1.One)((0, shape_1.Empty)(String), Number)),
    replace: {},
    eject: (0, shape_1.Optional)([(0, shape_1.One)(String, RegExp)])
}, { name: 'Fragment' });
const Fragment = (0, jostraca_1.cmp)(function Fragment(props, children) {
    // Resolve a relative `from` BEFORE validating.
    //
    // The `from` check stats the path, and it used to stat the raw relative
    // string — so it resolved against the process CWD and a relative `from`
    // threw a validation error no matter where the file actually was. The
    // resolution further down (which joined `node.path`, and so looked under
    // the *enclosing file's name* as though it were a directory) was
    // unreachable.
    //
    // Relative paths now resolve against the output folder, which is
    // predictable and matches the Go port.
    if ('string' === typeof props.from && !node_path_1.default.isAbsolute(props.from)) {
        props = { ...props, from: node_path_1.default.join(props.ctx$.folder, props.from) };
    }
    props = FragmentShape(props, { fs: props.ctx$.fs });
    const node = props.ctx$.node;
    node.kind = 'fragment';
    node.from = props.from;
    node.indent = props.indent;
    const replace = props.replace || {};
    const { model } = props.ctx$;
    const fs = props.ctx$.fs();
    // Already absolute by here: resolved above, before validation.
    const frompath = node.from;
    let src = fs.readFileSync(frompath, 'utf8');
    const slotnames = {};
    // Non-Slot children of a Fragment are the content of the *unnamed*
    // `<[SLOT]>` marker (see README "Fragments and Slots"). If the source
    // has no unnamed marker there is nowhere for them to go, and every
    // stack used to drop them without a word. Track both halves of that
    // condition and report it instead.
    let sawnonslot = false;
    node.filter = (({ props, component }) => (('Slot' === component.name ? slotnames[props.name] = true : (sawnonslot = true)), false));
    (0, jostraca_1.each)(children, { call: true });
    node.filter = undefined;
    // Set from inside the replacement itself rather than by re-testing the
    // marker regex against the source: template() owns the matching, so
    // asking template is the only way to be sure the check and the
    // substitution can never disagree.
    let defaultslot = false;
    replace['/[ \\t]*[-<!/#*]*[ \\t]*<\\[SLOT]>[ \\t]*[->/#*]*[ \\t]*/'] =
        () => {
            defaultslot = true;
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
        eject: props?.eject,
        handle: (s) => null == s ? null : (0, jostraca_1.Content)(s)
    });
    if (sawnonslot && !defaultslot) {
        throw new Error('jostraca: Fragment has non-Slot children, but ' + frompath +
            ' contains no unnamed <[SLOT]> marker to receive them; their output ' +
            'would be silently discarded. Add an unnamed <[SLOT]> marker to the ' +
            'fragment source, or wrap the children in a named Slot.');
    }
});
exports.Fragment = Fragment;
//# sourceMappingURL=Fragment.js.map