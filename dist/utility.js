"use strict";
/* Copyright (c) 2024 Richard Rodger, MIT License */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BINARY_EXT = void 0;
exports.each = each;
exports.select = select;
exports.get = get;
exports.getx = getx;
exports.camelify = camelify;
exports.snakify = snakify;
exports.kebabify = kebabify;
exports.cmap = cmap;
exports.vmap = vmap;
exports.names = names;
// Iterate over arrays and objects (opinionated mutation!).
function each(subject, // Iterate over subject.
flags, apply) {
    const isArray = Array.isArray(subject);
    const hasFlags = null != flags && 'function' !== typeof flags;
    apply = (hasFlags ? apply : flags);
    flags = (hasFlags ? flags : {});
    flags.mark = null != flags.mark ? flags.mark : true;
    flags.oval = null != flags.oval ? flags.oval : true;
    flags.sort = null != flags.sort ? flags.sort : false;
    flags.call = null != flags.call ? flags.call : false;
    let out = [];
    if (isArray) {
        for (let fn of subject) {
            out.push(flags.call && 'function' === typeof fn ? fn() : fn);
        }
        out = true === flags.sort && 1 < out.length ? out.sort() : out;
        out = flags.oval ? out.map((n) => (null != n && 'object' === typeof n) ? n : { val$: n }) : out;
        out = 'string' === typeof flags.sort ?
            out.sort((a, b) => (a?.[flags.sort] < b?.[flags.sort] ? -1 :
                a?.[flags.sort] > b?.[flags.sort] ? 1 : 0)) : out;
        out = flags.mark ? out
            .map((n, i, _) => (_ = typeof n, (null != n && 'object' === _ ? (n.index$ = i) : null), n)) : out;
        if ('function' === typeof apply) {
            out = out.map((n, ...args) => apply(n, ...args));
        }
        return out;
    }
    const isObject = null != subject && 'object' === typeof subject;
    if (!isObject) {
        return out;
    }
    let entries = Object.entries(subject);
    if (flags.call) {
        entries = entries.map((n) => ((n[1] = 'function' === typeof n[1] ? n[1]() : n[1]), n));
    }
    if (flags.oval) {
        out = entries.map((n, _) => (_ = typeof n[1],
            (null != n[1] && 'object' === _) ? n[1] :
                (n[1] = { key$: n[0], val$: n[1] }), n));
    }
    if (flags.mark) {
        entries.map((n, _) => (_ = typeof n[1],
            (null != n[1] && 'object' === _) ? (n[1].key$ = n[0]) : n[1], n));
    }
    if (1 < entries.length && flags.sort) {
        if (null != entries[0][1] && 'object' === typeof entries[0][1]) {
            let sprop = 'string' === flags.sort ? flags.sort : 'key$';
            entries.sort((a, b) => a[1]?.[sprop] < b[1]?.[sprop] ? -1 : b[1]?.[sprop] < a[1]?.[sprop] ? 1 : 0);
        }
        else {
            entries.sort((a, b) => a[1] < b[1] ? -1 : b[1] < a[1] ? 1 : 0);
        }
    }
    if ('function' === typeof apply) {
        out = entries.map((n, ...args) => apply(n[1], n[0], ...args));
    }
    else {
        out = entries.map((n) => n[1]);
    }
    return out;
}
function select(key, map) {
    const fn = map && map[key];
    return fn ? fn() : undefined;
}
function getx(root, path) {
    if (null == root || 'object' !== typeof root) {
        return undefined;
    }
    let tokens;
    if (Array.isArray(path)) {
        tokens = path.map(p => '' + p);
    }
    else if ('string' === typeof path) {
        //         A   B               C        D   E
        let tre = /\s*("(\\.|[^"\\])*"|[\w\d_]+|\s+|[^\w\d_]+)\s*/g;
        // A: prefixing space and/or comma
        // B: quoted string
        // C: atom
        // D: space
        // E: operator
        tokens = [];
        let t = null;
        while (t = tre.exec(path)) {
            if (!t[1].match(/\s+|\./)) {
                let token = t[1];
                token = token.match(/^"[^"]+"$/) ? token.substring(1, token.length - 1) : token;
                tokens.push(token);
            }
        }
    }
    else {
        return undefined;
    }
    // console.log('GETX', JSON.stringify(root).replace(/["\n]/g, ''))
    // console.log('TOKENS', tokens)
    let node = root;
    let out = undefined;
    let ancestry = false;
    for (let i = 0; i < tokens.length && undefined !== node; i++) {
        let t0 = tokens[i];
        let t1 = tokens[i + 1];
        // let what = ''
        // console.log('PART-S  ', ancestry ? ':' : ' ', i, t0 + '|' + t1 + '|' + tokens.slice(i + 2),
        //   ' N=', JSON.stringify(node || '').replace(/["\n]/g, ''),
        //   ' O=', JSON.stringify(out || '').replace(/["\n]/g, ''))
        if (t1 && t1.match(/=|!=/)) {
            // what = 'O'
            let val = node[t0];
            let arg = tokens[i + 2];
            const argtype = typeof arg;
            arg =
                'true' === arg ? true :
                    'false' === arg ? false :
                        'string' === argtype ?
                            (arg.match(/^"[^"]+"$/) ? arg.substring(1, arg.length - 1) : arg) : arg;
            let pass = false;
            switch (t1) {
                case '<':
                    if (val < arg)
                        pass = true;
                    break;
                case '<=':
                    if (val <= arg)
                        pass = true;
                    break;
                case '>':
                    if (val > arg)
                        pass = true;
                    break;
                case '>=':
                    if (val >= arg)
                        pass = true;
                    break;
                case '=':
                    if (val == arg)
                        pass = true;
                    break;
                case '==':
                    if (val === arg)
                        pass = true;
                    break;
                case '!=':
                    if (val != arg)
                        pass = true;
                    break;
                case '~':
                    if (String(val).match(RegExp(arg)))
                        pass = true;
                    break;
            }
            if (pass) {
                i += 2;
            }
            else {
                node = undefined;
            }
            out = (ancestry && undefined !== node) ? out : node;
        }
        // Retain ancestry in result - getx({a:{b:1}},'a:b'}) === {a:{b:1}}
        else if (':' === t1) {
            // what = 'D'
            if ('=' !== tokens[i + 2]) {
                out = !ancestry ? node : out;
                node = node[t0];
                if (undefined === node) {
                    out = undefined;
                }
            }
            ancestry = true;
            i++;
        }
        else if ('?' === t0) {
            // what = '?'
            let ftokens = tokens.slice(i + 1);
            // console.log('FTOKENS A', ftokens)
            // Two adjacent values marks the end of the filter
            // TODO: not great, find a better way
            let j = 0;
            for (; j < ftokens.length; j++) {
                if (ftokens[j] && ftokens[j].match(/[\w\d_]+/) &&
                    ftokens[j + 1] && ftokens[j + 1].match(/[\w\d_]+/)) {
                    j++;
                    break;
                }
            }
            ftokens.length = j;
            // console.log('FTOKENS B', ftokens)
            out = each(node)
                .filter((child) => undefined != getx(child, ftokens));
            if (null != node && 'object' === typeof node) {
                if (Array.isArray(node)) {
                    out = out.map((n) => (delete n.index$, n));
                }
                else {
                    out = out.reduce((a, n) => (a[n.key$] = n, delete n.key$, a), {});
                }
            }
            node = out;
            i += ftokens.length;
        }
        else if (null != t1) {
            // what = 'N'
            // console.log('NNN', dot, t0, out, node)
            // out = (dot && undefined !== node) ? out : node
            node = node[t0];
            if (ancestry) {
                ancestry = false;
                out = undefined !== node ? out : undefined;
                node = out;
            }
        }
        else {
            // what = 'M'
            node = node[t0];
            out = (ancestry && undefined !== node) ? out : node;
        }
        // console.log('PART-E', what,
        //   ancestry ? ':' : ' ', i, t0 + '|' + t1 + '|' + tokens.slice(i + 2),
        //   ' N=', JSON.stringify(node || '').replace(/["\n]/g, ''),
        //   ' O=', JSON.stringify(out || '').replace(/["\n]/g, ''))
    }
    return out;
}
function get(root, path) {
    path = 'string' === typeof path ? path.split('.') : path;
    let node = root;
    for (let i = 0; i < path.length && null != node; i++) {
        node = node[path[i]];
    }
    return node;
}
function camelify(input) {
    let parts = 'string' == typeof input ? input.split('-') : input.map(n => '' + n);
    return parts
        .map((p) => ('' === p ? '' : (p[0].toUpperCase() + p.substring(1))))
        .join('');
}
function kebabify(input) {
    let parts = 'string' == typeof input ? input.split(/([A-Z])/) : input.map(n => '' + n);
    return parts
        .filter((p) => '' !== p)
        .reduce((a, n, i) => ((0 === i % 2 ? a.push(n.toLowerCase()) : a[(i / 2) | 0] += n), a), [])
        .join('-');
}
function snakify(input) {
    let parts = 'string' == typeof input ? input.split(/([A-Z])/) : input.map(n => '' + n);
    return parts
        .filter((p) => '' !== p)
        .reduce((a, n, i) => ((0 === i % 2 ? a.push(n.toLowerCase()) : a[(i / 2) | 0] += n), a), [])
        .join('_');
}
function names(base, name, prop = 'name') {
    base.name$ = name;
    base[prop.toLowerCase()] = name.toLowerCase();
    base[camelify(prop)] = camelify(name);
    base[snakify(prop)] = snakify(name);
    base[kebabify(prop)] = kebabify(name);
    base[prop.toUpperCase()] = name.toUpperCase();
}
// Map child objects to new child objects
function cmap(o, p) {
    return Object
        .entries(o)
        .reduce((r, n, _) => (_ = Object
        .entries(p)
        .reduce((s, m) => (cmap.FILTER === s ? s : (s[m[0]] = (
    // transfom(val,key,current,parentkey,parent)
    'function' === typeof m[1] ? m[1](n[1][m[0]], {
        skey: m[0], self: n[1], key: n[0], parent: o
    }) : m[1]), (cmap.FILTER === s[m[0]] ? cmap.FILTER : s))), {})
        , (cmap.FILTER === _ ? 0 : r[n[0]] = _), r), {});
}
cmap.COPY = (x) => x;
// keep self if x is truthy, or function returning truthy-new-value or [truthy,new-value]
cmap.FILTER = (x) => 'function' === typeof x ? ((y, p, _) => (_ = x(y, p), Array.isArray(_) ? !_[0] ? _[1] : cmap.FILTER : _)) : (x ? x : cmap.FILTER);
cmap.KEY = (_, p) => p.key;
// Map child objects to a list of child objects
function vmap(o, p) {
    return Object
        .entries(o)
        .reduce((r, n, _) => (_ = Object
        .entries(p)
        .reduce((s, m) => (vmap.FILTER === s ? s : (s[m[0]] = (
    // transfom(val,key,current,parentkey,parent)
    // 'function' === typeof m[1] ? m[1](n[1][m[0]], m[0], n[1], n[0], o) : m[1]
    'function' === typeof m[1] ? m[1](n[1][m[0]], {
        skey: m[0], self: n[1], key: n[0], parent: o
    }) : m[1]), (vmap.FILTER === s[m[0]] ? vmap.FILTER : s))), {})
        , (vmap.FILTER === _ ? 0 : r.push(_)), r), []);
}
vmap.COPY = (x) => x;
vmap.FILTER = (x) => 'function' === typeof x ? ((y, p, _) => (_ = x(y, p), Array.isArray(_) ? !_[0] ? _[1] : vmap.FILTER : _)) : (x ? x : vmap.FILTER);
vmap.KEY = (_, p) => p.key;
/*
  MIT License
 
  Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)
  Copyright (c) Paul Miller (https://paulmillr.com)
 
  Thank You!
*/
const BINARY_EXT = [
    "3dm",
    "3ds",
    "3g2",
    "3gp",
    "7z",
    "a",
    "aac",
    "adp",
    "afdesign",
    "afphoto",
    "afpub",
    "ai",
    "aif",
    "aiff",
    "alz",
    "ape",
    "apk",
    "appimage",
    "ar",
    "arj",
    "asf",
    "au",
    "avi",
    "bak",
    "baml",
    "bh",
    "bin",
    "bk",
    "bmp",
    "btif",
    "bz2",
    "bzip2",
    "cab",
    "caf",
    "cgm",
    "class",
    "cmx",
    "cpio",
    "cr2",
    "cur",
    "dat",
    "dcm",
    "deb",
    "dex",
    "djvu",
    "dll",
    "dmg",
    "dng",
    "doc",
    "docm",
    "docx",
    "dot",
    "dotm",
    "dra",
    "DS_Store",
    "dsk",
    "dts",
    "dtshd",
    "dvb",
    "dwg",
    "dxf",
    "ecelp4800",
    "ecelp7470",
    "ecelp9600",
    "egg",
    "eol",
    "eot",
    "epub",
    "exe",
    "f4v",
    "fbs",
    "fh",
    "fla",
    "flac",
    "flatpak",
    "fli",
    "flv",
    "fpx",
    "fst",
    "fvt",
    "g3",
    "gh",
    "gif",
    "graffle",
    "gz",
    "gzip",
    "h261",
    "h263",
    "h264",
    "icns",
    "ico",
    "ief",
    "img",
    "ipa",
    "iso",
    "jar",
    "jpeg",
    "jpg",
    "jpgv",
    "jpm",
    "jxr",
    "key",
    "ktx",
    "lha",
    "lib",
    "lvp",
    "lz",
    "lzh",
    "lzma",
    "lzo",
    "m3u",
    "m4a",
    "m4v",
    "mar",
    "mdi",
    "mht",
    "mid",
    "midi",
    "mj2",
    "mka",
    "mkv",
    "mmr",
    "mng",
    "mobi",
    "mov",
    "movie",
    "mp3",
    "mp4",
    "mp4a",
    "mpeg",
    "mpg",
    "mpga",
    "mxu",
    "nef",
    "npx",
    "numbers",
    "nupkg",
    "o",
    "odp",
    "ods",
    "odt",
    "oga",
    "ogg",
    "ogv",
    "otf",
    "ott",
    "pages",
    "pbm",
    "pcx",
    "pdb",
    "pdf",
    "pea",
    "pgm",
    "pic",
    "png",
    "pnm",
    "pot",
    "potm",
    "potx",
    "ppa",
    "ppam",
    "ppm",
    "pps",
    "ppsm",
    "ppsx",
    "ppt",
    "pptm",
    "pptx",
    "psd",
    "pya",
    "pyc",
    "pyo",
    "pyv",
    "qt",
    "rar",
    "ras",
    "raw",
    "resources",
    "rgb",
    "rip",
    "rlc",
    "rmf",
    "rmvb",
    "rpm",
    "rtf",
    "rz",
    "s3m",
    "s7z",
    "scpt",
    "sgi",
    "shar",
    "snap",
    "sil",
    "sketch",
    "slk",
    "smv",
    "snk",
    "so",
    "stl",
    "suo",
    "sub",
    "swf",
    "tar",
    "tbz",
    "tbz2",
    "tga",
    "tgz",
    "thmx",
    "tif",
    "tiff",
    "tlz",
    "ttc",
    "ttf",
    "txz",
    "udf",
    "uvh",
    "uvi",
    "uvm",
    "uvp",
    "uvs",
    "uvu",
    "viv",
    "vob",
    "war",
    "wav",
    "wax",
    "wbmp",
    "wdp",
    "weba",
    "webm",
    "webp",
    "whl",
    "wim",
    "wm",
    "wma",
    "wmv",
    "wmx",
    "woff",
    "woff2",
    "wrm",
    "wvx",
    "xbm",
    "xif",
    "xla",
    "xlam",
    "xls",
    "xlsb",
    "xlsm",
    "xlsx",
    "xlt",
    "xltm",
    "xltx",
    "xm",
    "xmind",
    "xpi",
    "xpm",
    "xwd",
    "xz",
    "z",
    "zip",
    "zipx"
];
exports.BINARY_EXT = BINARY_EXT;
//# sourceMappingURL=utility.js.map