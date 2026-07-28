"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Inject = void 0;
const jostraca_1 = require("../jostraca");
const DEFAULT_MARKERS = ['#--START--#\n', '\n#--END--#'];
// Resolve the marker pair, rejecting a half-specified one.
//
// The markers become a `start(.*?)end` regex, and an empty marker turns
// that into a zero-width match — which is not a marker, it is regex
// fallout. An empty START matched at position 0 and replaced everything up
// to the end marker; an empty PAIR interleaved the injected body between
// every single character of the file. Neither was designed, neither is
// usable, and the Go port could not reproduce either (its scan loop hung
// outright on an empty start marker, since nothing advanced).
//
// So: a pair with exactly one empty marker is rejected, and a pair with
// both empty is treated as "not supplied" — which is what the Go port
// already did, and is the only reading that lets both stacks agree.
function markersOf(markers) {
    if (null == markers) {
        return DEFAULT_MARKERS;
    }
    const start = null == markers[0] ? '' : '' + markers[0];
    const end = null == markers[1] ? '' : '' + markers[1];
    if ('' === start && '' === end) {
        return DEFAULT_MARKERS;
    }
    if ('' === start || '' === end) {
        throw new Error('Inject: both markers must be non-empty, got ' +
            JSON.stringify([start, end]));
    }
    return [start, end];
}
const Inject = (0, jostraca_1.cmp)(function Inject(props, children) {
    const node = props.ctx$.node;
    node.kind = 'inject';
    node.name = props.name;
    node.meta.markers = markersOf(props.markers);
    node.exclude = null == props.exclude ? node.exclude : !!props.exclude;
    (0, jostraca_1.each)(children, { call: true });
});
exports.Inject = Inject;
//# sourceMappingURL=Inject.js.map