"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BuildContext = void 0;
const FileHandler_1 = require("./FileHandler");
const BuildMeta_1 = require("./meta/BuildMeta");
const None_1 = require("./cmp/None");
const CN = 'BuildContext:';
// TODO: rename meta folder to build, move into build folder
class BuildContext {
    constructor(folder, existing, fs) {
        this.fs = fs;
        if (!this.fs().existsSync) {
            throw new Error(CN + ' Invalid file system provider: ' + this.fs());
        }
        this.audit = [];
        this.root = None_1.None;
        this.when = Date.now();
        this.folder = folder;
        this.current = {
            project: {
                node: emptyNode(),
            },
            folder: {
                node: emptyNode(),
                parent: folder,
                path: [],
            },
            // TODO: should be file.node
            file: emptyNode(),
            content: undefined,
        };
        this.log = { exclude: [], last: -1 };
        this.file = {
            write: [],
            preserve: [],
            present: [],
            diff: [],
        };
        this.fh = new FileHandler_1.FileHandler(this, existing);
        this.bmeta = new BuildMeta_1.BuildMeta(this);
    }
}
exports.BuildContext = BuildContext;
function emptyNode() {
    return { kind: 'none', path: [], meta: {}, content: [] };
}
//# sourceMappingURL=BuildContext.js.map