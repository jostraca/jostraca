"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Slot = void 0;
const jostraca_1 = require("../jostraca");
const Slot = (0, jostraca_1.cmp)(function Slot(props, children) {
    const node = props.ctx$.node;
    node.kind = 'slot';
    node.name = props.name;
    (0, jostraca_1.each)(children, { call: true });
});
exports.Slot = Slot;
//# sourceMappingURL=Slot.js.map