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
    // Output paths already claimed by a File this run. See claimFile.
    filepaths;
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
        this.filepaths = new Map();
        this.fh = new FileHandler_1.FileHandler(this, existing, control);
        this.bmeta = new BuildMeta_1.BuildMeta(this.fh);
    }
    addmeta(file, meta) {
        this.bmeta.add(file, meta);
    }
    // TWO FILES AT ONE PATH IS REFUSED, not resolved. The second silently
    // won and the first was never written -- output missing, exit 0, and
    // nothing said which component lost. The same guard `aontu render`
    // holds over its unit paths, on the side that owns files.
    //
    // HERE RATHER THAN IN cmpTree, deliberately. `cmpTree` is where a
    // data tree asked for it, and the path is not known there: a `File`
    // name is composed with whatever `Project` and `Folder` nesting
    // encloses it, and under `ListItems` the same node is invoked once
    // per item. Deciding it from the tree would mean a second
    // implementation of path composition, which is the one thing
    // `cmpTree` is built not to have. The build phase is where the path
    // is final, so the guard is one implementation and covers every road
    // in -- a hand-written generator, a data tree, and whatever comes
    // next -- rather than only the road that asked.
    //
    // IT IS THE `File` NODES ONLY. `Inject` writes to a path too, and
    // legitimately writes to one a `File` in the same run created:
    // FileHandler's own `savedPaths` sees both and can only warn. This
    // sees the two statements that cannot both be true.
    //
    // `where` is the tree path of the node, which is the only handle a
    // data tree gives a reader.
    claimFile(fullpath, where, errmark) {
        const already = this.filepaths.get(fullpath);
        if (undefined !== already) {
            throw new Error('ERROR:' + errmark +
                ' two File components resolve to the same output path, path=' +
                fullpath + ', first=' + (already || '<root>') +
                ', second=' + (where || '<root>'));
        }
        this.filepaths.set(fullpath, where);
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
            // From the handler's canonical folder, not the raw option, so the
            // baselines sit under the same folder the files do.
            this.dfolder =
                node_path_1.default.normalize(node_path_1.default.join(this.fh.folder, this.bmeta.next.foldername, 'generated'));
        }
        return this.dfolder;
    }
}
exports.BuildContext = BuildContext;
function emptyNode() {
    return { kind: 'none', path: [], meta: {}, content: [] };
}
//# sourceMappingURL=BuildContext.js.map