"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FRAGMENT_PROPS = exports.Fragment = void 0;
const node_path_1 = __importDefault(require("node:path"));
const jostraca_1 = require("../jostraca");
const shape_1 = require("shape");
const bytes_1 = require("../util/bytes");
const From = (from, _, s) => s.ctx.fs().statSync(from);
// A CLOSED PROP SET HAS TO ADMIT THE ENGINE'S OWN BINDINGS. A parent
// binds values for one invocation of its children -- `ListItems` binds
// `item`, `indent` and `replace`, which is what makes `{item.path}`
// mean anything -- and a HAND-WRITTEN child takes them as its parameter
// and passes on whichever it wants. A DATA child has no parameter list,
// so `cmpTree` merges them under the node's own props, and this shape
// then met an `item` it had never heard of and refused a legitimate
// tree: a Fragment repeated once per entity is an ordinary generator.
//
// `item` is accepted and not read, which is why it is here and not in
// `FragmentProps`: a props type says what a CALLER writes, and nobody
// writes a binding. `indent` and `replace` are both.
//
// NO `exclude`. It was declared here, validated, and read by nothing on
// either side -- the component reference said so in as many words
// ("Validated and then never read. It has no effect."). A prop the
// types now promise has to be a prop the code keeps, so it goes rather
// than becoming the one declaration that means nothing. A tree that
// passes it is refused by name from here on, which is the diagnostic it
// should have had all along.
const FragmentSpec = {
    ctx$: Object,
    from: (0, shape_1.Check)(From).String(),
    indent: (0, shape_1.Optional)((0, shape_1.One)((0, shape_1.Empty)(String), Number)),
    replace: {},
    eject: (0, shape_1.Optional)([(0, shape_1.One)(String, RegExp)]),
    item: (0, shape_1.Skip)(),
};
// The props a data node may state: the closed set less the context the
// define phase adds. `cmpTree` checks a node against it when it reads
// the tree, so a malformed node is refused even if it never runs.
const FRAGMENT_PROPS = Object.keys(FragmentSpec).filter((k) => 'ctx$' !== k);
exports.FRAGMENT_PROPS = FRAGMENT_PROPS;
const FragmentShape = (0, shape_1.Shape)(FragmentSpec, { name: 'Fragment' });
// Discard a replace function's return value when the call emitted
// components. See the note at its use in `Fragment`.
//
// `ctx$.children` is the sibling array the define phase appends to, and
// `cmp` restores it after every nested component, so the array this reads
// before the call is the one it reads after.
function emitWins(ctx$, fn) {
    return function (...args) {
        const siblings = ctx$.children;
        const before = null == siblings ? -1 : siblings.length;
        const out = fn.apply(this, args);
        const after = null == ctx$.children ? -1 : ctx$.children.length;
        return (siblings === ctx$.children && before < after) ? undefined : out;
    };
}
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
    // A REPLACE FUNCTION THAT EMITS IS A VOID FUNCTION, whatever it
    // happens to return.
    //
    // In a Fragment, a replace function's job is to emit: it calls `Line`,
    // `Content` or a nested component, and the marker is replaced by what
    // those produced. jostraca's own `<[SLOT]>` handlers below are exactly
    // that shape. Its RETURN value is a second, independent channel --
    // return a string and it is inserted at the marker.
    //
    // Nobody writes a handler meaning to use both, but arrow syntax hands
    // one over for free:
    //
    //     '// #Marker': () => each(list, (x) => Line(`${x.name},`))
    //
    // An expression-bodied arrow RETURNS `each`'s value -- an array with
    // one entry per item, each the return of `Line`, which is undefined.
    // A block body (`() => { each(...) }`) is the same generator and
    // returns nothing. The two read identically and behaved identically
    // for as long as a returned array reached the output as its
    // comma-joined elements, which looked close enough to blank to pass
    // unnoticed. Once a non-string return became JSON (so that one value
    // formats one way however it is supplied -- see `template`), the same
    // handler started emitting `[null,null,null,null]` into the middle of
    // generated source: invalid syntax, written with exit 0, and no
    // diagnostic naming the marker or the file.
    //
    // So: if the handler emitted, the emission IS the replacement and the
    // return value is discarded. The two channels can no longer both be
    // live for one marker, and the accidental one loses to the deliberate
    // one. A handler that emits nothing is untouched, which is what keeps
    // the documented `fn -> value` substitution (objects JSONified,
    // scalars verbatim) working exactly as its tests pin it.
    const replace = {};
    for (const rk of Object.keys(props.replace || {})) {
        const rv = props.replace[rk];
        replace[rk] = 'function' === typeof rv ? emitWins(props.ctx$, rv) : rv;
    }
    const { model } = props.ctx$;
    const fs = props.ctx$.fs();
    // Already absolute by here: resolved above, before validation.
    const frompath = node.from;
    // Bytes that are not UTF-8 survive as escapes, and the file the text
    // lands in is then written through encodeText. See util/bytes.
    const decoded = (0, bytes_1.decodeText)(fs.readFileSync(frompath));
    const src = decoded.text;
    if (decoded.escaped) {
        node.meta.escaped = true;
    }
    const slotnames = {};
    // Non-Slot children of a Fragment are the content of the *unnamed*
    // `<[SLOT]>` marker (see README "Fragments and Slots"). If the source
    // has no unnamed marker there is nowhere for them to go, and every
    // stack used to drop them without a word. Track both halves of that
    // condition and report it instead.
    let sawnonslot = false;
    // `sub` is the CHILD's props, not this component's. It was spelled
    // `props` and shadowed the parameter, which reads as though a
    // Fragment had a `name` prop of its own -- it has not, and any tool
    // that reads this file to learn the prop surface was told it did.
    node.filter = (({ props: sub, component }) => (('Slot' === component.name ? slotnames[sub.name] = true : (sawnonslot = true)), false));
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
            node.filter = (({ props: sub, component }) => 'Slot' === component.name && slot.key$ === sub.name);
            (0, jostraca_1.each)(children, { call: true });
            node.filter = undefined;
        };
    });
    // RAW: `template` has already substituted the model and the replace
    // values, so each segment is final text. Templating it again expanded a
    // `$$x$$` that arrived inside a model value, a replace value or a replace
    // function's return, which is the injection `raw` exists to prevent. A
    // plain Content is one pass, and so is a Fragment.
    (0, jostraca_1.template)(src, model, {
        replace,
        eject: props?.eject,
        handle: (s) => null == s ? null : (0, jostraca_1.Content)({ src: s, raw: true })
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