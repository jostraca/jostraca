"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Inject = void 0;
const jostraca_1 = require("../jostraca");
const Inject = (0, jostraca_1.cmp)(function Inject(props, children) {
    const node = props.ctx$.node;
    node.kind = 'inject';
    node.name = props.name;
    node.meta.markers = props.markers || ['#--START--#\n', '\n#--END--#'];
    node.exclude = null == props.exclude ? node.exclude : !!props.exclude;
    (0, jostraca_1.each)(children, { call: true });
});
exports.Inject = Inject;
//# sourceMappingURL=Inject.js.map