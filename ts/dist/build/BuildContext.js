"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BuildContext = void 0;
const node_path_1 = __importDefault(require("node:path"));
const FileHandler_1 = require("./FileHandler");
const BuildMeta_1 = require("./BuildMeta");
const CN = 'BuildContext:';
// TODO: rename meta folder to build, move into build folder
class BuildContext {
    fs;
    now;
    bmeta;
    fh;
    audit;
    when;
    vol;
    folder;
    current;
    log;
    dfolder;
    constructor(folder, existing, control, fs, now) {
        this.fs = fs;
        this.now = now;
        if (!this.fs().existsSync) {
            throw new Error(CN + ' Invalid file system provider: ' + this.fs());
        }
        this.audit = [];
        this.when = now();
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
        this.fh = new FileHandler_1.FileHandler(this, existing, control);
        this.bmeta = new BuildMeta_1.BuildMeta(this.fh);
    }
    addmeta(file, meta) {
        this.bmeta.add(file, meta);
    }
    // Folder path segments for the current build position, as a canonical
    // (forward-slash) prefix. When neither a Project nor a Folder has seeded
    // the path, fall back to the base output folder — otherwise a top-level
    // File would join onto '' and resolve to '/<name>' at the filesystem
    // root, ignoring the configured output folder entirely. FolderOp.before
    // applies the same fallback when seeding the path.
    folderPath() {
        const { path, parent } = this.current.folder;
        return 0 < path.length ? path.join('/') : parent;
    }
    duplicateFolder() {
        if (null == this.dfolder) {
            this.dfolder =
                node_path_1.default.normalize(node_path_1.default.join(this.folder, this.bmeta.next.foldername, 'generated'));
        }
        return this.dfolder;
    }
}
exports.BuildContext = BuildContext;
function emptyNode() {
    return { kind: 'none', path: [], meta: {}, content: [] };
}
//# sourceMappingURL=BuildContext.js.map