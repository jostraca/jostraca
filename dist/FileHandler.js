"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileHandler = void 0;
exports.validPath = validPath;
const Diff = require('diff');
const node_path_1 = __importDefault(require("node:path"));
const basic_1 = require("./util/basic");
const CN = 'FileHandler:';
const JOSTRACA_PROTECT = 'JOSTRACA_PROTECT';
class FileHandler {
    constructor(bctx, existing) {
        this.when = bctx.when;
        this.fs = bctx.fs;
        this.folder = bctx.folder;
        this.audit = bctx.audit;
        this.existing = existing;
        this.maxdepth = 22; // TODO: get from JostracaOptions
        this.preserve = [];
        if (!this.fs().existsSync) {
            throw new Error(CN + ' Invalid file system provider: ' + this.fs());
        }
    }
    save(path, content, write = false, whence) {
        const when = Date.now();
        const wstr = null == whence ? '' : whence + ':';
        const fs = this.fs();
        const FN = 'save:';
        const existing = 'string' === typeof content ? this.existing.txt : this.existing.bin;
        path = node_path_1.default.normalize(path);
        const folder = node_path_1.default.dirname(path);
        const exists = fs.existsSync(path);
        write = write || !exists;
        if (exists) {
            let oldcontent = fs.readFileSync(path, 'utf8').toString();
            const protect = 0 <= oldcontent.indexOf(JOSTRACA_PROTECT);
            if (existing.preserve) {
                if (protect) {
                    write = false;
                }
                else if (oldcontent.length !== content.length || oldcontent !== content) {
                    let oldpath = node_path_1.default.join(folder, node_path_1.default.basename(path).replace(/\.[^.]+$/, '') +
                        '.old' + node_path_1.default.extname(path));
                    this.copyFile(path, oldpath, whence);
                    this.preserve.push({ path, action: 'preserve' });
                }
            }
            if (existing.write && !protect) {
                write = true;
            }
            else if (existing.present) {
                if (oldcontent.length !== content.length || oldcontent !== content) {
                    let newpath = node_path_1.default.join(folder, node_path_1.default.basename(path).replace(/\.[^.]+$/, '') +
                        '.new' + node_path_1.default.extname(path));
                    this.saveFile(newpath, content, { flush: true });
                    this.preserve.push({ path, action: 'present' });
                }
            }
            if (existing.diff && !protect) {
                write = false;
                if (oldcontent.length !== content.length || oldcontent !== content) {
                    const cstr = 'string' === typeof content ? content : content.toString('utf8');
                    const diffcontent = this.diff(this.when, cstr, oldcontent);
                    this.saveFile(path, diffcontent);
                    this.audit.push([CN + FN + wstr + ':diff', { path, action: 'diff' }]);
                    // FIX buildctx.file.diff.push({ path, action: 'diff' })
                }
            }
        }
        if (write) {
            this.saveFile(path, content);
            this.audit.push([CN + FN + wstr + ':write', { path, action: 'write' }]);
            // FIX fs.mkdirSync(folder, { recursive: true })
            // FIX fs.writeFileSync(path, content, 'utf8', { flush: true })
            // FIX buildctx.file.write.push({ path, action: 'write' })
        }
    }
    diff(when, oldcontent, newcontent) {
        const difflines = Diff.diffLines(newcontent, oldcontent);
        const out = [];
        const isowhen = new Date(when).toISOString();
        difflines.forEach((part) => {
            if (part.added) {
                out.push('<<<<<< GENERATED: ' + isowhen + '\n');
                out.push(part.value);
                out.push('>>>>>> GENERATED: ' + isowhen + '\n');
            }
            else if (part.removed) {
                out.push('<<<<<< EXISTING: ' + isowhen + '\n');
                out.push(part.value);
                out.push('>>>>>> EXISTING: ' + isowhen + '\n');
            }
            else {
                out.push(part.value);
            }
        });
        const content = out.join('');
        return content;
    }
    existsFile(path, whence) {
        const when = Date.now();
        const wstr = null == whence ? '' : whence + ':';
        const fs = this.fs();
        const FN = 'existsFile:';
        validPath(path, this.maxdepth, CN + FN + 'from:' + wstr);
        const fullpath = node_path_1.default.isAbsolute(path) ? path : node_path_1.default.join(this.folder, path);
        try {
            const exists = fs.existsSync(fullpath);
            this.audit.push([CN + FN + wstr,
                { path, when, exists }]);
            return exists;
        }
        catch (err) {
            this.audit.push(['ERROR:' + CN + FN + wstr,
                { path, when, err }]);
            err.message = CN + FN + wstr + ' path=' + path +
                ' err=' + err.message;
            throw err;
        }
    }
    copyFile(frompath, topath, whence) {
        const when = Date.now();
        const wstr = null == whence ? '' : whence + ':';
        const fs = this.fs();
        const FN = 'copyFile:';
        validPath(frompath, this.maxdepth, CN + FN + 'from:' + wstr);
        validPath(topath, this.maxdepth, CN + FN + 'to:' + wstr);
        const isBinary = (0, basic_1.isbinext)(frompath);
        const fulltopath = node_path_1.default.isAbsolute(topath) ? topath : node_path_1.default.join(this.folder, topath);
        const fullfrompath = node_path_1.default.isAbsolute(frompath) ? frompath : node_path_1.default.join(this.folder, frompath);
        try {
            const existed = fs.existsSync(fulltopath);
            fs.mkdirSync(node_path_1.default.dirname(fulltopath), { recursive: true });
            const content = fs.readFileSync(fullfrompath, isBinary ? undefined : 'utf8');
            fs.writeFileSync(topath, content, { flush: true });
            this.audit.push([CN + FN + wstr,
                { topath, frompath, when, existed, size: content.length }]);
        }
        catch (err) {
            this.audit.push(['ERROR:' + CN + FN + wstr,
                { topath, frompath, when, err }]);
            err.message = CN + FN + wstr + ' topath=' + topath + ' frompath=' + frompath +
                ' err=' + err.message;
            throw err;
        }
    }
    loadFile(path, opts, whence) {
        const when = Date.now();
        const wstr = null == whence ? '' : whence + ':';
        const fs = this.fs();
        const FN = 'loadFile:';
        opts = opts || {};
        opts.encoding = opts.encoding || 'utf8';
        validPath(path, this.maxdepth, CN + FN + wstr);
        try {
            const fullpath = node_path_1.default.isAbsolute(path) ? path : node_path_1.default.join(this.folder, path);
            const content = fs.readFileSync(fullpath, opts);
            this.audit.push([CN + FN + wstr,
                { path, when, size: content.length }]);
            return content;
        }
        catch (err) {
            this.audit.push(['ERROR:' + CN + FN + wstr,
                { path, when, err }]);
            err.message = CN + FN + wstr + ' path=' + path + ' err=' + err.message;
            throw err;
        }
    }
    loadJSON(path, opts, whence) {
        const when = Date.now();
        const wstr = null == whence ? '' : whence + ':';
        const FN = 'loadJSON:';
        opts = opts || {};
        opts.encoding = opts.encoding || 'utf8';
        try {
            const content = this.loadFile(path, opts, whence);
            const cstr = 'string' === typeof content ? content : content.toString(opts.encoding);
            const json = JSON.parse(cstr);
            this.audit.push([CN + FN + wstr,
                { path, when, size: content.length }]);
            return json;
        }
        catch (err) {
            this.audit.push(['ERROR:' + CN + FN + wstr,
                { path, when, err }]);
            err.message = CN + FN + wstr + ' path=' + path + ' err=' + err.message;
            throw err;
        }
    }
    saveJSON(path, json, opts, whence) {
        const when = Date.now();
        const wstr = null == whence ? '' : whence + ':';
        const FN = 'saveJSON:';
        opts = opts || {};
        opts.encoding = opts.encoding || 'utf8';
        try {
            const jstr = 'string' === typeof json ? json : JSON.stringify(json, null, 2);
            this.saveFile(path, jstr, opts, whence);
            this.audit.push([CN + FN + wstr,
                { path, when, size: jstr.length }]);
            return jstr;
        }
        catch (err) {
            this.audit.push(['ERROR:' + CN + FN + wstr,
                { path, when, err }]);
            err.message = CN + FN + wstr + ' path=' + path + ' err=' + err.message;
            throw err;
        }
    }
    saveFile(path, content, opts, whence) {
        const when = Date.now();
        const wstr = null == whence ? '' : whence + ':';
        const fs = this.fs();
        const FN = 'saveFile:';
        opts = opts || {};
        opts.encoding = opts.encoding || ('string' === typeof content ? 'utf8' : undefined);
        validPath(path, this.maxdepth, FN);
        if ('string' !== typeof content) {
            throw new Error(CN + FN + wstr + ' invalid content, path=' + path +
                ' content=' + content);
        }
        try {
            const fullpath = node_path_1.default.isAbsolute(path) ? path : node_path_1.default.join(this.folder, path);
            const parentfolder = node_path_1.default.dirname(fullpath);
            const existed = fs.existsSync(fullpath);
            fs.mkdirSync(parentfolder, { recursive: true });
            fs.writeFileSync(fullpath, content, opts);
            this.audit.push([CN + FN + wstr,
                { path, when, existed, size: content.length }]);
        }
        catch (err) {
            this.audit.push(['ERROR:' + CN + FN + wstr,
                { path, when, size: content.length, err }]);
            err.message = CN + FN + wstr + ' path=' + path + ':' + err.message;
            throw err;
        }
    }
}
exports.FileHandler = FileHandler;
function validPath(path, maxdepth, errmark) {
    if (null == path || '' == path || 'string' !== typeof path) {
        throw new Error('ERROR:' + errmark + ' invalid path, path=' + path);
    }
    const depth = node_path_1.default.normalize(node_path_1.default.dirname(path)).split(node_path_1.default.sep).filter(Boolean).length;
    if (maxdepth < depth) {
        throw new Error(errmark + ' path too deep, path=' + path);
    }
}
//# sourceMappingURL=FileHandler.js.map