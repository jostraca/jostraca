"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BuildMeta = void 0;
const node_path_1 = __importDefault(require("node:path"));
const basic_1 = require("../util/basic");
// Log non-fatal weirdness.
const dlog = (0, basic_1.getdlog)('jostraca', __filename);
// Handle loading, recording,and saving of build meta data
class BuildMeta {
    fh;
    prev;
    next;
    constructor(fh) {
        this.fh = fh;
        // TODO: file folder and name default can be overriden by jopts
        this.prev = {
            foldername: '.jostraca',
            filename: 'jostraca.meta.log',
            last: -1,
            hlast: -1,
            files: {}
        };
        this.prev = loadMetaData(this.fh, this.prev);
        // TODO: load prev if exists
        this.next = {
            foldername: this.prev.foldername,
            filename: this.prev.filename,
            last: -1,
            hlast: -1,
            files: {}
        };
    }
    last() {
        return this.prev.last;
    }
    add(file, meta) {
        const rfile = this.fh.relative(file, 'BuildMeta.add');
        this.next.files[rfile] = meta;
    }
    done() {
        this.next.last = this.fh.now();
        this.next.hlast = (0, basic_1.humanify)(this.next.last);
        // save over previous
        saveMetaData(this.fh, this.next);
        if (false === this.fh.control.version) {
            this.fh.saveFile(node_path_1.default.join(this.fh.folder, this.next.foldername, '.gitignore'), `
${this.next.filename}
generated
`);
        }
        return this.next;
    }
}
exports.BuildMeta = BuildMeta;
function loadMetaData(fh, bmeta) {
    // Full (folder-prefixed) path: the FileHandler FS methods use paths
    // directly and no longer re-join `this.folder`.
    const metapath = node_path_1.default.join(fh.folder, bmeta.foldername, bmeta.filename);
    if (fh.existsFile(metapath)) {
        try {
            const json = fh.loadJSON(metapath);
            bmeta.last = null == json?.last ? -1 : json.last;
            bmeta.hlast = null == json?.hlast ? -1 : json.hlast;
            bmeta.files = json?.files || {};
        }
        catch (err) {
            // A truncated or hand-edited meta log used to throw straight out of
            // the BuildMeta constructor, so a corrupt bookkeeping file blocked
            // generation entirely — with a JSON parse error that says nothing
            // about how to recover. The log is regenerated on every run, so
            // starting from empty state is safe: the only cost is that merge
            // baselines look absent for one run.
            dlog('meta', 'unreadable meta log, continuing with empty state: ' +
                metapath + ' err=' + err.message);
            bmeta.last = -1;
            bmeta.hlast = -1;
            bmeta.files = {};
        }
    }
    return bmeta;
}
function saveMetaData(fh, bmeta) {
    // Full (folder-prefixed) path: the FileHandler FS methods use paths
    // directly and no longer re-join `this.folder`.
    const metapath = node_path_1.default.join(fh.folder, bmeta.foldername, bmeta.filename);
    fh.saveJSON(metapath, bmeta);
}
//# sourceMappingURL=BuildMeta.js.map