"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BuildMeta = void 0;
const node_path_1 = __importDefault(require("node:path"));
const basic_1 = require("../util/basic");
// Handle loading, recording,and saving of build meta data
class BuildMeta {
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
            this.fh.saveFile(node_path_1.default.join(this.next.foldername, '.gitignore'), `
${this.next.filename}
generated
`);
        }
        return this.next;
    }
}
exports.BuildMeta = BuildMeta;
function loadMetaData(fh, bmeta) {
    const metapath = node_path_1.default.join(bmeta.foldername, bmeta.filename);
    if (fh.existsFile(metapath)) {
        const json = fh.loadJSON(metapath);
        bmeta.last = json.last;
        bmeta.hlast = json.hlast;
        bmeta.files = json.files;
    }
    return bmeta;
}
function saveMetaData(fh, bmeta) {
    const metapath = node_path_1.default.join(bmeta.foldername, bmeta.filename);
    fh.saveJSON(metapath, bmeta);
}
//# sourceMappingURL=BuildMeta.js.map