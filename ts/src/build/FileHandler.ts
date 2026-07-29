
import Path from 'node:path'

import * as DiffUtil from '../diff'
// import Os from 'node:os'

import { BuildContext } from './BuildContext'

import { FST, Audit } from '../types'

import {
  humanify,
  isbincontent,
  isbinext,
  getdlog,
} from '../util/basic'


const CN = 'FileHandler:'

// Normalize path separators to forward slashes for cross-platform consistency.
// memfs and canonical paths require forward slashes; Path.normalize/join/dirname
// produce backslashes on Windows.
function fwd(p: string): string {
  return p.includes('\\') ? p.replace(/\\/g, '/') : p
}

const JOSTRACA_PROTECT = 'JOSTRACA_PROTECT'

// Audit breadcrumb per merge outcome, so the `why` trail says which fast
// path (if any) the merge took.
const MERGE_WHY: Record<string, string> = {
  same: 'merge-same-0',
  clean: 'merge-clean-0',
  unresolved: 'merge-unresolved-0',
  merged: 'merge-run-0',
}

// Suffix for the sibling temp file used by the atomic write-then-rename.
const TMP_SUFFIX = '.jostraca-tmp'

// How many candidate temp paths an atomic write may try before giving up.
//
// MUST match tmpPathAttempts in go/filehandler.go — an identical collision
// schedule has to succeed or fail identically in both stacks.
const TMP_PATH_ATTEMPTS = 9

// A unique sibling temp path for an atomic write.
//
// Never a fixed name: a fixed one both destroys a user file that happens to
// sit at it, and lets two concurrent runs sharing an output folder publish
// each other's bytes. pid + counter + random keeps it unique across
// processes, across writes within a process, and across retries.
let tmpseq = 0
function tmppathFor(path: string): string {
  const pid = 'undefined' === typeof process ? 0 : process.pid
  const rnd = Math.floor(Math.random() * 0x100000000).toString(36)
  return path + TMP_SUFFIX + '-' + pid + '-' + (tmpseq++).toString(36) + '-' + rnd
}

// TODO: if EOL != '\n', normalize to '\n' in load,save 

// Log non-fatal wierdness.
const dlog = getdlog('jostraca', __filename)


class FileHandler {

  when: number
  fs: () => FST
  now: () => number
  folder: string
  audit: Audit
  maxdepth: number
  existing: { txt: any, bin: any }
  control: {
    dryrun: boolean
    duplicate: boolean
    version: boolean
  }
  duplicateFolder: () => string
  last: () => number
  addmeta: (file: string, meta: any) => void
  metafile: () => string
  files: {
    preserved: string[]
    written: string[]
    presented: string[]
    diffed: string[]
    merged: string[]
    conflicted: string[]
    unchanged: string[]
  }
  createdDirs: Set<string>
  savedPaths: Set<string>


  constructor(
    bctx: BuildContext,
    existing: { txt: any, bin: any },
    control: {
      dryrun: boolean
      duplicate: boolean
      version: boolean
    }
  ) {
    this.fs = bctx.fs
    this.now = bctx.now

    this.when = bctx.when
    this.folder = fwd(Path.normalize(bctx.folder))
    this.audit = bctx.audit
    this.existing = existing
    this.control = control

    this.maxdepth = 22 // TODO: get from JostracaOptions

    this.files = {
      preserved: [],
      written: [],
      presented: [],
      diffed: [],
      merged: [],
      conflicted: [],
      unchanged: [],
    }

    this.createdDirs = new Set()
    this.savedPaths = new Set()

    // Yikes!
    this.duplicateFolder = bctx.duplicateFolder.bind(bctx)
    this.last = () => bctx.bmeta.prev.last
    this.addmeta = bctx.addmeta.bind(bctx)
    this.metafile = () => bctx.bmeta.next.filename

    if (!this.fs().existsSync) {
      throw new Error(CN + ' Invalid file system provider: ' + this.fs())
    }
  }


  relative(path: string, whence?: string) {
    const FN = 'relative:'
    const wstr = null == whence ? '' : whence + ':'

    if ('string' !== typeof path) {
      throw new Error(CN + FN + wstr + ' invalid path, path=' + path)

    }

    // Strip the folder prefix only when it is ACTUALLY there.
    //
    // `save` normalizes first, so with the default folder `.` a path comes
    // in as `a.txt`, not `./a.txt` — the leading `.` this is meant to
    // consume is already gone. Cutting `this.folder.length` regardless then
    // ate the first real character: `a.txt` and `b.txt` both became `.txt`,
    // so their merge baselines and meta keys collided and a later merge
    // loaded the wrong ancestor. (The ternary this replaced had the same
    // expression in both branches — a half-finished special case.)
    //
    // The prefix must match on a PATH BOUNDARY, not as a raw string.
    //
    // A bare `startsWith` looked right and was not: with folder `.`, the
    // folder is the single character `.`, so `.env` "starts with" it and
    // the strip produced `env` — the same relative key as a sibling file
    // literally named `env`. Their merge baselines and meta entries then
    // collided, and the next run merged each against the OTHER's ancestor,
    // writing whole-file conflict markers into the user's real `.env`.
    // That is the very collision this function was fixed to prevent, one
    // case narrower. `.gitignore`, `.npmrc` and friends are all affected.
    //
    // So `.` strips only an explicit `./`, `/` strips only separators, and
    // everything else defers to `withinFolder`, which already does
    // boundary matching properly.
    const stripFolder = (s: string) =>
      (s.startsWith(this.folder) ? s.substring(this.folder.length) : s)
        .replace(/^[/\\]+/, '')

    const rpath =
      '.' === this.folder ? path.replace(/^\.[/\\]+/, '') :
        '/' === this.folder ? path.replace(/^[/\\]+/, '') :
          this.withinFolder(path) ? stripFolder(path) :
            path

    // Canonical paths use forward slashes, NOT Path.sep
    return rpath.replace(/\\/g, '/')
  }


  // Whether `path` resolves inside the configured output folder.
  //
  // Matched on a separator boundary, not a raw string prefix: with folder
  // `/out`, the path `/output/x.txt` is NOT inside it. The plain
  // `startsWith` this replaced yielded the relative path `put/x.txt`, and
  // from there a bogus duplicate-baseline location and meta key.
  withinFolder(path: string): boolean {
    if ('.' === this.folder) {
      if (Path.isAbsolute(path)) {
        return false
      }
      // "relative" is not the same as "inside". A `..` segment walks OUT
      // of the output folder, and this returning true for it let the merge
      // baseline — `.jostraca/generated` joined to the relative path — nor-
      // malize to a location outside the baseline directory entirely, and
      // silently overwrite whatever was there.
      const norm = fwd(Path.normalize(path))
      return '..' !== norm && !norm.startsWith('../')
    }
    if ('/' === this.folder) {
      return path.startsWith('/')
    }
    return path === this.folder ||
      path.startsWith(this.folder + '/') ||
      path.startsWith(this.folder + '\\')
  }


  // save for content already KNOWN to be binary, whatever its extension
  // says.
  //
  // The copy paths sniff for NUL bytes so an unlisted extension (`.wasm`
  // and friends) is still treated as binary; `save` otherwise re-derives
  // the classification from the destination extension alone and throws
  // that knowledge away. With `txt.diff` on, a diff render would then
  // write textual conflict markers into binary data, and `bin.preserve`
  // would be ignored entirely.
  //
  // Mirrors saveBinary in go/filehandler.go.
  saveBinary(
    path: string,
    newContentSource: string | Buffer,
    whence?: string
  ): void {
    this.save(path, newContentSource, false, whence, undefined, false)
  }


  // `mode` sets POSIX permission bits on the generated file (e.g. 0o755
  // for a script). It applies to the target only — the `.old`/`.new`
  // sidecars and the merge baseline stay at the platform default, since
  // they are jostraca's bookkeeping rather than the user's output.
  //
  // `isText` overrides the extension-derived classification; only
  // `saveBinary` passes it.
  save(
    path: string,
    newContentSource: string | Buffer,
    write?: boolean | string,
    whence?: string,
    mode?: number,
    isText?: boolean
  ): void {
    // Only ever set the key when a mode was actually given: a literal
    // `mode: undefined` is rejected by some fs providers.
    const modeopts = () => (null == mode ? {} : { mode })
    const wstr = null == whence ? '' : whence + ':'
    const fs = this.fs()
    const FN = 'save:'

    let why = []

    if ('string' === typeof write) {
      whence = write
      write = false
    }
    else if (null == write) {
      write = false
    }

    whence = null == whence ? '' : whence

    path = fwd(Path.normalize(path))

    // Which of `existing.txt` / `existing.bin` governs is decided by the
    // DESTINATION EXTENSION, with the caller able to promote a file the
    // list does not know about (`saveBinary`) — never to demote a listed
    // one.
    //
    // This used to be decided by the TYPE OF THE VALUE passed in: a string
    // took `existing.txt`, a Buffer `existing.bin`. That made the mode set
    // an artifact of how the content happened to reach save rather than of
    // what the file is, and inverted the two stacks against each other for
    // any binary-extension file whose bytes are plain text — an `a.png`
    // holding ASCII took `txt.preserve` here and `bin.preserve` in Go. It
    // also split TS against itself: the same `a.png` took `existing.txt`
    // through the single-file copy route (which sniffed content) and
    // `existing.bin` through the tree copy route (which consulted the
    // extension).
    const isTextFile = null == isText ? !isbinext(path) : isText
    const existing = isTextFile ? this.existing.txt : this.existing.bin

    const withinFolder = this.withinFolder(path)

    const rpath = this.relative(path, FN + wstr)

    // Two components resolving to the same output path is almost always a
    // mistake (the second silently wins). Detect it here rather than
    // inferring it from adjacent entries in one of the `files` lists —
    // that only caught the case where both saves happened to take the same
    // branch, so it stopped firing as soon as one of them became a no-op.
    if (this.savedPaths.has(path)) {
      dlog('save', 'duplicate save, later content wins: ' + path)
    }
    else {
      this.savedPaths.add(path)
    }

    const exists = fs.existsSync(path)
    write = write || !exists

    why.push(`start<${write ? 'w' : 'W'}${exists ? 'x' : 'X'}>`)

    const meta: any = {
      action: 'init',
      path: rpath,
      exists,
      actions: [],
      protect: false,
      conflict: false,
    }

    // Tracks whether the generated content actually differs from what is
    // already on disk, so the write path can skip a no-op rewrite.
    let unchanged = false

    if (exists) {
      why.push('exists-0')
      let currentContent = this.loadFile(path)

      const protect = 0 <= currentContent.indexOf(JOSTRACA_PROTECT)
      meta.protect = protect

      unchanged = currentContent.length === newContentSource.length &&
        currentContent === newContentSource

      if (existing.preserve) {
        why.push('preserve-0')

        if (protect) {
          why.push('protect-0')
          write = false
        }
        else if (currentContent.length !== newContentSource.length ||
          currentContent !== newContentSource) {
          why.push('content-0')

          let oldpath = annotatedPath(path, 'old')
          this.copyFile(path, oldpath, whence + 'preserve:')
          // this.files.preserved.push(path)
          this.filelog('preserved', path)

          meta.action = 'preserve'
          whenify(meta, this.now())
          meta.actions.push(meta.action)

          this.audit.push([CN + FN + wstr + meta.action,
          { ...meta, why, action: meta.action, path }])
        }
      }

      if (existing.write && !protect) {
        why.push('write-0')
        write = true
      }
      else if (existing.present) {
        why.push('present-0')

        if (currentContent.length !== newContentSource.length || currentContent !== newContentSource) {
          why.push('content-1')

          let newpath = annotatedPath(path, 'new')
          this.saveFile(newpath, newContentSource, { flush: true }, whence + 'present:')
          this.filelog('presented', path)

          meta.action = 'present'
          whenify(meta, this.now())
          meta.actions.push(meta.action)

          this.audit.push([CN + FN + wstr + meta.action,
          { ...meta, why, action: meta.action, path }])
        }
      }

      if (!protect) {
        why.push('not-protect-1')

        if (existing.diff) {
          why.push('diff-0')

          write = false

          if (currentContent.length !== newContentSource.length ||
            currentContent !== newContentSource) {
            why.push('content-2')

            meta.action = 'diff'

            const newContent =
              'string' === typeof newContentSource ? newContentSource :
                newContentSource.toString('utf8')

            const diffContent = this.diff(newContent, currentContent.toString())

            this.saveFile(path, diffContent,
              { encoding: 'utf8', ...modeopts() }, whence + meta.action)

            // this.files.diffed.push(path)
            this.filelog('diffed', path)

            const conflict = newContent !== diffContent
            if (conflict) {
              // this.files.conflicted.push(path)
              this.filelog('conflicted', path)
            }

            whenify(meta, this.now())
            meta.actions.push(meta.action)
            meta.conflict = conflict

            this.audit.push([CN + FN + wstr + meta.action,
            { ...meta, why, action: meta.action, path }])
          }
          else {
            // Equal content is still not a no-op when an explicit mode was
            // asked for — and `write` was already cleared above, so the
            // chmod on the plain-write path below is unreachable from here.
            if (this.chmodUnchanged(path, mode)) {
              why.push('chmod-0')
            }
            // this.files.unchanged.push(path)
            this.filelog('unchanged', path)
          }
        }
        else if (existing.merge) {
          why.push('merge-0')

          if (currentContent.length !== newContentSource.length ||
            currentContent !== newContentSource) {
            why.push('content-3')

            if (this.control.duplicate) {
              why.push('duplicate-0')
              const dfolder = this.duplicateFolder()

              const dpath = fwd(Path.join(dfolder, rpath))

              if (this.existsFile(dpath)) {
                why.push('dupexists-0')

                write = false
                meta.action = 'merge'

                const newContent =
                  'string' === typeof newContentSource ? newContentSource :
                    newContentSource.toString('utf8')

                const prevGenContent = this.loadFile(dpath, { encoding: 'utf8' }) as string

                const mergeres = this.merge(
                  newContent,                    // generated
                  prevGenContent,                // baseline (last generate)
                  currentContent.toString(),     // existing (on disk)
                  why
                )
                const diffcontent = mergeres.content
                const conflict = mergeres.conflict

                this.saveFile(path, diffcontent,
                  { encoding: 'utf8', ...modeopts() }, whence + meta.action)

                // this.files.merged.push(path)
                this.filelog('merged', path)

                if (conflict) {
                  // this.files.conflicted.push(path)
                  this.filelog('conflicted', path)
                }

                whenify(meta, this.now())
                meta.actions.push(meta.action)
                meta.conflict = conflict

                this.audit.push([CN + FN + wstr + meta.action,
                { ...meta, why, action: meta.action, path }])
              }
            }
          }

          else {
            why.push('unchanged-0')
            write = false
            // As in the diff branch: `write` is cleared here, so an
            // explicit mode has to be applied on this path too.
            if (this.chmodUnchanged(path, mode)) {
              why.push('chmod-0')
            }
            // this.files.unchanged.push(path)
            this.filelog('unchanged', path)
          }
        }
      }
    }

    if (write) {
      // A byte-identical rewrite is a no-op that still bumps mtime, which
      // re-triggers every watcher, bundler and incremental compiler
      // downstream — and costs a full write per file on every run. Record
      // the intent (so meta still says `write`, and the duplicate baseline
      // below is still refreshed) but skip touching the file. Matches the
      // Go port, which already did this.
      if (unchanged) {
        why.push('unchanged-0')
        meta.action = 'write'

        // Identical bytes are not a complete no-op when an explicit mode
        // was asked for. Making an already-correct script executable has
        // to work, and it only ever runs once — after that the content
        // always matches, so skipping here meant `mode` never applied
        // again. Chmod without rewriting, so mtime still is not bumped.
        if (this.chmodUnchanged(path, mode)) {
          why.push('chmod-0')
        }

        this.filelog('unchanged', path)
      }
      else {
        why.push('write-1')
        meta.action = 'write'
        this.saveFile(path, newContentSource, modeopts(), whence + meta.action)

        // this.files.written.push(path)
        this.filelog('written', path)
      }

      meta.actions.push(meta.action)
      whenify(meta, this.now())
      this.audit.push([CN + FN + wstr + meta.action,
      { ...meta, why, action: meta.action, path }])
    }
    else if (0 === meta.actions.length) {
      why.push('skip-0')
      meta.action = 'skip'
      meta.actions.push(meta.action)
      this.audit.push([CN + FN + wstr + meta.action,
      { ...meta, why, action: meta.action, path }])
    }

    if (this.control.duplicate) {
      why.push('duplicate-1')

      if (withinFolder && (Path.basename(path) !== this.metafile())) {
        why.push('within-0')

        const dfolder = this.duplicateFolder()
        const dpath = fwd(Path.join(dfolder, rpath))

        if (!this.control.dryrun) {
          this.ensureDir(fwd(Path.dirname(dpath)))
          this.writeFileAtomic(dpath, newContentSource, { flush: true })
        }

        if (null == meta.when) {
          whenify(meta, this.now())
        }
      }
    }

    // console.log('WHY', path, why)

    this.addmeta(path, meta)
  }


  copy(frompath: string, topath: string, write?: boolean | string, whence?: string): void {
    const wstr = null == whence ? '' : whence + ':'
    const FN = 'copy:'

    if ('string' === typeof write) {
      whence = write
      write = false
    }
    else if (null == write) {
      write = false
    }

    whence = wstr + FN

    const isBinary = isbinext(frompath)
    const content = this.loadFile(frompath, { encoding: isBinary ? null : 'utf8' }, whence)

    // The SOURCE decides: a binary source stays governed by `existing.bin`
    // even when copied to a destination whose extension is not on the
    // list. Same rule as CopyOp's own copy paths and go/build.go's
    // `IsBinExt(src) || IsBinContent(body)`.
    if (isBinary || isbincontent(content)) {
      this.saveBinary(topath, content, whence)
    }
    else {
      this.save(topath, content, whence)
    }
  }


  // Three-way merge of the new generate against what is on disk, using
  // the previous generate (kept under .jostraca/generated) as the common
  // ancestor. That ancestor choice is what preserves the user's manual
  // edits.
  //
  // The fast paths and the decision of which applied now live in the diff
  // engine, which reports an `outcome`; this just records it as a
  // breadcrumb.
  merge(
    generated: string,
    baseline: string,
    existing: string,
    why: string[]
  ): {
    content: string,
    conflict: boolean
  } {
    const res = DiffUtil.merge(generated, baseline, existing, {
      when: this.when,
      last: this.last(),
      kind: 'merge',
    })

    why.push(MERGE_WHY[res.outcome])

    return { content: res.content, conflict: res.conflict }
  }


  // Annotated two-way view of the difference between the new generate and
  // what is on disk.
  diff(generated: string, existing: string): string {
    return DiffUtil.diff(generated, existing, {
      when: this.when,
      last: this.last(),
      kind: 'diff',
    }).content
  }


  existsFile(path: string, whence?: string): boolean {
    const when = this.now()
    const wstr = null == whence ? '' : whence + ':'
    const fs = this.fs()
    const FN = 'existsFile:'

    validPath(path, this.maxdepth, CN + FN + 'from:' + wstr)

    // Paths are canonical (already folder-prefixed by the build phase, or
    // absolute); use them directly. Do NOT re-join `this.folder`, which would
    // double-prefix relative non-`.` output folders. Matches the Go port.
    const fullpath = fwd(Path.normalize(path))

    try {
      const exists = fs.existsSync(fullpath)
      this.audit.push([CN + FN + wstr,
      { path, when, exists }])
      return exists
    }
    catch (err: any) {
      this.audit.push(['ERROR:' + CN + FN + wstr,
      { path, when, err }])
      err.message = CN + FN + wstr + ' path=' + path +
        ' err=' + err.message
      throw err
    }
  }


  copyFile(frompath: string, topath: string, whence?: string): void {
    const when = this.now()
    const wstr = null == whence ? '' : whence + ':'
    const fs = this.fs()
    const FN = 'copyFile:'

    validPath(frompath, this.maxdepth, CN + FN + 'from:' + wstr)
    validPath(topath, this.maxdepth, CN + FN + 'to:' + wstr)

    // Canonical paths: use directly, do not re-join `this.folder` (see existsFile).
    const fulltopath = fwd(Path.normalize(topath))
    const fullfrompath = fwd(Path.normalize(frompath))

    try {
      const existed = fs.existsSync(fulltopath)

      // Copy BYTES, always — never decode as UTF-8 first.
      //
      // This used to pick the encoding from `isbinext(frompath)`, i.e. from
      // the extension alone. Content-sniffed binaries (T5) whose extension
      // is not on the list therefore reached the `preserve` branch, which
      // backs up via this method, and were decoded as UTF-8 on the way to
      // the `.old` file: bytes `00 ff 02` were written as `00 ef bf bd 02`.
      // The preserve option silently corrupted the only backup it existed
      // to make.
      //
      // A copy has no reason to know the file type — bytes round-trip for
      // text too — so the classification is simply gone.
      const content = fs.readFileSync(fullfrompath)

      // ensureDir must stay inside the dryrun guard: a dry run must not
      // mutate the tree, and creating the destination folder is a mutation
      // (saveFile already gets this right).
      if (!this.control.dryrun) {
        this.ensureDir(fwd(Path.dirname(fulltopath)))
        this.writeFileAtomic(fulltopath, content, { flush: true })
      }

      this.audit.push([CN + FN + wstr,
      { topath, frompath, when, existed, size: content.length }])
    }
    catch (err: any) {
      this.audit.push(['ERROR:' + CN + FN + wstr,
      { topath, frompath, when, err }])
      err.message = CN + FN + wstr + ' topath=' + topath + ' frompath=' + frompath +
        ' err=' + err.message
      throw err
    }
  }


  loadJSON(path: string, opts?: any | string, whence?: string): any {
    const when = this.now()
    const wstr = null == whence ? '' : whence + ':'
    const FN = 'loadJSON:'

    if ('string' === typeof opts) {
      whence = opts
      opts = {}
    }
    else {
      opts = opts || {}
    }

    opts.encoding = opts.encoding || 'utf8'

    try {
      const content = this.loadFile(path, opts, whence)
      const cstr = 'string' === typeof content ? content : content.toString(opts.encoding)
      const json = JSON.parse(cstr)
      this.audit.push([CN + FN + wstr,
      { path, when, size: content.length }])
      return json
    }
    catch (err: any) {
      this.audit.push(['ERROR:' + CN + FN + wstr,
      { path, when, err }])
      err.message = CN + FN + wstr + ' path=' + path + ' err=' + err.message
      throw err
    }
  }


  saveJSON(path: string, json: any, opts?: any | string, whence?: string): any {
    const when = this.now()
    const wstr = null == whence ? '' : whence + ':'
    const FN = 'saveJSON:'

    if ('string' === typeof opts) {
      whence = opts
      opts = {}
    }
    else {
      opts = opts || {}
    }

    opts.encoding = opts.encoding || 'utf8'

    try {
      const jstr = 'string' === typeof json ? json : JSON.stringify(json, null, 2)
      this.saveFile(path, jstr, opts, whence)
      this.audit.push([CN + FN + wstr,
      { path, when, size: jstr.length }])
      return jstr
    }
    catch (err: any) {
      this.audit.push(['ERROR:' + CN + FN + wstr,
      { path, when, err }])
      err.message = CN + FN + wstr + ' path=' + path + ' err=' + err.message
      throw err
    }
  }


  loadFile(path: string, opts?: any | string, whence?: string): string | Buffer {
    const when = this.now()
    const wstr = null == whence ? '' : whence + ':'
    const fs = this.fs()
    const FN = 'loadFile:'

    if ('string' === typeof opts) {
      whence = opts
      opts = {}
    }
    else {
      opts = opts || {}
    }

    opts.encoding = undefined === opts.encoding ? 'utf8' : opts.encoding

    validPath(path, this.maxdepth, CN + FN + wstr)

    try {
      // Canonical path: use directly, do not re-join `this.folder` (see existsFile).
      const fullpath = fwd(Path.normalize(path))
      const content = fs.readFileSync(fullpath, opts)
      this.audit.push([CN + FN + wstr,
      { path, when, size: content.length }])
      return content
    }
    catch (err: any) {
      this.audit.push(['ERROR:' + CN + FN + wstr,
      { path, when, err }])
      err.message = CN + FN + wstr + ' path=' + path + ' err=' + err.message
      throw err
    }
  }


  ensureFolder(path: string) {
    if (!this.control.dryrun) {
      this.ensureDir(path)
    }
  }

  private ensureDir(dir: string) {
    if (!this.createdDirs.has(dir)) {
      this.fs().mkdirSync(dir, { recursive: true })
      this.createdDirs.add(dir)
    }
  }


  // Apply an explicit mode to a file whose content did not change.
  //
  // Best-effort and returns whether it did anything, so the caller can add
  // an audit breadcrumb. A provider without chmod/stat, or a target that
  // vanished, is not worth failing the build over.
  private chmodUnchanged(path: string, mode?: number): boolean {
    if (null == mode || this.control.dryrun) {
      return false
    }

    const fs = this.fs()
    if ('function' !== typeof fs.chmodSync) {
      return false
    }

    try {
      if ('function' === typeof fs.statSync) {
        const stat = fs.statSync(path)
        if (stat && (stat.mode & 0o7777) === (mode & 0o7777)) {
          return false
        }
      }
      fs.chmodSync(path, mode)
      return true
    }
    catch (err: any) {
      dlog('save', 'chmod of unchanged file failed: ' + path)
      return false
    }
  }


  // Replace `path` atomically: write a sibling temp file, then rename it
  // over the target. Rename within a directory is atomic, so a crash, a
  // SIGINT, or a full disk leaves the user's existing file intact rather
  // than truncated or half-written. That matters most in `merge` and
  // `diff` mode, where the file being rewritten is the one holding the
  // user's hand edits.
  //
  // Rename replaces the inode, so a hard link to the target is broken and
  // the new file would otherwise take default permissions — hence the
  // mode copy below. This is the same trade-off git and npm make.
  //
  // The `fs` provider is pluggable; fall back to a direct write when it
  // has no rename.
  private writeFileAtomic(
    path: string,
    content: string | Buffer,
    opts: any,
    mode?: number,
  ) {
    const fs = this.fs()

    if ('function' !== typeof fs.renameSync) {
      fs.writeFileSync(path, content, opts)
      if (null != mode && 'function' === typeof fs.chmodSync) {
        fs.chmodSync(path, mode)
      }
      return
    }

    // A UNIQUE temp path, not a fixed one.
    //
    // The fixed `<target>.jostraca-tmp` had two failure modes. A user file
    // that happened to sit at that name was overwritten and then renamed
    // away — destroyed. Worse, two jostraca runs sharing an output folder
    // (a watcher plus a manual run, a CI matrix, a shared mount) collided
    // on the same temp path: one run's rename could publish the other
    // run's bytes onto the target while both reported success. The rename
    // is atomic, but atomicity is worthless if the source is shared.
    //
    // `wx` fails rather than clobbering, so a collision can never destroy
    // an existing file; retry with a fresh name. Providers that do not
    // support the flag simply ignore it, and the randomised name still
    // fixes the concurrent-run case.
    let tmppath = tmppathFor(path)
    let tmpopts = { ...opts, flag: 'wx' }

    // Whether THIS invocation created the temp file. The cleanup below must
    // not delete a path we only ever failed to create: on EEXIST exhaustion
    // that path holds someone else's file, and unlinking it would undo
    // exactly what the `wx` flag is here to guarantee.
    let created = false

    try {
      for (let attempt = 0; ; attempt++) {
        try {
          fs.writeFileSync(tmppath, content, tmpopts)
          created = true
          break
        }
        catch (err: any) {
          // EEXIST means `wx` refused and this call created NOTHING — that
          // is the R12 case, and `created` must stay false so the cleanup
          // does not delete somebody else's file.
          //
          // Any OTHER error (ENOSPC, EIO) happened AFTER the create
          // succeeded, so a partial temp file is on disk and is ours to
          // remove. Without this it survived the failed build.
          if ('EEXIST' !== err?.code) {
            created = true
          }
          if ('EEXIST' !== err?.code || TMP_PATH_ATTEMPTS - 1 <= attempt) {
            throw err
          }
          tmppath = tmppathFor(path)
        }
      }

      // An explicit mode wins; otherwise preserve whatever the target
      // already had, since rename replaces the inode.
      //
      // Best-effort: a provider may stat but not chmod, and losing a
      // permission bit is not worth failing the write over.
      if ('function' === typeof fs.chmodSync) {
        if (null != mode) {
          fs.chmodSync(tmppath, mode)
        }
        else if ('function' === typeof fs.statSync) {
          try {
            const stat = fs.statSync(path)
            if (stat && !stat.isDirectory()) {
              fs.chmodSync(tmppath, stat.mode)
            }
          }
          catch (err: any) {
            // Target absent (the common case for a new file): keep the
            // default mode.
          }
        }
      }

      fs.renameSync(tmppath, path)
    }
    catch (err: any) {
      try {
        if (created && 'function' === typeof fs.unlinkSync) {
          fs.unlinkSync(tmppath)
        }
      }
      catch (cleanuperr: any) {
        dlog('writeFileAtomic', 'temp cleanup failed: ' + tmppath)
      }
      throw err
    }
  }


  saveFile(
    path: string,
    content: string | Buffer,
    opts?: any | string,
    whence?: string,
  ): void {
    const when = this.now()
    const wstr = null == whence ? '' : whence + ':'
    const fs = this.fs()
    const FN = 'saveFile:'

    if ('string' === typeof opts) {
      whence = opts
      opts = {}
    }
    else {
      opts = opts || {}
    }

    opts.encoding = opts.encoding || ('string' === typeof content ? 'utf8' : undefined)

    validPath(path, this.maxdepth, FN)

    if ('string' !== typeof content && !(content as any instanceof Buffer)) {
      throw new Error(CN + FN + wstr + ' invalid content, path=' + path +
        ' content=' + content)
    }

    try {
      // Canonical path: use directly, do not re-join `this.folder` (see existsFile).
      path = fwd(Path.normalize(path))
      const fullpath = path
      const parentfolder = fwd(Path.dirname(fullpath))
      const existed = fs.existsSync(fullpath)

      if (!this.control.dryrun) {
        this.ensureDir(parentfolder)
        this.writeFileAtomic(fullpath, content, opts, opts.mode)
      }

      this.audit.push([CN + FN + wstr,
      { path, when, existed, size: content.length }])
    }
    catch (err: any) {
      this.audit.push(['ERROR:' + CN + FN + wstr,
      { path, when, size: content.length, err }])
      err.message = CN + FN + wstr + ' path=' + path + ':' + err.message
      throw err
    }
  }


  filelog(kind: string, path: string): void {
    path = fwd(path)
    let files: any = this.files
    if (files[kind]) {
      const kindlog = files[kind]
      if (path === kindlog[kindlog.length - 1]) {
        dlog('filelog', kind, 'duplicate: ' + path)
      }
      else {
        kindlog.push(path)
      }
    }
    else {
      dlog('filelog', 'invalid kind: ' + kind)
    }
  }
}


function whenify(meta: any, now: number) {
  meta.when = now
  meta.hwhen = humanify(now)
}


// Rewrite `foo/bar.txt` to `foo/bar.<kind>.txt`, used for the `.old`
// (preserve) and `.new` (present) annotations.
//
// Node's `Path.extname('.env')` is '', so a leading-dot name has no
// extension to split off and the whole basename is the stem. The previous
// implementation stripped the final `.`-suffix with a regex, which for a
// dotfile removed the entire name: every dotfile in a folder collapsed to
// the same `.old` path, so a second dotfile silently destroyed the first
// one's backup.
function annotatedPath(target: string, kind: string): string {
  const dir = Path.dirname(target)
  const base = Path.basename(target)
  const ext = Path.extname(base)
  const stem = 0 === ext.length ? base : base.substring(0, base.length - ext.length)
  return fwd(Path.join(dir, stem + '.' + kind + ext))
}


// Reject path traversal in a component name. Names compose directly into
// output paths, and models are routinely third-party data, so a name
// containing a `..` segment is an arbitrary-file-write primitive: it
// escapes not just the project folder but the output folder entirely.
//
// A leading `/` is deliberately still allowed — an absolute Folder name
// composes with the Project folder (see the `absolute_paths` parity
// scenario). `Project.folder` is likewise not checked here: it is
// developer-authored top-level configuration rather than model-derived,
// and `Project({folder: '../sibling'})` is a legitimate pattern.
function validName(name: any, kind: string, errmark: string) {
  if (null == name) {
    return
  }

  const segments = ('' + name).split(/[/\\]/)
  if (segments.includes('..')) {
    throw new Error('ERROR:' + errmark + ' ' + kind +
      ' name must not contain a ".." path segment, name=' + name)
  }
}


function validPath(path: string, maxdepth: number, errmark: string) {
  if (null == path || '' == path || 'string' !== typeof path) {
    throw new Error('ERROR:' + errmark + ' invalid path, path=' + path)
  }

  const normalized = fwd(Path.normalize(Path.dirname(path)))
  let depth = 0
  let inSegment = false
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === '/') {
      inSegment = false
    }
    else if (!inSegment) {
      depth++
      inSegment = true
    }
  }

  if (maxdepth < depth) {
    throw new Error(errmark + ' path too deep, path=' + path)
  }

}



export {
  annotatedPath,
  validName,
  validPath,
  FileHandler
}
