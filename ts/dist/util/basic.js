"use strict";
/* Copyright (c) 2024 Richard Rodger, MIT License */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BINARY_EXT = void 0;
exports.camelify = camelify;
exports.cmap = cmap;
exports.deep = deep;
exports.each = each;
exports.escre = escre;
exports.get = get;
exports.getx = getx;
exports.humanify = humanify;
exports.indent = indent;
exports.isbincontent = isbincontent;
exports.isbinext = isbinext;
exports.kebabify = kebabify;
exports.names = names;
exports.omap = omap;
exports.partify = partify;
exports.snakify = snakify;
exports.template = template;
exports.vmap = vmap;
exports.ucf = ucf;
exports.lcf = lcf;
exports.getdlog = getdlog;
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
    // Always sort entries by key alphabetically for cross-stack
    // determinism (Go map iteration is randomised; sorting on both
    // sides keeps output byte-equal). spec.sort still controls the
    // by-value sort variant below.
    let entries = Object.entries(subject).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
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
/*
function select(key: any, map: Record<string, Function>) {
  const fn = map && map[key]
  return fn ? fn() : undefined
}
*/
// Hoisted from getx() to avoid recompilation on every call.
//         A   B               C        D   E
const GETX_TOKEN_RE = /\s*("(\\.|[^"\\])*"|[\w\d_]+|\s+|[^\w\d_]+)\s*/g;
// A: prefixing space and/or comma
// B: quoted string
// C: atom
// D: space
// E: operator
function getx(root, path) {
    if (null == root || 'object' !== typeof root) {
        return undefined;
    }
    let tokens;
    if (Array.isArray(path)) {
        tokens = path.map(p => '' + p);
    }
    else if ('string' === typeof path) {
        GETX_TOKEN_RE.lastIndex = 0;
        let tre = GETX_TOKEN_RE;
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
        if (t1 && t1.match(/^(<=?|>=?|==?|!=|~)$/)) {
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
    let parts = partify(input);
    return parts
        .map((p) => p[0].toUpperCase() + p.substring(1))
        .join('');
}
function kebabify(input) {
    let parts = partify(input);
    return parts
        .map(p => p.toLowerCase())
        .join('-');
}
function snakify(input) {
    let parts = partify(input);
    return parts
        .map(p => p.toLowerCase())
        .join('_');
}
function ucf(s) {
    s = ('string' === typeof s ? s : '' + s);
    return 0 < s.length ? s[0].toUpperCase() + s.substring(1) : s;
}
function lcf(s) {
    s = ('string' === typeof s ? s : '' + s);
    return 0 < s.length ? s[0].toLowerCase() + s.substring(1) : s;
}
function partify(input) {
    return 'string' == typeof input ?
        input
            // Collapse acronym runs (e.g. `XMLParser` → `XmlParser`), but only when
            // the trailing uppercase isn't itself the start of a new word —
            // `(?![a-z])` prevents `AService` collapsing into `Aservice`.
            .replace(/([A-Z])([A-Z]+)(?![a-z])/g, (_, first, rest) => first + rest.toLowerCase())
            .split(/[-_ ]|([A-Z])/)
            .filter(p => null != p && '' !== p)
            // Re-attach a captured single uppercase letter to the lowercase tail
            // that follows it (the rest of its word). Without the uppercase guard,
            // a stray single lowercase letter between separators (e.g. `a` in
            // `yes-as-a-service`) would also be glued to the next part.
            .reduce((a, p) => {
            const prev = a[a.length - 1];
            if (0 < a.length &&
                1 === prev.length &&
                'A' <= prev && prev <= 'Z' &&
                !('A' <= p[0] && p[0] <= 'Z')) {
                a[a.length - 1] = prev + p;
            }
            else {
                a.push(p);
            }
            return a;
        }, []) :
        // Array inputs are filtered the same way the string branch filters its
        // split results: without this, an empty element made camelify() throw
        // on `p[0].toUpperCase()`.
        Array.isArray(input) ? input.map(n => '' + n).filter(p => '' !== p) :
            '' === '' + input ? [] : ['' + input];
}
function names(base, name, prop = 'name') {
    name = '' + name;
    base[prop + '__orig'] = name;
    base[camelify(prop)] = camelify(name);
    base[snakify(prop) + '_'] = snakify(name);
    base[kebabify(prop) + '-'] = kebabify(name);
    base[prop.toLowerCase()] = name.toLowerCase();
    base[prop.toUpperCase()] = name.toUpperCase();
    return base;
}
function escre(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function idenstr(s) { return s.replace(/[^\w\d]/g, '_'); }
// Cache for compiled template RegExps to avoid recompilation on repeated calls.
// Stores regex and the mapping from original keys to normalized canon keys.
const templateRECache = new Map();
const TEMPLATE_RE_CACHE_MAX = 100;
// Cache for eject RegExps.
const ejectRECache = new Map();
// NOTE: $$foo.bar$$ format used as explicit start and end markers mean regex can be used
// unambiguously ($fooa would not match `foo`)
function template(src, model, spec) {
    src = null == src ? '' : '' + src;
    model = null == model ? {} : model;
    let eject = spec?.eject;
    if (null != eject) {
        const ejectStart = null == eject[0] ? null :
            eject[0] instanceof RegExp ? eject[0] :
                getCachedEjectRE('' + eject[0]);
        const ejectEnd = null == eject[1] ? null :
            eject[1] instanceof RegExp ? eject[1] :
                getCachedEjectRE('' + eject[1]);
        if (null != ejectStart && null != ejectEnd) {
            let startIndex = 0;
            let endIndex = src.length;
            const startMatch = src.match(ejectStart);
            if (startMatch) {
                startIndex = startMatch.index + startMatch[0].length;
            }
            const endMatch = src.match(ejectEnd);
            if (endMatch) {
                endIndex = endMatch.index;
            }
            // An end marker resolving before the start marker is malformed: there
            // is no region between them. Leave the source alone, which is what
            // already happens when neither marker is found.
            //
            // This used to fall through to `substring`, which SWAPS its arguments
            // when start > end — so the source came back reversed-region, purely
            // as an accident of the JS built-in. The Go port guarded the same
            // case and returned '' instead, so the two silently disagreed.
            if (startIndex <= endIndex) {
                src = src.substring(startIndex, endIndex);
            }
        }
    }
    let open = null == spec?.open ? '\\$\\$' : spec.open;
    let close = null == spec?.close ? '\\$\\$' : spec.close;
    let ref = null == spec?.ref ? '[^$]+' : spec.ref;
    let specReplaceMap = spec?.replace || {};
    let specReplaceCanon = {};
    let insertRE;
    if (null != spec?.insert) {
        insertRE = spec.insert;
    }
    else {
        const cacheKey = open + '\0' + close + '\0' + ref + '\0' +
            Object.keys(specReplaceMap).sort().join('\0');
        const cached = templateRECache.get(cacheKey);
        if (cached) {
            insertRE = cached.re;
            // Rebuild specReplaceCanon from current values using cached key mapping.
            for (const [origKey, canonKey] of cached.canonKeys) {
                specReplaceCanon[canonKey] = specReplaceMap[origKey];
            }
        }
        else {
            let ngI = 1;
            const canonKeys = [];
            insertRE = new RegExp(
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
                // Normalize key for use as group name as key could be a regexp ('/foo/' format).
                _ = idenstr(k).replace(/_+/g, '_'),
                    specReplaceCanon[_] = specReplaceMap[k],
                    canonKeys.push([k, _]),
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
                                (`(?<J_N${ngI++}_indent>[ \t]*)` +
                                    '\\/\\/' +
                                    '[ \t]*#' +
                                    (_[1] ?
                                        `(?<J_T${ngI++}_${_[2]?.substring(1) || 'TAG'}>` +
                                            (_[2] ? '[A-Za-z0-9]+' : _[1]) + ')' : '') +
                                    (_[2] ? `-(?<J_N${ngI++}_TAG>${_[2].substring(1)})` : '') +
                                    '[ \t]*\\n?') :
                                // Just a key string.
                                escre(k)) + ')'))
                    .join('')));
            if (templateRECache.size >= TEMPLATE_RE_CACHE_MAX) {
                templateRECache.clear();
            }
            templateRECache.set(cacheKey, { re: insertRE, canonKeys });
        }
    }
    let remain = src;
    let nextm = true;
    const hasCustomHandle = null != spec?.handle;
    let out = '';
    let parts = hasCustomHandle ? [] : [];
    // By default, collect into array (O(n) join), but allow for custom handling.
    let handle = hasCustomHandle ? spec.handle :
        ((s) => parts.push(null == s ? '' : s));
    while (nextm) {
        let m = remain.match(insertRE);
        if (m) {
            let mi = m.index || 0;
            handle(remain.substring(0, mi));
            let mg = m.groups || {};
            let insert;
            let skip = 0;
            let ref = mg.J_R; // m[2]
            // Get replacement from model path.
            if (null != ref) {
                const qm = ref.match(/^"(.+)"$/);
                if (qm) {
                    insert = qm[1];
                }
                else if ('__JOSTRACA_REPLACE__' === ref) {
                    insert = '' + insertRE;
                }
                else {
                    insert = getx(model, ref);
                }
                skip = mg.J_O.length + mg.J_C.length;
            }
            // Else custom replacement.
            else {
                ref = '';
                insert = '';
                // Use first key with a defined match (that is, the alternate that matched).
                // Sort for deterministic selection across stacks (Go map
                // iteration is randomised; both stacks now iterate alphabetically).
                let key = Object.keys(mg).sort().
                    filter(k => k.startsWith('J_K') && null != mg[k])[0];
                if (null != key) {
                    ref = mg[key] || '';
                    insert = specReplaceCanon[key.replace(/^J_K\d+_/, '')] || '';
                }
            }
            // Check if custom regexp has resulted in an alternate that matches an empty string.
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
                    // Sorted iteration so collisions resolve deterministically
                    // across stacks.
                    let groups = Object.entries(mg)
                        .sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
                        .reduce((a, n, _) => ((n[0].startsWith('J_') ? ((_ = n[0].match(/^J_[NT]\d+_(.+)$/)) && null != n[1] ?
                        (a[_[1]] = n[1],
                            // Tag also sets property `name`
                            (_[0].startsWith('J_T') ? a.name = n[1] : null))
                        : null) : a[n[0]] = n[1]), a), { '$&': m[0] });
                    handle(insert(groups, { src, model, spec, ref, index: mi, groups }));
                }
                // Insert a plain replacement value, JSONifying if necessary.
                else {
                    handle(('object' === ti ? jsonify(insert) : insert));
                }
                remain = remain.substring(mi + skip + ref.length);
            }
        }
        else {
            handle(remain);
            nextm = false;
        }
    }
    return hasCustomHandle ? out : parts.join('');
}
// JSONify a template replacement value with object keys in sorted order.
//
// `JSON.stringify` emits keys in insertion order; Go's `json.Marshal`
// emits them sorted, and a Go map has no insertion order to reproduce.
// Values reaching a template are almost always loaded from JSON or YAML
// config, so without this the two stacks emit the same object with
// different key order. Sorting on the TS side is the same convention
// `each`, `cmap` and `vmap` already follow for cross-stack determinism.
function jsonify(val) {
    return JSON.stringify(sortKeys(val, new Set()));
}
// Deep copy with object keys sorted. Arrays keep their order (they have
// a meaningful one). `toJSON` is honoured so Date and friends serialize
// as they did before this existed, rather than collapsing to `{}`.
// Cycles are rejected the way `JSON.stringify` rejects them, instead of
// recursing until the stack blows; repeated non-cyclic references are
// fine, as they are for `JSON.stringify`.
function sortKeys(val, seen) {
    if (null == val || 'object' !== typeof val) {
        return val;
    }
    if ('function' === typeof val.toJSON) {
        return val.toJSON();
    }
    if (seen.has(val)) {
        throw new TypeError('Converting circular structure to JSON');
    }
    seen.add(val);
    let out;
    if (Array.isArray(val)) {
        out = val.map((entry) => sortKeys(entry, seen));
    }
    else {
        out = {};
        for (const key of Object.keys(val).sort()) {
            out[key] = sortKeys(val[key], seen);
        }
    }
    seen.delete(val);
    return out;
}
function getCachedEjectRE(s) {
    let re = ejectRECache.get(s);
    if (!re) {
        re = new RegExp('[ \t]*' + escre(s) + '[ \t]*\\n?');
        ejectRECache.set(s, re);
    }
    return re;
}
function indent(src, indent) {
    src = null == src ? '' : '' + src;
    indent = null == indent ? 2 : indent;
    indent = 'number' === typeof indent ? ' '.repeat(indent) : '' + indent;
    src = src.replace(/(\n|^)(?!$)/g, '$1' + indent);
    // (_, p1) => p1 + indent)
    return src;
}
// Compare `[key, value]` entries by key. Sorted iteration is what keeps
// the TS output byte-equal with the Go port: a Go map has no insertion
// order to reproduce, so both sides sort instead.
const sortByKey = (a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
// Map child objects to new child objects. Iterates source and spec
// keys in alphabetical order for cross-stack determinism (Go map
// iteration is randomised; sorting on both sides keeps output
// byte-equal).
function cmap(o, p) {
    return Object
        .entries(o)
        .sort(sortByKey)
        .reduce((r, n, _) => (_ = Object
        .entries(p)
        .sort(sortByKey)
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
// Map child objects to a list of child objects. Sorted iteration as cmap.
function vmap(o, p) {
    return Object
        .entries(o)
        .sort(sortByKey)
        .reduce((r, n, _) => (_ = Object
        .entries(p)
        .sort(sortByKey)
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
// Skip sentinel honoured by `deep`: an `over` value of SKIP leaves the
// `base` value untouched. Resolved from the global symbol registry, which
// is where `jsonic` registers it, so a caller holding `jsonic.SKIP` gets
// the identical symbol and the identical behaviour it had when `deep` was
// imported from there.
const SKIP = Symbol.for('tabnas.SKIP');
// Deep merge objects and arrays, right-most wins (opinionated mutation of
// the first argument!). `undefined` and SKIP values are ignored, plain
// objects and arrays merge key-by-key, and anything with a custom
// constructor (Date, RegExp, class instances) is taken by reference
// rather than walked.
//
// Ported verbatim from `jsonic`'s `util.deep`, which is where this used to
// come from. Two object helpers do not justify a parser dependency, and
// the Go port already carries its own copy at go/util.go `Deep`.
//
// Key order matches the original: keys already in `base` keep their
// position and new keys from `over` append in `over`'s enumeration order.
// `for...in` rather than `Object.keys` is deliberate — inherited
// enumerable properties merge too, as they did under jsonic.
function deep(base, ...rest) {
    let base_isf = 'function' === typeof base;
    let base_iso = null != base && ('object' === typeof base || base_isf);
    for (const over of rest) {
        const over_isf = 'function' === typeof over;
        const over_iso = null != over && ('object' === typeof over || over_isf);
        let over_ctor;
        if (base_iso &&
            over_iso &&
            !over_isf &&
            Array.isArray(base) === Array.isArray(over)) {
            for (const k in over) {
                base[k] = deep(base[k], over[k]);
            }
        }
        else {
            base =
                undefined === over || SKIP === over
                    ? base
                    : over_isf
                        ? over
                        : over_iso
                            ? 'function' === typeof (over_ctor = over.constructor) &&
                                'Object' !== over_ctor.name &&
                                'Array' !== over_ctor.name
                                ? over
                                : deep(Array.isArray(over) ? [] : {}, over)
                            : over;
            base_isf = 'function' === typeof base;
            base_iso = null != base && ('object' === typeof base || base_isf);
        }
    }
    return base;
}
// Map over object entries, building a new object. `fn` receives each
// `[key, value]` pair and returns the replacement pair; an `undefined`
// replacement key drops the entry, and any additional pairs in the
// returned array set additional keys.
//
// Entries are visited in sorted key order — the same cross-stack
// determinism convention `each`, `cmap`, `vmap` and `jsonify` follow.
// jsonic's original walked `Object.entries` in insertion order, which the
// Go port could not reproduce (go/util.go `OMap` sorts, because Go map
// iteration is randomised). Sorting here is what makes the two agree.
function omap(o, fn) {
    return Object
        .entries(o || {})
        .sort(sortByKey)
        .reduce((out, entry) => {
        const mapped = fn ? fn(entry) : entry;
        if (undefined === mapped[0]) {
            delete out[entry[0]];
        }
        else {
            out[mapped[0]] = mapped[1];
        }
        // Additional pairs set additional keys.
        let i = 2;
        while (undefined !== mapped[i]) {
            out[mapped[i]] = mapped[i + 1];
            i += 2;
        }
        return out;
    }, {});
}
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
// Cap on the process-global debug-log buffer; oldest entries are dropped.
const DLOG_MAX = 1000;
function getdlog(tagin, filepath) {
    const tag = tagin || '-';
    const file = node_path_1.default.basename(filepath || '-');
    const g = global;
    g.__dlog__ = (g.__dlog__ || []);
    g.__dlogseq__ = (g.__dlogseq__ || 0);
    const dlog = (...args) => {
        const stack = '' + new Error().stack;
        // Bounded: this buffer is process-global and was never drained, so a
        // long-lived process generating repeatedly grew it without limit.
        if (DLOG_MAX <= g.__dlog__.length) {
            g.__dlog__.splice(0, g.__dlog__.length - DLOG_MAX + 1);
        }
        // Stamp a MONOTONIC sequence number, and select on it rather than on
        // the buffer's length.
        //
        // A caller marking its position with `log().length` breaks the moment
        // the buffer reaches its cap: eviction stops the length growing, the
        // mark equals the length forever after, and `slice(mark)` is always
        // empty — so in a long-lived process every warning after the first
        // thousand entries silently stopped reaching the configured logger.
        //
        // The sequence is a property on the entry array, not an element, so
        // the `[tag, file, when, ...args, stack]` shape and its index-based
        // consumers are untouched.
        const entry = [tag, file, Date.now(), ...args, stack];
        entry.seq = ++g.__dlogseq__;
        g.__dlog__.push(entry);
    };
    dlog.tag = tag;
    dlog.file = file;
    // Current position in the monotonic sequence, for callers that want the
    // entries added after some point. Survives buffer eviction.
    dlog.seq = () => (g.__dlogseq__ || 0);
    // Entry shape is [tag, file, when, ...args, stack] — the file is at
    // index 1. This compared index 2 (the timestamp) against a basename, so
    // filtering by file could never match.
    dlog.log = (filepath, __f) => (__f = null == filepath ? null : node_path_1.default.basename(filepath),
        g.__dlog__.filter((n) => n[0] === tag && (null == __f || n[1] === __f)));
    return dlog;
}
/*
  MIT License
 
  Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)
  Copyright (c) Paul Miller (https://paulmillr.com)
 
  Thank You!
*/
const BINARY_EXT = '3dm;3ds;3g2;3gp;7z;a;aac;adp;afdesign;afphoto;afpub;ai;aif;aiff;alz;ape;apk;appimage;ar;arj;asf;au;avi;bak;baml;bh;bin;bk;bmp;btif;bz2;bzip2;cab;caf;cgm;class;cmx;cpio;cr2;cur;dat;dcm;deb;dex;djvu;dll;dmg;dng;doc;docm;docx;dot;dotm;dra;ds_store;dsk;dts;dtshd;dvb;dwg;dxf;ecelp4800;ecelp7470;ecelp9600;egg;eol;eot;epub;exe;f4v;fbs;fh;fla;flac;flatpak;fli;flv;fpx;fst;fvt;g3;gh;gif;graffle;gz;gzip;h261;h263;h264;icns;ico;ief;img;ipa;iso;jar;jpeg;jpg;jpgv;jpm;jxr;key;ktx;lha;lib;lvp;lz;lzh;lzma;lzo;m3u;m4a;m4v;mar;mdi;mht;mid;midi;mj2;mka;mkv;mmr;mng;mobi;mov;movie;mp3;mp4;mp4a;mpeg;mpg;mpga;mxu;nef;npx;numbers;nupkg;o;odp;ods;odt;oga;ogg;ogv;otf;ott;pages;pbm;pcx;pdb;pdf;pea;pgm;pic;png;pnm;pot;potm;potx;ppa;ppam;ppm;pps;ppsm;ppsx;ppt;pptm;pptx;psd;pya;pyc;pyo;pyv;qt;rar;ras;raw;resources;rgb;rip;rlc;rmf;rmvb;rpm;rtf;rz;s3m;s7z;scpt;sgi;shar;snap;sil;sketch;slk;smv;snk;so;stl;suo;sub;swf;tar;tbz;tbz2;tga;tgz;thmx;tif;tiff;tlz;ttc;ttf;txz;udf;uvh;uvi;uvm;uvp;uvs;uvu;viv;vob;war;wav;wax;wbmp;wdp;weba;webm;webp;whl;wim;wm;wma;wmv;wmx;woff;woff2;wrm;wvx;xbm;xif;xla;xlam;xls;xlsb;xlsm;xlsx;xlt;xltm;xltx;xm;xmind;xpi;xpm;xwd;xz;z;zip;zipx;bin'.split(';');
exports.BINARY_EXT = BINARY_EXT;
// Membership set, not a linear scan of ~250 entries on every copied file.
const BINARY_EXT_SET = new Set(BINARY_EXT);
function isbinext(path) {
    return BINARY_EXT_SET.has(node_path_1.default.extname(path || '').substring(1).toLowerCase());
}
// Whether the bytes look binary, judged by a NUL in the first 8 KB — the
// same heuristic git and file(1) use.
//
// An extension list can never be exhaustive: `.wasm`, `.zst`, `.br`,
// `.sqlite`, `.parquet` and every extensionless binary are absent from
// BINARY_EXT. Anything it misses used to be read as UTF-8, run through
// template substitution and written back, replacing invalid sequences with
// U+FFFD — silent corruption of the copied file.
function isbincontent(content) {
    if ('string' === typeof content) {
        return content.includes('\u0000');
    }
    const len = Math.min(content.length, 8192);
    for (let i = 0; i < len; i++) {
        if (0 === content[i]) {
            return true;
        }
    }
    return false;
}
//# sourceMappingURL=basic.js.map