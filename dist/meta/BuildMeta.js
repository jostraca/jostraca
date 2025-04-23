"use strict";
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _BuildMeta_bctx, _BuildMeta_prev, _BuildMeta_next;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BuildMeta = void 0;
const node_path_1 = __importDefault(require("node:path"));
// Handle loading, recording,and saving of build meta data
class BuildMeta {
    constructor(bctx) {
        _BuildMeta_bctx.set(this, void 0);
        _BuildMeta_prev.set(this, void 0);
        _BuildMeta_next.set(this, void 0);
        __classPrivateFieldSet(this, _BuildMeta_bctx, bctx, "f");
        // file folder and name default can be overriden by jopts
        __classPrivateFieldSet(this, _BuildMeta_prev, {
            foldername: '.jostraca',
            filename: 'jostraca.meta.log',
            last: -1,
            hlast: -1,
            files: {}
        }, "f");
        __classPrivateFieldSet(this, _BuildMeta_prev, loadMetaData(__classPrivateFieldGet(this, _BuildMeta_bctx, "f"), __classPrivateFieldGet(this, _BuildMeta_prev, "f")), "f");
        // TODO: load prev if exists
        __classPrivateFieldSet(this, _BuildMeta_next, {
            foldername: __classPrivateFieldGet(this, _BuildMeta_prev, "f").foldername,
            filename: __classPrivateFieldGet(this, _BuildMeta_prev, "f").filename,
            last: -1,
            hlast: -1,
            files: {}
        }, "f");
    }
    last() {
        return __classPrivateFieldGet(this, _BuildMeta_prev, "f").last;
    }
    // TODO: perhaps?
    get(file) {
        // get prev file meta data, if any
        // returns file meta
    }
    add(file, meta) {
        // add file to next buildmetadata
        // meta is size, write time, excluded, etc
    }
    done() {
        __classPrivateFieldGet(this, _BuildMeta_next, "f").last = Date.now();
        // this.#next.hlast = humanify(this.#next.last)
        // save over previous
        saveMetaData(__classPrivateFieldGet(this, _BuildMeta_bctx, "f"), __classPrivateFieldGet(this, _BuildMeta_next, "f"));
        return __classPrivateFieldGet(this, _BuildMeta_next, "f");
    }
}
exports.BuildMeta = BuildMeta;
_BuildMeta_bctx = new WeakMap(), _BuildMeta_prev = new WeakMap(), _BuildMeta_next = new WeakMap();
function loadMetaData(bctx, bmeta) {
    const metapath = node_path_1.default.join(bmeta.foldername, bmeta.filename);
    if (bctx.fh.existsFile(metapath)) {
        const json = bctx.fh.loadJSON(metapath);
        bmeta.last = json.last;
        bmeta.hlast = json.hlast;
        bmeta.files = json.files;
    }
    return bmeta;
}
function saveMetaData(bctx, bmeta) {
    const metapath = node_path_1.default.join(bmeta.foldername, bmeta.filename);
    bctx.fh.saveJSON(metapath, bmeta);
}
//# sourceMappingURL=BuildMeta.js.map