"use strict";
/* Copyright (c) 2024 Richard Rodger, MIT License */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BINARY_EXT = void 0;
exports.camelify = camelify;
exports.cmap = cmap;
exports.each = each;
exports.escre = escre;
exports.get = get;
exports.getx = getx;
exports.humanify = humanify;
exports.indent = indent;
exports.isbinext = isbinext;
exports.kebabify = kebabify;
exports.names = names;
exports.select = select;
exports.snakify = snakify;
exports.template = template;
exports.vmap = vmap;
const node_path_1 = __importDefault(require("node:path"));
// Iterate over arrays and objects (opinionated mutation!).
function each(subject, // Iterate over subject.
spec, apply) {
    const isArray = Array.isArray(subject);
    const hasFlags = null != spec && 'function' !== typeof spec;
    apply = (hasFlags ? apply : spec);
    const rspec = hasFlags ? spec : {};
    const mark = null != rspec.mark ? rspec.mark : true;
    const oval = null != rspec.oval ? rspec.oval : true;
    const sort = null != rspec.sort ? rspec.sort : false;
    const call = null != rspec.call ? rspec.call : false;
    const args = null == rspec.args ? [] : Array.isArray(rspec.args) ? rspec.args : [rspec.args];
    let out = [];
    if (isArray) {
        for (let fn of subject) {
            out.push(call && 'function' === typeof fn ? fn(...args) : fn);
        }
        out = true === sort && 1 < out.length ? out.sort() : out;
        out = oval ? out.map((n) => (null != n && 'object' === typeof n) ? n : { val$: n }) : out;
        out = 'string' === typeof sort ?
            out.sort((a, b) => (a?.[sort] < b?.[sort] ? -1 :
                a?.[sort] > b?.[sort] ? 1 : 0)) : out;
        out = mark ? out
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
    if (call) {
        entries =
            entries.map((n) => ((n[1] = 'function' === typeof n[1] ? n[1](...args) : n[1]), n));
    }
    if (oval) {
        out = entries.map((n, _) => (_ = typeof n[1],
            (null != n[1] && 'object' === _) ? n[1] :
                (n[1] = { key$: n[0], val$: n[1] }), n));
    }
    if (mark) {
        entries.map((n, _) => (_ = typeof n[1],
            (null != n[1] && 'object' === _) ? (n[1].key$ = n[0]) : n[1], n));
    }
    if (1 < entries.length && sort) {
        if (null != entries[0][1] && 'object' === typeof entries[0][1]) {
            let sprop = 'string' === sort ? sort : 'key$';
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
    let node = root;
    let out = undefined;
    let ancestry = false;
    for (let i = 0; i < tokens.length && undefined !== node; i++) {
        let t0 = tokens[i];
        let t1 = tokens[i + 1];
        if (t1 && t1.match(/=|!=/)) {
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
            let ftokens = tokens.slice(i + 1);
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
            node = node[t0];
            if (ancestry) {
                ancestry = false;
                out = undefined !== node ? out : undefined;
                node = out;
            }
        }
        else {
            node = node[t0];
            out = (ancestry && undefined !== node) ? out : node;
        }
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
    name = '' + name;
    base.name$ = name;
    base[prop.toLowerCase()] = name.toLowerCase();
    base[camelify(prop)] = camelify(name);
    base[snakify(prop)] = snakify(name);
    base[kebabify(prop)] = kebabify(name);
    base[prop.toUpperCase()] = name.toUpperCase();
}
function escre(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function idenstr(s) { return s.replace(/[^\w\d]/g, '_'); }
// NOTE: $$foo.bar$$ format used as explicit start and end markers mean regex can be used
// unambiguously ($fooa would not match `foo`)
function template(src, model, spec) {
    src = null == src ? '' : '' + src;
    model = null == model ? {} : model;
    let open = null == spec?.open ? '\\$\\$' : spec.open;
    let close = null == spec?.close ? '\\$\\$' : spec.close;
    let ref = null == spec?.ref ? '[^$]+' : spec.ref;
    let specReplaceMap = spec?.replace || {};
    let specReplaceCanon = {};
    let ngI = 1;
    let insertRE = null == spec?.insert ?
        new RegExp(
        // Match alternate for `$$foo.bar$$` model replacements.
        '(?<J_O>' + open + ')' +
            '(?<J_R>' + ref + ')' +
            '(?<J_C>' + close + ')' +
            // Template replace entries.
            ((Object.keys(specReplaceMap))
                .sort((a, b) => a.startsWith('#') ?
                (a.includes('-') ? b.includes('-') ? b.length - a.length : -1 : b.length - a.length) :
                b.length - a.length)
                .map((k, _) => (
            // console.log(k),
            // Normalize key for use as group name as key could be a regexp ('/foo/' format).
            _ = idenstr(k).replace(/_+/g, '_'),
                specReplaceCanon[_] = specReplaceMap[k],
                // match alternate per key.
                `|(?<J_K${ngI++}_${_}>` +
                    // Custom regexp.
                    (k.match(/^\/.+\/$/) ? k.substring(1, k.length - 1)
                        // Prepend a counter to custom group names to ensure they are unique.
                        .replace(/\(\?<([\w\d_]+)>/g, (_, p1) => `(?<J_N${ngI++}_${p1}>`) :
                        // Tags: #Name matches <indent><comment><space>#Name<space><newline>
                        // #Name-Tag matches same, but inner: #<Identifer>-Tag, and
                        // provides {Tag:<identifer>}
                        // See template utility unit test!
                        (_ = k.match(/^#([A-Za-z0-9]+)(-[A-Z][a-z0-9]+)?$/)) ?
                            ( /*console.log('QQQ', _),*/`(?<J_N${ngI++}_indent>[ \t]*)` +
                                '\\/\\/' +
                                '[ \t]*#' +
                                (_[1] ?
                                    `(?<J_T${ngI++}_${_[2]?.substring(1) || 'TAG'}>` +
                                        (_[2] ? '[A-Za-z0-9]+' : _[1]) + ')' : '') +
                                (_[2] ? `-(?<J_N${ngI++}_TAG>${_[2].substring(1)})` : '') +
                                '[ \t]*\\n?') :
                            // Just a key string.
                            escre(k)) + ')'))
                .join(''))) :
        spec.insert;
    // console.log('RE', insertRE)
    let remain = src;
    let nextm = true;
    let out = '';
    // By default, just append to a string, but allow for custom handling.
    let handle = spec?.handle || ((s) => out += (null == s ? '' : s));
    while (nextm) {
        let m = remain.match(insertRE);
        // console.log('M', m)
        if (m) {
            let mi = m.index || 0;
            handle(remain.substring(0, mi));
            let mg = m.groups || {};
            // console.log('MG', mg)
            let insert;
            let skip = 0;
            let ref = mg.J_R; // m[2]
            // Get replacement from model path.
            if (null != ref) {
                insert = '__JOSTRACA_REPLACE__' === ref ? '' + insertRE : getx(model, ref);
                skip = mg.J_O.length + mg.J_C.length;
            }
            // Else custom replacement.
            else {
                ref = '';
                insert = '';
                // Use first key with a defined match (that is, the alternate that matched).
                let key = Object.keys(mg).
                    filter(k => k.startsWith('J_K') && null != mg[k])[0];
                if (null != key) {
                    ref = mg[key] || '';
                    insert = specReplaceCanon[key.replace(/^J_K\d+_/, '')] || '';
                }
            }
            // Check if custom regexp has resulted in an alternate that matches an empy string.
            if ('' === ref) {
                throw new Error('Regular expression matches empty string: ' + insertRE);
            }
            else {
                let ti = typeof insert;
                // Leave unmatched model paths in place so they can be debugged.
                if (null == insert || ('number' === ti && isNaN(insert))) {
                    handle((0 === skip ? '' : mg.J_O) + ref +
                        (0 === skip ? '' : mg.J_C));
                }
                // Replacement is a function, so call it to generate a dynamic replacement string.
                else if ('function' === ti) {
                    // Provide custom named groups, removing unique prefix.
                    let groups = Object.entries(mg)
                        .reduce((a, n, _) => ((n[0].startsWith('J_') ? ((_ = n[0].match(/^J_[NT]\d+_(.+)$/)) && null != n[1] ?
                        (a[_[1]] = n[1],
                            // Tag also sets property `name`
                            (_[0].startsWith('J_T') ? a.name = n[1] : null))
                        : null) : a[n[0]] = n[1]), a), { '$&': m[0] });
                    handle(insert(groups, { src, model, spec, ref, index: mi, groups }));
                }
                // Insert a plain replacement value, JSONifying if necessary.
                else {
                    handle(('object' === ti ? JSON.stringify(insert) : insert));
                }
                remain = remain.substring(mi + skip + ref.length);
            }
        }
        else {
            handle(remain);
            nextm = false;
        }
    }
    return out;
}
function indent(src, indent) {
    src = null == src ? '' : '' + src;
    indent = null == indent ? 2 : indent;
    indent = 'number' === typeof indent ? ' '.repeat(indent) : '' + indent;
    src = src.replace(/(\n|^)(?!$)/g, '$1' + indent);
    // (_, p1) => p1 + indent)
    return src;
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
function humanify(when, flags = {}) {
    const d = when ? new Date(when) : new Date();
    const iso = d.toISOString();
    if (flags.parts) {
        let parts = iso.split(/[-:T.Z]/).map(s => +s);
        let i = 0;
        let out = {
            year: parts[i++],
            month: parts[i++],
            day: parts[i++],
            hour: parts[i++],
            minute: parts[i++],
            second: parts[i++],
            milli: parts[i++],
        };
        if (flags.terse) {
            out = {
                ty: out.year,
                tm: out.month,
                td: out.day,
                th: out.hour,
                tn: out.minute,
                ts: out.second,
                ti: out.milli,
            };
        }
        return out;
    }
    return +(iso.replace(/[^\d]/g, '').replace(/\d$/, ''));
}
/*
  MIT License
 
  Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)
  Copyright (c) Paul Miller (https://paulmillr.com)
 
  Thank You!
*/
const BINARY_EXT = '3dm;3ds;3g2;3gp;7z;a;aac;adp;afdesign;afphoto;afpub;ai;aif;aiff;alz;ape;apk;appimage;ar;arj;asf;au;avi;bak;baml;bh;bin;bk;bmp;btif;bz2;bzip2;cab;caf;cgm;class;cmx;cpio;cr2;cur;dat;dcm;deb;dex;djvu;dll;dmg;dng;doc;docm;docx;dot;dotm;dra;DS_Store;dsk;dts;dtshd;dvb;dwg;dxf;ecelp4800;ecelp7470;ecelp9600;egg;eol;eot;epub;exe;f4v;fbs;fh;fla;flac;flatpak;fli;flv;fpx;fst;fvt;g3;gh;gif;graffle;gz;gzip;h261;h263;h264;icns;ico;ief;img;ipa;iso;jar;jpeg;jpg;jpgv;jpm;jxr;key;ktx;lha;lib;lvp;lz;lzh;lzma;lzo;m3u;m4a;m4v;mar;mdi;mht;mid;midi;mj2;mka;mkv;mmr;mng;mobi;mov;movie;mp3;mp4;mp4a;mpeg;mpg;mpga;mxu;nef;npx;numbers;nupkg;o;odp;ods;odt;oga;ogg;ogv;otf;ott;pages;pbm;pcx;pdb;pdf;pea;pgm;pic;png;pnm;pot;potm;potx;ppa;ppam;ppm;pps;ppsm;ppsx;ppt;pptm;pptx;psd;pya;pyc;pyo;pyv;qt;rar;ras;raw;resources;rgb;rip;rlc;rmf;rmvb;rpm;rtf;rz;s3m;s7z;scpt;sgi;shar;snap;sil;sketch;slk;smv;snk;so;stl;suo;sub;swf;tar;tbz;tbz2;tga;tgz;thmx;tif;tiff;tlz;ttc;ttf;txz;udf;uvh;uvi;uvm;uvp;uvs;uvu;viv;vob;war;wav;wax;wbmp;wdp;weba;webm;webp;whl;wim;wm;wma;wmv;wmx;woff;woff2;wrm;wvx;xbm;xif;xla;xlam;xls;xlsb;xlsm;xlsx;xlt;xltm;xltx;xm;xmind;xpi;xpm;xwd;xz;z;zip;zipx;bin'.split(';');
exports.BINARY_EXT = BINARY_EXT;
function isbinext(path) {
    return BINARY_EXT.includes(node_path_1.default.extname(path || '').substring(1).toLowerCase());
}
//# sourceMappingURL=basic.js.map