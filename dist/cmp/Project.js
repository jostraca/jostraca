"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Project = void 0;
const jostraca_1 = require("../jostraca");
const Project = (0, jostraca_1.cmp)(function Project(props, children) {
    const node = props.ctx$.node;
    node.kind = 'project';
    node.name = props.name;
    node.folder = props.folder;
    (0, jostraca_1.each)(children);
});
exports.Project = Project;
//# sourceMappingURL=Project.js.map