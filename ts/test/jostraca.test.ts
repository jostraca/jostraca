
import { test, describe } from 'node:test'
import * as Assert from 'node:assert'
import * as Fs from 'node:fs'
import * as Os from 'node:os'
import * as Path from 'node:path'
import { expect } from './expect'

import { memfs } from '../dist/util/memfs'


import {
  Jostraca,
  Project,
  Folder,
  File,
  Fragment,
  Content,
  Copy,
  Inject,
  Line,
  List,
  Slot,

  cmp,
  each,
} from '../'


const META_FOLDER = '.jostraca'
const META_FILE = 'jostraca.meta.log'

const TOP_META = '/top/' + META_FOLDER + '/' + META_FILE


// 2025-01-01T00:00:00.000Z
const START_TIME = 1735689600000


describe('jostraca', () => {

  test('happy', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))
    expect(Jostraca).exist()

    const jostraca = Jostraca({ now })
    expect(jostraca).exist()

    const { fs, vol } = memfs({})

    const info = await jostraca.generate(
      { fs: () => fs, folder: '/top' },
      () => Project({ folder: 'sdk' }, () => {

        Folder({ name: 'js' }, () => {

          File({ name: 'foo.js' }, () => {
            Content('// custom-foo\n')
          })

          File({ name: 'bar.js' }, () => {
            Content('// custom-bar\n')
          })
        })

        Folder({ name: 'go' }, () => {

          File({ name: 'zed.go' }, () => {
            Content('// custom-zed\n')
          })
        })

      })
    )

    expect(info).include({
      when: 1735689660000,
      files: {
        preserved: [],
        written: [
          '/top/sdk/js/foo.js',
          '/top/sdk/js/bar.js',
          '/top/sdk/go/zed.go'
        ],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      }
    })

    const voljson: any = vol.toJSON()

    expect(JSON.parse(voljson[TOP_META]).last > START_TIME).true()

    expect(voljson).includes({
      [TOP_META]:
        voljson[TOP_META],
      '/top/sdk/js/foo.js': '// custom-foo\n',
      '/top/sdk/js/bar.js': '// custom-bar\n',
      '/top/sdk/go/zed.go': '// custom-zed\n'
    })
  })


  // A `Line` RENDERS LIKE A `Content`, which it did not: it passed the
  // model alone, so `replace` and `extra` were dropped and a Line
  // inside a List emitted `{item.n}` verbatim where a Content in the
  // same position substituted. The Go port was already right --
  // `LineP` delegates to `ContentP` -- so this pins the TS side to it.
  test('line-renders-like-content', async () => {
    const { fs, vol } = memfs({})

    await Jostraca().generate(
      { fs: () => fs, folder: '/top' },
      () => {
        File({ name: 'a.txt' }, () => {
          List({ item: [{ n: 1 }, { n: 2 }], line: false }, [
            ({ item, replace }: any) => Line({ src: 'n={item.n}', replace }),
          ])
        })
        File({ name: 'b.txt' }, () => {
          Line({ src: 'x=$$x$$', extra: { x: 'X' } })
        })
      })

    const voljson: any = vol.toJSON()
    expect(voljson['/top/a.txt']).equal('n=1\nn=2\n')
    expect(voljson['/top/b.txt']).equal('x=X\n')
  })


  // RAW HANDS THE BYTES THROUGH UNTOUCHED, and the control is the same
  // payload without it. `Content` templates unconditionally, so every
  // `$$...$$` sequence in content jostraca did not author is
  // substituted from the generate model -- a shell script, a makefile,
  // a doc comment or a regex carrying `$$` is corrupted with no
  // diagnostic and exit 0.
  //
  // AN EMPTY MODEL IS NOT THE SAME GUARD. `$$"quoted"$$` renders its
  // own literal and `$$__JOSTRACA_REPLACE__$$` renders the matcher,
  // both with no model at all, so the two are pinned here beside the
  // model-path case: a caller who reached for `model: {}` instead of
  // `raw` still loses those two.
  test('content-raw', async () => {
    // Every $$ shape a generated file plausibly carries, in one payload.
    const payload = [
      '#!/bin/sh',
      'sed -i "s/$$path$$/x/" f',   // a model path: substituted
      'echo $$"quoted"$$',          // its own literal: substituted, model or not
      'echo $$__JOSTRACA_REPLACE__$$', // the matcher: substituted, model or not
      "awk '{print $$1}'",          // no closing pair: survives either way
      'make: $$(VAR)$$',            // no such model path: left in place
    ].join('\n') + '\n'

    const gen = async (raw?: boolean) => {
      const { fs, vol } = memfs({})
      await Jostraca().generate(
        { fs: () => fs, folder: '/top', model: { path: 'ZZZ' } },
        () => {
          File({ name: 'a.sh' }, () => {
            Content({ src: payload, raw })
          })
          File({ name: 'b.sh' }, () => {
            Line({ src: 'L $$path$$', raw })
          })
        })
      const voljson: any = vol.toJSON()
      return [voljson['/top/a.sh'], voljson['/top/b.sh']]
    }

    // WITH raw: byte-identical, the whole payload.
    const [rawA, rawB] = await gen(true)
    expect(rawA).equal(payload)
    expect(rawB).equal('L $$path$$\n')

    // WITHOUT raw, unchanged as a control: three of the six lines move.
    const [subA, subB] = await gen(false)
    expect(subA).equal([
      '#!/bin/sh',
      'sed -i "s/ZZZ/x/" f',
      'echo quoted',
      'echo /(?<J_O>\\$\\$)(?<J_R>[^$]+)(?<J_C>\\$\\$)/',
      "awk '{print $$1}'",
      'make: $$(VAR)$$',
    ].join('\n') + '\n')
    expect(subB).equal('L ZZZ\n')

    // ... and an absent `raw` is the same as `raw: false`: templating
    // is the default, and stays it.
    const [defA, defB] = await gen(undefined)
    expect(defA).equal(subA)
    expect(defB).equal(subB)
  })


  // `raw` skips the RENDER, not the placement: `indent` is where the
  // span sits in the file rather than what it says, and applies to raw
  // content exactly as to templated content. `replace` and `extra` do
  // go with it -- they are inputs to the render that is not happening.
  test('content-raw-keeps-indent-and-drops-replace', async () => {
    const { fs, vol } = memfs({})

    await Jostraca().generate(
      { fs: () => fs, folder: '/top' },
      () => {
        File({ name: 'a.txt' }, () => {
          Content({ src: 'class X {\n' })
          Content({
            src: 'y = $$n$$ {tok}\n',
            indent: 2,
            raw: true,
            replace: { '{tok}': 'TOK' },
            extra: { n: 9 },
          })
          Content({ src: '}\n' })
        })
      })

    const voljson: any = vol.toJSON()
    expect(voljson['/top/a.txt']).equal(
      'class X {\n  y = $$n$$ {tok}\n}\n')
  })


  test('content', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const { fs, vol } = memfs({})

    const jostraca = Jostraca({ now })

    const info = await jostraca.generate(
      { fs: () => fs, folder: '/top' },
      () => {
        Folder({}, () => {
          File({ name: 'foo.txt' }, () => {
            Content('A')
          })
        })
      }
    )

    expect(info).include({
      when: 1735689660000,
      files: {
        preserved: [],
        written: ['/top/foo.txt'],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      }
    })

    const voljson: any = vol.toJSON()

    expect(JSON.parse(voljson[TOP_META]).last > 0).true()
    expect(voljson).include({
      '/top/foo.txt': 'A',
      '/top/.jostraca/generated/foo.txt': 'A',
      '/top/.jostraca/jostraca.meta.log': '{\n' +
        '  "foldername": ".jostraca",\n' +
        '  "filename": "jostraca.meta.log",\n' +
        '  "last": 1735689900000,\n' +
        '  "hlast": 2025010100050000,\n' +
        '  "files": {\n' +
        '    "foo.txt": {\n' +
        '      "action": "write",\n' +
        '      "path": "foo.txt",\n' +
        '      "exists": false,\n' +
        '      "actions": [\n' +
        '        "write"\n' +
        '      ],\n' +
        '      "protect": false,\n' +
        '      "conflict": false,\n' +
        '      "when": 1735689840000,\n' +
        '      "hwhen": 2025010100040000\n' +
        '    }\n' +
        '  }\n' +
        '}',
      '/top/.jostraca/.gitignore': '\njostraca.meta.log\ngenerated\n'
    })
  })



  // TWO FILES AT ONE PATH IS REFUSED, on every road in rather than only
  // the one that asked for it. `aontu render` refuses an absolute path,
  // a `..` segment and a DUPLICATE over its unit list; the first two
  // were already here (`validName`, and `cmpTree`'s folder check) and
  // the third was the gap. It is the build phase's business because
  // that is where the path is final.
  //
  // FileHandler already noticed the same thing at `savedPaths` and
  // could only warn, because `Inject` legitimately saves to a path a
  // `File` in the same run created. This sees the two statements that
  // cannot both be true.
  test('two-files-at-one-path-are-refused', async () => {
    const refused = async (root: Function) => {
      const { fs } = memfs({})
      try {
        await Jostraca().generate({ fs: () => fs, folder: '/top' }, root)
      }
      catch (err: any) {
        return err.message
      }
      return undefined
    }

    Assert.match(await refused(() => {
      File({ name: 'a.txt' }, () => Content('one'))
      File({ name: 'a.txt' }, () => Content('two'))
    }) as string, /two File components resolve to the same output path/)

    // Two different statements of nesting arriving at one file: neither
    // name is a duplicate of the other.
    Assert.match(await refused(() => {
      Folder({ name: 'x' }, () => File({ name: 'a.txt' }, () => Content('one')))
      File({ name: 'x/a.txt' }, () => Content('two'))
    }) as string, /path=\/top\/x\/a\.txt/)

    // A LIST OVER FILES IS THE NORMAL GENERATOR and must not break: the
    // name is computed in the host language, so each pass names a
    // different file.
    const { fs, vol } = memfs({})
    const info = await Jostraca().generate(
      { fs: () => fs, folder: '/top' },
      () => List({ item: [{ n: 1 }, { n: 2 }], line: false }, [
        ({ item }: any) =>
          File({ name: 'f' + item.n + '.txt' }, () => Content('n=' + item.n)),
      ]))

    expect(info.files.written).equal(['/top/f1.txt', '/top/f2.txt'])
    const voljson: any = vol.toJSON()
    expect(voljson['/top/f1.txt']).equal('n=1')
    expect(voljson['/top/f2.txt']).equal('n=2')
  })


  // THE CLAIM IS ON THE CANONICAL PATH, so two lexically different
  // names for one file are one file. `a.txt` and `./a.txt` claimed two
  // paths and `FileHandler.save` then normalised both to one and let the
  // second overwrite the first -- the exact loss the guard exists to
  // refuse, slipping past it on a `./`. Go has never had it:
  // `fileBefore` cleans the path before it records anything.
  test('a-duplicate-path-is-refused-however-it-is-spelled', async () => {
    const refused = async (root: Function) => {
      const { fs } = memfs({})
      try {
        await Jostraca().generate({ fs: () => fs, folder: '/top' }, root)
      }
      catch (err: any) {
        return err.message
      }
      return undefined
    }

    Assert.match(await refused(() => {
      File({ name: 'a.txt' }, () => Content('FIRST'))
      File({ name: './a.txt' }, () => Content('SECOND'))
    }) as string, /same output path, path=\/top\/a\.txt/)

    Assert.match(await refused(() => {
      Folder({ name: 'x' }, () => File({ name: 'a.txt' }, () => Content('FIRST')))
      File({ name: 'x/./a.txt' }, () => Content('SECOND'))
    }) as string, /path=\/top\/x\/a\.txt/)

    // A `..` in a File NAME is refused by validName before any of this,
    // so the canonical form can never climb out of the output folder.
    Assert.match(await refused(() => {
      File({ name: '../escaped.txt' }, () => Content('x'))
    }) as string, /must not contain a "\.\." path segment/)

    // Two files that only LOOK similar are still two files.
    const { fs, vol } = memfs({})
    const info = await Jostraca().generate(
      { fs: () => fs, folder: '/top' },
      () => {
        File({ name: 'a.txt' }, () => Content('A'))
        File({ name: './b.txt' }, () => Content('B'))
      })
    expect(info.files.written).equal(['/top/a.txt', '/top/b.txt'])
    const voljson: any = vol.toJSON()
    expect(voljson['/top/a.txt']).equal('A')
    expect(voljson['/top/b.txt']).equal('B')
  })


  // AN INJECT INTO A FILE THE SAME RUN CREATED IS NOT A DUPLICATE, and
  // is why the guard counts `File` nodes rather than saves. Both reach
  // `FileHandler.save` with the same path, and the second is the
  // intended edit of the first.
  test('inject-into-a-generated-file-is-not-a-duplicate', async () => {
    const { fs, vol } = memfs({})

    await Jostraca().generate(
      { fs: () => fs, folder: '/top' },
      () => {
        File({ name: 'a.txt' }, () => {
          Content('A\n#--START--#\n\n#--END--#\nB\n')
        })
        Inject({ name: 'a.txt' }, () => {
          Content('INJECTED\n')
        })
      })

    const voljson: any = vol.toJSON()
    expect(voljson['/top/a.txt'])
      .equal('A\n#--START--#\nINJECTED\n\n#--END--#\nB\n')
  })


  test('basic-copy', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const { fs, vol } = memfs({
      '/tm/bar.txt': '// BAR $$x.z$$ TXT\n',
      '/tm/bar.txt~': '// BAR TXT\n',
      '/tm/sub/a.txt': '// SUB-A $$x.y$$ TXT\n',
      '/tm/sub/b.txt': '// SUB-B $$x.y$$ TXT\n',
      '/tm/sub/c/d.txt': '// SUB-C-D $$x.y$$ $$x.z$$ TXT\n',
    })

    const jostraca = Jostraca({
      now,
      model: { x: { y: 'Y', z: 'Z' } }
    })

    const info = await jostraca.generate(
      { fs: () => fs, folder: '/top' },
      cmp((_props: any) => {
        Project({ folder: 'sdk' }, () => {

          Folder({ name: 'js' }, () => {

            File({ name: 'foo.js' }, () => {
              Content('// custom-foo\n')
            })

            Copy({ from: '/tm/bar.txt', to: 'bar.txt' })
            Copy({ from: '/tm/sub' })
          })
        })
      })
    )

    expect(info).include({
      when: 1735689660000,
      files: {
        preserved: [],
        written: [
          '/top/sdk/js/foo.js',
          '/top/sdk/js/bar.txt',
          '/top/sdk/js/a.txt',
          '/top/sdk/js/b.txt',
          '/top/sdk/js/c/d.txt'
        ],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      }
    })

    const voljson: any = vol.toJSON()

    expect(JSON.parse(voljson[TOP_META]).last > 0).true()
    expect(voljson).includes({
      [TOP_META]: voljson[TOP_META],

      '/tm/bar.txt': '// BAR $$x.z$$ TXT\n',
      '/tm/bar.txt~': '// BAR TXT\n',
      '/tm/sub/a.txt': '// SUB-A $$x.y$$ TXT\n',
      '/tm/sub/b.txt': '// SUB-B $$x.y$$ TXT\n',
      '/tm/sub/c/d.txt': '// SUB-C-D $$x.y$$ $$x.z$$ TXT\n',

      '/top/sdk/js/foo.js': '// custom-foo\n',
      '/top/sdk/js/bar.txt': '// BAR Z TXT\n',
      '/top/sdk/js/a.txt': '// SUB-A Y TXT\n',
      '/top/sdk/js/b.txt': '// SUB-B Y TXT\n',
      '/top/sdk/js/c/d.txt': '// SUB-C-D Y Z TXT\n',
    })
  })


  // `cmp.Copy.ignore` — the caller's own ignore list, matched against the
  // bare NAME of every entry, directories included.
  //
  // EVERY PATTERN IN THE LIST APPLIES, which is what this is really pinning.
  // The list is merged over jostraca's own default of `[/~$/]` by `deep`,
  // which used to walk INTO index 0 (two RegExps are both objects) and copy
  // the enumerable properties of one into the other — of which a RegExp has
  // none. So index 0 was discarded and the default silently reinstated: the
  // first pattern a caller passed never matched anything. sdkgen lost
  // `.DS_Store` that way, and worked around it by leading its list with a
  // duplicate `/~$/`.
  test('copy-ignore', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const { fs, vol } = memfs({
      '/tm/keep.txt': 'KEEP\n',
      '/tm/.DS_Store': 'FINDER\n',
      '/tm/backup.txt~': 'BACKUP\n',
      '/tm/__pycache__/mod.pyc': 'COMPILED\n',
      '/tm/sub/keep.txt': 'SUB-KEEP\n',
      '/tm/sub/.DS_Store': 'FINDER\n',
    })

    const jostraca = Jostraca({ now })

    const info = await jostraca.generate(
      {
        fs: () => fs, folder: '/top',
        // `.DS_Store` FIRST, deliberately: that is the position the merge
        // used to eat.
        cmp: { Copy: { ignore: [/^\.DS_Store$/, /^__pycache__$/] } },
      },
      cmp(() => {
        Project({ folder: 'sdk' }, () => {
          Copy({ from: '/tm' })
        })
      })
    )

    expect(info.files.written).equal([
      '/top/sdk/keep.txt',
      '/top/sdk/sub/keep.txt',
    ])

    const voljson: any = vol.toJSON()
    const copied = Object.keys(voljson)
      .filter((p: string) => p.startsWith('/top/sdk/'))
      .sort()

    // Naming a directory prunes its whole subtree, and the built-in `~`
    // rule still applies alongside the caller's list.
    expect(copied).equal(['/top/sdk/keep.txt', '/top/sdk/sub/keep.txt'])
  })


  // A directory Copy walks its source in readdirSync().sort() order, which
  // is JavaScript's UTF-16 code unit order: a name starting with U+1F600
  // (a surrogate pair) sorts BEFORE one starting with U+FF5A, where byte
  // order puts it after. files.written and the meta log follow the walk,
  // so the order is pinned on memfs and on the real filesystem, and
  // go/copy_test.go pins the same list.
  const COPY_ORDER = [
    '10.txt', '9.txt', 'B.txt', 'Z.txt', '_x.txt', 'a.txt',
    '\u00e9.txt', '\u{1F600}.txt', '\uFF5A.txt',
  ]

  async function copyOrder(fs: any, src: string, out: string, join: Function) {
    const info = await Jostraca({ now: () => 0 }).generate(
      { fs: () => fs, folder: out },
      cmp(() => { Project({ folder: '.' }, () => { Copy({ from: src }) }) }))
    expect(info.files.written.map((p: string) => Path.basename(p)))
      .equal(COPY_ORDER)
    const meta = JSON.parse(fs.readFileSync(
      join(out, '.jostraca', 'jostraca.meta.log'), 'utf8'))
    expect(Object.keys(meta.files)).equal(COPY_ORDER)
  }

  test('copy-order-utf16-memfs', async () => {
    const files: any = {}
    for (const n of COPY_ORDER) { files['/tpl/order/' + n] = n + '\n' }
    await copyOrder(memfs(files).fs, '/tpl/order', '/out', Path.posix.join)
  })

  test('copy-order-utf16-realfs', async () => {
    const dir = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'jostraca-order-'))
    try {
      Fs.mkdirSync(Path.join(dir, 'tpl'))
      for (const n of COPY_ORDER) {
        Fs.writeFileSync(Path.join(dir, 'tpl', n), n + '\n')
      }
      await copyOrder(Fs, Path.join(dir, 'tpl'), Path.join(dir, 'out'), Path.join)
    }
    finally {
      Fs.rmSync(dir, { recursive: true, force: true })
    }
  })


  // The meta log is JSON.stringify output, so '&', '<', '>' and U+2028 in
  // a path are written raw. go/filehandler_test.go
  // TestMetaLogQuotesLikeJSONStringify holds these bytes as its golden.
  test('meta-log-quotes-raw', async () => {
    const { fs, vol } = memfs({})
    await Jostraca({ now: () => START_TIME }).generate(
      { fs: () => fs, folder: '/out' },
      cmp(() => {
        Project({ folder: '.' }, () => {
          for (const n of ['a&b.txt', 'x<y>.txt', 'u\u2028v.txt']) {
            File({ name: n }, () => { Content('A\n') })
          }
        })
      }))
    const meta = (vol.toJSON() as any)['/out/.jostraca/jostraca.meta.log']
    for (const raw of ['"a&b.txt": {', '"path": "x<y>.txt"', '"u\u2028v.txt": {']) {
      expect(meta.includes(raw)).equal(true)
    }
    expect(/\\u(0026|003c|003e|2028)/.test(meta)).equal(false)
  })


  // A model path resolves through OWN properties only, so a macro naming
  // an Object.prototype member is an unresolved path and stays in place;
  // it used to render the member ('A[object Undefined]B') or throw. And a
  // path through a null intermediate is a miss rather than a TypeError
  // that aborted the whole generate.
  test('macro-own-properties-only', async () => {
    const { fs, vol } = memfs({})
    await Jostraca({ now: () => START_TIME }).generate(
      { fs: () => fs, folder: '/out', model: { a: { n: null } } },
      cmp(() => {
        Project({ folder: '.' }, () => {
          File({ name: 'a.txt' }, () => {
            Content('A$$toString$$B\n')
            Content('C$$hasOwnProperty$$D$$a.n.x$$E\n')
          })
        })
      }))
    expect((vol.toJSON() as any)['/out/a.txt'])
      .equal('A$$toString$$B\nC$$hasOwnProperty$$D$$a.n.x$$E\n')
  })


  test('fragment-basic', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const { fs, vol } = memfs({
      '/tmp/foo.txt': 'FOO\n',
      '/tmp/bar.txt': 'BAR\n',
      '/tmp/zed.txt': 'ZED+<[SLOT]> \n',
      '/tmp/qaz.txt':
        'QAZ+<!--<[SLOT]>-->+// <[SLOT:alice]>+/* <[SLOT:bob]> */+ # <[SLOT:bob]>\n',
    })

    const jostraca = Jostraca({ now })

    const info = await jostraca.generate(
      { fs: () => fs, folder: '/top' },
      cmp((props: any) => {
        Project({ folder: 'sdk' }, () => {

          File({ name: 'foo.js' }, () => {
            Content('// custom-foo\n')
            Fragment({ from: '/tmp/foo.txt' })
            Fragment({ from: '/tmp/bar.txt', indent: '  ' })
            Content('// END\n')
          })

          File({ name: 'bar.js' }, () => {
            Fragment({ from: '/tmp/zed.txt' }, () => {
              Content('red')
            })
          })

          File({ name: 'qaz.js' }, () => {
            Fragment({ from: '/tmp/qaz.txt' }, () => {
              Content('A')

              Slot({ name: 'bob' }, () => {
                Content('B')
                Content('OB')
              })

              Content('B')

              Slot({ name: 'alice' }, () => {
                Content('ALICE')
              })

              Content('C')
            })
          })

        })
      })
    )

    expect(info).include({
      when: 1735689660000,
      files: {
        preserved: [],
        written: ['/top/sdk/foo.js', '/top/sdk/bar.js', '/top/sdk/qaz.js'],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      }
    })

    const voljson: any = vol.toJSON()

    expect(voljson).includes({
      '/tmp/foo.txt': 'FOO\n',
      '/tmp/bar.txt': 'BAR\n',
      '/tmp/zed.txt': 'ZED+<[SLOT]> \n',
      '/tmp/qaz.txt':
        'QAZ+<!--<[SLOT]>-->+// <[SLOT:alice]>+/* <[SLOT:bob]> */+ # <[SLOT:bob]>\n',

      '/top/sdk/bar.js': 'ZED+red\n',
      '/top/sdk/qaz.js': 'QAZ+ABC+ALICE+BOB+BOB\n',
      '/top/sdk/foo.js': '// custom-foo\nFOO\n  BAR\n// END\n',

      [TOP_META]: voljson[TOP_META],
    })
  })


  test('fragment-nonslot-child-without-default-slot', async () => {
    // Non-Slot children fill the unnamed <[SLOT]> marker. With no unnamed
    // marker in the source there is nowhere for them to go; that used to
    // drop them silently (both stacks), so it is now an error.
    const { fs } = memfs({
      // Named marker only -- no unnamed <[SLOT]>.
      '/tmp/named.txt': 'Q+// <[SLOT:alice]>\n',
      '/tmp/plain.txt': 'Q\n',
      '/tmp/both.txt': 'Q+<[SLOT]>+// <[SLOT:alice]>\n',
    })

    const gen = (from: string) => Jostraca({}).generate(
      { fs: () => fs, folder: '/top' },
      () => Project({}, () => {
        File({ name: 'foo.txt' }, () => {
          Fragment({ from }, () => {
            Content('A')
            Slot({ name: 'alice' }, () => Content('ALICE'))
          })
        })
      })
    )

    let err: any = undefined
    await gen('/tmp/named.txt').catch((e: any) => err = e)
    expect(null != err).equal(true)
    expect(/no unnamed <\[SLOT\]> marker/.test(err.message)).equal(true)
    expect(err.message.includes('/tmp/named.txt')).equal(true)

    err = undefined
    await gen('/tmp/plain.txt').catch((e: any) => err = e)
    expect(null != err).equal(true)

    // An unnamed marker makes the same body legal again.
    err = undefined
    await gen('/tmp/both.txt').catch((e: any) => err = e)
    expect(err).equal(undefined)
  })


  test('inject', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const { fs, vol } = memfs({
      '/top/foo.txt': 'FOO\n#--START--#\nBAR\n#--END--#\nZED',
    })

    const jostraca = Jostraca({ now })

    const info = await jostraca.generate(
      { fs: () => fs, folder: '/top' },
      cmp((_props: any) => {
        Project({}, () => {
          Inject({ name: 'foo.txt' }, () => {
            Content('QAZ')
          })
        })
      })
    )

    const voljson: any = vol.toJSON()

    expect(info).include({
      when: 1735689660000,
      files: {
        preserved: [],
        written: ['/top/foo.txt'],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      }
    })

    expect(voljson).includes({
      [TOP_META]: voljson[TOP_META],

      '/top/foo.txt': 'FOO\n#--START--#\nQAZ\n#--END--#\nZED',
    })
  })



  test('inject-dollar', async () => {
    // Regression: injected content containing `$` sequences (e.g. `$1`, `$&`,
    // `$\``, and shell/PHP/JS variables) must be inserted literally and not be
    // interpreted as String.replace replacement patterns.
    const { fs, vol } = memfs({
      '/top/foo.txt': 'FOO\n#--START--#\nBAR\n#--END--#\nZED',
    })

    const jostraca = Jostraca({})

    await jostraca.generate(
      { fs: () => fs, folder: '/top' },
      cmp((_props: any) => {
        Project({}, () => {
          Inject({ name: 'foo.txt' }, () => {
            Content('price=$100 g$1h $& end$`')
          })
        })
      })
    )

    const voljson: any = vol.toJSON()
    expect(voljson['/top/foo.txt'])
      .equal('FOO\n#--START--#\nprice=$100 g$1h $& end$`\n#--END--#\nZED')
  })



  test('inject-custom-markers', async () => {
    // Regression: custom markers containing regex metacharacters must be
    // matched literally (markers are escaped before building the regex).
    const { fs, vol } = memfs({
      '/top/bar.txt': 'A/*S*/old/*E*/B',
    })

    const jostraca = Jostraca({})

    await jostraca.generate(
      { fs: () => fs, folder: '/top' },
      cmp((_props: any) => {
        Project({}, () => {
          Inject({ name: 'bar.txt', markers: ['/*S*/', '/*E*/'] }, () => {
            Content('NEW')
          })
        })
      })
    )

    const voljson: any = vol.toJSON()
    expect(voljson['/top/bar.txt']).equal('A/*S*/NEW/*E*/B')
  })



  test('relative-folder', async () => {
    // Regression: a relative non-`.` output folder must not double-prefix the
    // output path. Previously the FileHandler FS methods re-joined
    // `this.folder` onto an already folder-prefixed path, producing e.g.
    // `reltest/reltest/foo.txt` and silently breaking preserve/merge.
    const { fs, vol } = memfs({})

    const jostraca = Jostraca({})

    await jostraca.generate(
      { fs: () => fs, folder: 'reltest' },
      cmp((_props: any) => {
        Project({}, () => {
          File({ name: 'foo.txt' }, () => Content('HELLO\n'))
        })
      })
    )

    const voljson: any = vol.toJSON()
    const keys = Object.keys(voljson)

    // No path doubles the output folder.
    expect(keys.filter((k: string) => k.includes('reltest/reltest'))).equal([])

    // The generated file is present exactly once with the right content.
    const fooKeys = keys.filter((k: string) => k.endsWith('reltest/foo.txt'))
    expect(fooKeys.length).equal(1)
    expect(voljson[fooKeys[0]]).equal('HELLO\n')
  })



  test('top-level-siblings', async () => {
    // Regression (jostraca/jostraca#21): bare top-level components with no
    // Project or Folder wrapper used to have the FIRST one become the tree
    // root, orphaning every sibling after it. generate() returned success
    // and the later files simply were not there.
    const { fs, vol } = memfs({})

    const jostraca = Jostraca({})

    await jostraca.generate(
      { fs: () => fs, folder: '/top' },
      () => {
        File({ name: 'a.txt' }, () => Content('AAA'))
        File({ name: 'b.txt' }, () => Content('BBB'))
        Folder({ name: 'sub' }, () => {
          File({ name: 'c.txt' }, () => Content('CCC'))
        })
      }
    )

    const voljson: any = vol.toJSON()

    expect(voljson['/top/a.txt']).equal('AAA')
    expect(voljson['/top/b.txt']).equal('BBB')
    expect(voljson['/top/sub/c.txt']).equal('CCC')
  })


  test('line', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const { fs, vol } = memfs({
    })

    const jostraca = Jostraca({ now })

    const info = await jostraca.generate(
      { fs: () => fs, folder: '/top' },
      cmp((_props: any) => {
        Project({}, () => {
          File({ name: 'foo.txt' }, () => {
            Content('ONE\n')
            Line('TWO')
            Content('THREE\n')
          })
        })
      })
    )

    expect(info).include({
      when: 1735689660000,
      files: {
        preserved: [],
        written: ['/top/foo.txt'],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      }
    })

    const voljson: any = vol.toJSON()

    expect(voljson).includes({
      [TOP_META]: voljson[TOP_META],

      '/top/foo.txt': 'ONE\nTWO\nTHREE\n',
    })
  })


  // AN EXPRESSION-BODIED ARROW RETURNS WHAT `each` RETURNS.
  //
  //     '// #Marker': () => each(list, (x) => Line(...))
  //
  // is a generator that emits, and also hands back an array with one
  // undefined per item, purely because the arrow has no braces. Both
  // channels are live, and only the emission was meant.
  //
  // Before the return value was JSONified this reached the output as
  // ',,,' -- close enough to blank to go unseen for a long time. As JSON
  // it became `[null,null,null]` in the middle of generated source:
  // invalid syntax, exit 0, no diagnostic. The block-bodied form of the
  // same generator was always correct, so the two spellings had to stop
  // producing different files.
  //
  // The emission wins; the accidental return is dropped. A handler that
  // emits NOTHING still substitutes its return value, which is what
  // `zed` and `obj` pin here -- see template.test
  // `replace-function-jsonifies-objects` for that contract in full.
  test('fragment-replace-emit-wins-over-return', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const { fs, vol } = memfs({
      '/f01.txt': 'A[arrow]B[block]C[zed]D[obj]E\n'
    })

    const items = [{ name: 'x' }, { name: 'y' }, { name: 'z' }]

    const jostraca = Jostraca({ now, model: {} })

    await jostraca.generate(
      { fs: () => fs, folder: '/top' },
      cmp((_props: any) => {
        Project({}, () => {
          File({ name: 'foo.txt' }, () => {
            Fragment({
              from: '/f01.txt',
              replace: {
                // Emits AND returns each()'s array of undefined.
                '[arrow]': () => each(items, (i: any) => Line(i.name)),

                // The same generator, written so it returns nothing.
                '[block]': () => { each(items, (i: any) => Line(i.name)) },

                // Emits nothing: the return value is the replacement.
                '[zed]': () => 'ZED',

                // Emits nothing: an object return is still JSONified.
                '[obj]': () => ({ b: 1, a: 2 }),
              }
            })
          })
        })
      })
    )

    const voljson: any = vol.toJSON()

    // The two generators produce the SAME text, and neither leaves an
    // array behind.
    expect(voljson['/top/foo.txt'])
      .equal('Ax\ny\nz\nBx\ny\nz\nCZEDD{"a":2,"b":1}E\n')
  })


  test('fragment-subcmp', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const { fs, vol } = memfs({
      '/f01.txt': 'TWO-$$a$$-bar-zed-con-foo+<[SLOT]>\n'
    })

    const Foo = cmp(function Foo(props: any) {
      Content('FOO[')
      Content(props.arg)
      Content(']')
    })


    const jostraca = Jostraca({
      now,
      model: { a: 'A' }
    })

    const info = await jostraca.generate(
      {
        fs: () => fs, folder: '/top',
        // build: false
      },
      cmp((_props: any) => {

        Project({}, () => {
          File({ name: 'foo.txt' }, () => {
            Content('ONE\n')
            Fragment({
              from: '/f01.txt', replace: {
                bar: 'BAR',
                zed: () => 'ZED',
                con: () => Content('CON'),
                foo: () => Foo('B')
              }
            }, () => {
              Content('S')
            })
            Content('THREE\n')
          })
        })
      })
    )

    expect(info).include({
      when: 1735689660000,
      files: {
        preserved: [],
        written: ['/top/foo.txt'],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      }
    })

    const voljson: any = vol.toJSON()

    expect(voljson).includes({
      [TOP_META]: voljson[TOP_META],
      '/f01.txt': 'TWO-$$a$$-bar-zed-con-foo+<[SLOT]>\n',
      '/top/foo.txt': 'ONE\nTWO-A-BAR-ZED-CON-FOO[B]+S\nTHREE\n',
    })
  })



  test('custom-cmp', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const Foo = cmp(function Foo(props: any, children: any) {
      const { ctx$: { model } } = props
      Content(`FOO[$$a$$:${props.b}`)
      each(model.foo, (foo) => each(children, { call: true, args: foo }))
      Content(']')
    })


    const jostraca = Jostraca({
      now,
      model: {
        a: 'A', foo: {
          a: { x: 11 },
          b: { x: 22 }
        }
      },
      mem: true,
      vol: {
        '/f01.txt': '<foo>'
      }
    })

    const info = await jostraca.generate(
      { folder: '/' },
      cmp(() => {
        Project({}, () => {
          File({ name: 'foo.txt' }, () => {
            Content('{')
            Fragment({
              from: '/f01.txt',
              replace: {
                foo: () => Foo({ b: 'B' }, (foo: any) => {
                  Content(`:${foo.key$}=(`)
                  Content(`${foo.x}`)
                  Content(')')
                })
              }
            })
            Content('}')
          })
        })
      })
    )

    expect(info).includes({
      when: 1735689660000,
      files: {
        preserved: [],
        written: ['/foo.txt'],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      },
    })

    const voljson: any = (info.vol as any)().toJSON()

    expect(voljson).includes({
      '/f01.txt': '<foo>',
      '/foo.txt': '{<FOO[A:B:a=(11):b=(22)]>}',
      ['/' + META_FOLDER + '/' + META_FILE]: voljson['/' + META_FOLDER + '/' + META_FILE],
    })
  })


  test('existing-file', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const jostraca = Jostraca({
      now,
      mem: true,
      vol: {
        '/f01.txt': 'a0',
        '/h01.txt': 'c0',
      }
    })

    const info0 = await jostraca.generate(
      { folder: '/', existing: { txt: { write: false } } },
      cmp(() => {
        Project({}, () => {
          File({ name: 'f01.txt' }, () => {
            Content('a1')
          })
          File({ name: 'g01.txt' }, () => {
            Content('b1')
          })
        })
      })
    )

    expect(info0).includes({
      when: 1735689660000,
      files: {
        preserved: [],
        written: ['/g01.txt'],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      },
    })

    const voljson0: any = (info0.vol as any)().toJSON()

    expect(voljson0).includes({
      '/f01.txt': 'a0',
      '/g01.txt': 'b1',
      '/h01.txt': 'c0',
      ['/' + META_FOLDER + '/' + META_FILE]: voljson0['/' + META_FOLDER + '/' + META_FILE],
    })


    const info1 = await jostraca.generate(
      { folder: '/', existing: { txt: { preserve: true } } },
      cmp(() => {
        Project({}, () => {
          File({ name: 'f01.txt' }, () => {
            Content('a1')
          })
          File({ name: 'h01.txt' }, () => {
            Content('c0')
          })
        })
      })
    )

    // h01.txt is generated byte-identical to what is already on disk, so
    // it is reported as unchanged and not rewritten — rewriting it would
    // bump mtime for no reason and re-trigger every downstream watcher.
    expect(info1).includes({
      when: 1735690260000,
      files: {
        preserved: ['/f01.txt'],
        written: ['/f01.txt'],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: ['/h01.txt']
      },
    })

    const voljson1: any = (info1.vol as any)().toJSON()

    expect(voljson1).includes({
      '/f01.txt': 'a1',
      '/f01.old.txt': 'a0',
      '/h01.txt': 'c0',
      ['/' + META_FOLDER + '/' + META_FILE]: voljson1['/' + META_FOLDER + '/' + META_FILE],
    })


    const info2 = await jostraca.generate(
      { folder: '/', existing: { txt: { write: false, present: true } } },
      cmp(() => {
        Project({}, () => {
          File({ name: 'f01.txt' }, () => {
            Content('a2')
          })
        })
      })
    )

    // console.dir(info2.audit(), { depth: null })

    // One tick earlier than before: the clock in this test advances on
    // every now() call, and skipping the no-op rewrite of h01.txt above
    // removes one such call.
    expect(info2).includes({
      when: 1735691160000,
      files: {
        preserved: [],
        written: [],
        presented: ['/f01.txt'],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      },
    })

    const voljson2: any = (info2.vol as any)().toJSON()

    expect(voljson2).includes({
      '/f01.txt': 'a1',
      '/f01.new.txt': 'a2',
      '/h01.txt': 'c0',
      ['/' + META_FOLDER + '/' + META_FILE]: voljson2['/' + META_FOLDER + '/' + META_FILE],
    })


  })


  test('existing-copy', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const { fs, vol } = memfs({
      '/top/tm0/foo.txt': 'F0\nF1\nF2\n',
      '/top/tm0/bar.txt': 'B0\nB1\nB2\n',
      '/top/tm1/zed.txt': 'Z0\nZ1\nZ2\n',
      '/top/tm2/qaz.bin': Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]),
      '/top/tm2/haz.bin': Buffer.from([0x05, 0x06, 0x07, 0x08, 0x09]),
      '/top/p0/bar.txt': 'B0\nB8\nB9\n',
      '/top/p0/zed.txt': 'Z0\nZ7\nZ8\nZ9',
      '/top/p0/haz.bin': Buffer.from([0x09, 0x08, 0x07, 0x06, 0x05]),
    })

    const jostraca = Jostraca({ now })

    const info = await jostraca.generate(
      {
        fs: () => fs, folder: '/top',
        existing: { txt: { diff: true }, bin: { preserve: true } },
      },
      cmp(() => {
        Project({ folder: 'p0' }, () => {
          Folder({}, () => {
            Copy({ from: '/top/tm0' })
            Copy({ from: '/top/tm1/zed.txt' })
            Copy({ from: '/top/tm2' })
          })
        })
      })
    )

    expect(info.files).include({
      preserved: ['/top/p0/haz.bin'],
      written: ['/top/p0/foo.txt', '/top/p0/haz.bin', '/top/p0/qaz.bin'],
      presented: [],
      diffed: ['/top/p0/bar.txt', '/top/p0/zed.txt'],
      merged: [],
      conflicted: ['/top/p0/bar.txt', '/top/p0/zed.txt'],
      unchanged: []
    })

    const voljson: any = vol.toJSON()

    expect(JSON.parse(voljson[TOP_META]).last > 0).true()
    expect(voljson).includes({
      [TOP_META]: voljson[TOP_META],

      '/top/tm0/foo.txt': 'F0\nF1\nF2\n',
      '/top/tm0/bar.txt': 'B0\nB1\nB2\n',
      '/top/tm1/zed.txt': 'Z0\nZ1\nZ2\n',
      '/top/tm2/haz.bin': '\x05\x06\x07\b\t',
      '/top/tm2/qaz.bin': '\x00\x01\x02\x03\x04',

      '/top/p0/bar.txt': 'B0\n' +
        '<<<<<<< EXISTING: 1969-12-31T23:59:59.999Z/diff\n' +
        'B8\n' +
        'B9\n' +
        '>>>>>>> EXISTING: 1969-12-31T23:59:59.999Z/diff\n' +
        '<<<<<<< GENERATED: 2025-01-01T00:01:00.000Z/diff\n' +
        'B1\n' +
        'B2\n' +
        '>>>>>>> GENERATED: 2025-01-01T00:01:00.000Z/diff\n',
      // zed.txt's last existing line has no trailing newline. The previous
      // (jsdiff-based) render glued the closing marker onto it, producing
      // `Z9>>>>>>> EXISTING: ...` — a marker that does not start its own
      // line, which no tool or human can parse as a conflict. The marker
      // now always starts at column 0.
      '/top/p0/zed.txt': 'Z0\n' +
        '<<<<<<< EXISTING: 1969-12-31T23:59:59.999Z/diff\n' +
        'Z7\n' +
        'Z8\n' +
        'Z9\n' +
        '>>>>>>> EXISTING: 1969-12-31T23:59:59.999Z/diff\n' +
        '<<<<<<< GENERATED: 2025-01-01T00:01:00.000Z/diff\n' +
        'Z1\n' +
        'Z2\n' +
        '>>>>>>> GENERATED: 2025-01-01T00:01:00.000Z/diff\n',
      '/top/p0/haz.bin': '\x05\x06\x07\b\t',
      '/top/p0/foo.txt': 'F0\nF1\nF2\n',
      '/top/p0/haz.old.bin': '\t\b\x07\x06\x05',
      '/top/p0/qaz.bin': '\x00\x01\x02\x03\x04',

      '/top/.jostraca/generated/p0/foo.txt': 'F0\nF1\nF2\n',
      '/top/.jostraca/generated/p0/bar.txt': 'B0\nB1\nB2\n',
      '/top/.jostraca/generated/p0/zed.txt': 'Z0\nZ1\nZ2\n',
      '/top/.jostraca/generated/p0/haz.bin': '\x05\x06\x07\b\t',
      '/top/.jostraca/generated/p0/qaz.bin': '\x00\x01\x02\x03\x04',
    })
  })


  test('protect', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))

    const { fs, vol } = memfs({
      '/top/t0/p0/foo.txt': 'FOO new',
      '/top/t0/p0/bar.txt': 'BAR new',
      '/top/t0/p1/z0.txt': 'z0 new',
      '/top/t0/p1/z1.txt': 'z1 new',

      '/top/s0/p0/foo.txt': 'foo old # JOSTRACA_PROTECT',
      '/top/s0/p0/bar.txt': 'bar old',
      '/top/s0/p1/z0.txt': 'z0 old',
      '/top/s0/p1/z1.txt': 'z1 old # JOSTRACA_PROTECT',
    })

    const debugs: any[] = []

    const log = {
      info: (...args: any[]) => { },
      debug: (...args: any[]) => {
        debugs.push(args)
      },
    }
    const jostraca = Jostraca({ now, log })

    const info = await jostraca.generate(
      { fs: () => fs, folder: '/top' },
      cmp((_props: any) => {
        Project({ folder: 's0' }, () => {

          Folder({ name: 'p0' }, () => {

            File({ name: 'foo.txt' }, () => {
              Content('FOO new')
            })

            File({ name: 'bar.txt' }, () => {
              Content('BAR new')
            })
          })

          Copy({ from: '/top/t0' })
        })
      })
    )

    // NOTE: this is a deliberate duplicate file write due to the Copy
    expect(debugs[0][0].point).equal('jostraca-warning')

    expect(info).include({
      when: 1735689660000,
      files: {
        preserved: [],
        written: ['/top/s0/p0/bar.txt', '/top/s0/p1/z0.txt'],
        presented: [],
        diffed: [],
        merged: [],
        conflicted: [],
        unchanged: []
      }
    })

    const voljson: any = vol.toJSON()

    expect(JSON.parse(voljson[TOP_META]).last > 0).true()
    expect(voljson).includes({
      [TOP_META]:
        voljson[TOP_META],

      '/top/t0/p0/foo.txt': 'FOO new',
      '/top/t0/p0/bar.txt': 'BAR new',
      '/top/t0/p1/z0.txt': 'z0 new',
      '/top/t0/p1/z1.txt': 'z1 new',

      '/top/s0/p0/foo.txt': 'foo old # JOSTRACA_PROTECT',
      '/top/s0/p0/bar.txt': 'BAR new',
      '/top/s0/p1/z0.txt': 'z0 new',
      '/top/s0/p1/z1.txt': 'z1 old # JOSTRACA_PROTECT'

    })
  })

})


// A Copy or an Inject nested INSIDE a File used to destroy the enclosing
// file. Both ops make themselves buildctx.current.file for the duration of
// their own work - Copy indirectly, by calling FileOp.before on its own node
// - and neither put the previous one back. Every later sibling then
// accumulated into the WRONG buffer, and FileOp.after wrote that buffer to
// the WRONG path.
//
// Measured before the fix:
//
//   Copy inside File   -> /out/a.txt never written at all,
//                         /out/h.txt = "HELLO\nAFTER\n" ("BEFORE" lost)
//   Inject inside File -> /out/a.txt never written at all,
//                         the Inject's pre-existing TARGET overwritten
//                         with "new contentAFTER\n", markers and all
//
// Go was correct on both counts, so TS is the side that moved. See #39 and
// the copy_in_file / inject_in_file parity snapshots, which pin the same
// two shapes across both stacks.
describe('nested-emitters', () => {

  const gen = async (fsdef: any, def: any) => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))
    const { fs, vol } = memfs(fsdef)
    await Jostraca({ now }).generate({ fs: () => fs, folder: '/out' }, cmp(def))
    const out: any = {}
    for (const [k, v] of Object.entries(vol.toJSON() as any)) {
      if (k.startsWith('/out/' + META_FOLDER)) continue
      out[k] = v
    }
    return out
  }


  test('copy-inside-file', async () => {
    const out = await gen({ '/tm/h.txt': 'HELLO\n' }, () => {
      Project({}, () => {
        File({ name: 'a.txt' }, () => {
          Content('BEFORE\n')
          Copy({ from: '/tm/h.txt' })
          Content('AFTER\n')
        })
      })
    })

    // The copied text is spliced into the enclosing file where the Copy sat
    // in source order, AND still written to its own destination.
    expect(out).equal({
      '/tm/h.txt': 'HELLO\n',
      '/out/h.txt': 'HELLO\n',
      '/out/a.txt': 'BEFORE\nHELLO\nAFTER\n',
    })
  })


  test('inject-inside-file', async () => {
    const out = await gen({
      '/tm/x': '',
      '/out/t.txt': 'HEADER\n#--START--#\nold\n#--END--#\nFOOTER\n',
    }, () => {
      Project({}, () => {
        File({ name: 'a.txt' }, () => {
          Content('BEFORE\n')
          Inject({ name: 't.txt' }, () => Content('new content'))
          Content('AFTER\n')
        })
      })
    })

    // Unlike Fragment and Slot, an Inject contributes NOTHING to the file
    // around it - it writes to its own target. The target keeps everything
    // outside the markers.
    expect(out['/out/a.txt']).equal('BEFORE\nAFTER\n')
    expect(out['/out/t.txt'])
      .equal('HEADER\n#--START--#\nnew content\n#--END--#\nFOOTER\n')
  })


  // Two Copies in one File: each has to restore independently, or the second
  // would splice into the first.
  test('two-copies-inside-file', async () => {
    const out = await gen({ '/tm/h.txt': 'H\n', '/tm/i.txt': 'I\n' }, () => {
      Project({}, () => {
        File({ name: 'a.txt' }, () => {
          Copy({ from: '/tm/h.txt' })
          Content('MID\n')
          Copy({ from: '/tm/i.txt' })
        })
      })
    })

    expect(out['/out/a.txt']).equal('H\nMID\nI\n')
    expect(out['/out/h.txt']).equal('H\n')
    expect(out['/out/i.txt']).equal('I\n')
  })


  // A Copy that is NOT inside a File is unaffected: it writes its own
  // destination and nothing else. Both orderings, because the fix restores
  // whatever current.file happened to be - which for a Copy following a File
  // is that File, already written by then.
  test('copy-outside-file-unchanged', async () => {
    const before = await gen({ '/tm/h.txt': 'HELLO\n' }, () => {
      Project({}, () => {
        Copy({ from: '/tm/h.txt' })
        File({ name: 'a.txt' }, () => Content('A\n'))
      })
    })
    expect(before).equal({
      '/tm/h.txt': 'HELLO\n',
      '/out/h.txt': 'HELLO\n',
      '/out/a.txt': 'A\n',
    })

    const after = await gen({ '/tm/h.txt': 'HELLO\n' }, () => {
      Project({}, () => {
        File({ name: 'a.txt' }, () => Content('A\n'))
        Copy({ from: '/tm/h.txt' })
      })
    })
    expect(after).equal({
      '/tm/h.txt': 'HELLO\n',
      '/out/a.txt': 'A\n',
      '/out/h.txt': 'HELLO\n',
    })
  })


  // KNOWN DEVIATION from Go, pinned deliberately rather than closed.
  //
  // A BINARY single-file Copy inside a File contributes nothing to the
  // enclosing file here, and says so on the debug channel. Its content is a
  // Buffer, and a Buffer joined into a JS string is UTF-8 decoded, so every
  // byte that is not valid UTF-8 would become U+FFFD - the splice would
  // silently corrupt the copy. A Go string is a byte string, so Go embeds the
  // bytes losslessly (TestBinaryCopyInsideFileSplicesBytes measures 20 bytes
  // there against 13 here). Closing the gap means a byte-oriented content
  // pipeline through FileHandler, for a shape - a binary inside a text file -
  // that is a user error either way. The copy itself is written intact on
  // both sides.
  test('binary-copy-inside-file-splices-nothing', async () => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))
    const { fs } = memfs({})
    const raw = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe])
    fs.mkdirSync('/tm', { recursive: true })
    fs.writeFileSync('/tm/i.png', raw)

    await Jostraca({ now }).generate(
      { fs: () => fs, folder: '/out' },
      cmp(() => Project({}, () => {
        File({ name: 'a.txt' }, () => {
          Content('BEFORE\n')
          Copy({ from: '/tm/i.png' })
          Content('AFTER\n')
        })
      })))

    expect([...fs.readFileSync('/out/a.txt')])
      .equal([...Buffer.from('BEFORE\nAFTER\n')])
    expect([...fs.readFileSync('/out/i.png')]).equal([...raw])
  })


  // A DIRECTORY Copy never becomes current.file in the first place, so it
  // contributes no text to the file around it - in either stack. Pinned so
  // the single-file splice cannot quietly grow to cover the tree walk.
  test('directory-copy-inside-file-splices-nothing', async () => {
    const out = await gen({ '/tm/d/x.txt': 'X\n', '/tm/d/y.txt': 'Y\n' }, () => {
      Project({}, () => {
        File({ name: 'a.txt' }, () => {
          Content('BEFORE\n')
          Copy({ from: '/tm/d', to: 'sub' })
          Content('AFTER\n')
        })
      })
    })

    expect(out['/out/a.txt']).equal('BEFORE\nAFTER\n')
    expect(out['/out/sub/x.txt']).equal('X\n')
    expect(out['/out/sub/y.txt']).equal('Y\n')
  })

})


// Directory-only state. `vol.toJSON()` records an empty directory as
// `null` -- a populated one is stood for by its children -- and until the
// Go port's MemFS.Vol() learned the same convention nothing could compare
// the two stacks on it. Two behaviours hid behind that: an empty Folder
// was materialised here and not in Go, and a dry run created the whole
// output tree in Go while writing no files.
//
// These pin the TS side of the agreement. See #41 and the empty_folder
// parity snapshot.
describe('directory-state', () => {

  const gen = async (control: any, def: any) => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))
    const { fs, vol } = memfs({})
    await Jostraca({ now, control })
      .generate({ fs: () => fs, folder: '/out' }, cmp(def))

    const json: any = vol.toJSON()
    const files: string[] = []
    const dirs: string[] = []
    for (const [k, v] of Object.entries(json)) {
      if (null == v) { dirs.push(k) } else { files.push(k) }
    }
    return { files: files.sort(), dirs: dirs.sort() }
  }


  test('empty-folder-is-materialised', async () => {
    const { dirs } = await gen({}, () => Project({ folder: 'app' }, () => {
      Folder({ name: 'empty' }, () => { })
      Folder({ name: 'full' }, () => {
        File({ name: 'a.txt' }, () => Content('A\n'))
      })
      Folder({ name: 'outer' }, () => {
        Folder({ name: 'inner' }, () => { })
      })
    }))

    // A directory appears only while EMPTY: `full` and `outer` each hold a
    // child, so their children stand for them.
    expect(dirs).equal(['/out/app/empty', '/out/app/outer/inner'])
  })


  // An empty FILE is not a directory: it is recorded with its (empty)
  // content, not as null.
  test('empty-file-is-not-a-directory', async () => {
    const { files, dirs } = await gen({}, () =>
      Project({ folder: 'app' }, () => File({ name: 'e.txt' }, () => { })))

    expect(files.includes('/out/app/e.txt')).true()
    expect(dirs.includes('/out/app/e.txt')).false()
  })


  // A dry run creates nothing at all, directories included. ensureFolder is
  // guarded, and so is every ensureDir call behind a write.
  test('dryrun-creates-no-directories', async () => {
    const { files, dirs } = await gen({ dryrun: true }, () =>
      Project({ folder: 'app' }, () => {
        Folder({ name: 'sub' }, () => {
          File({ name: 'a.txt' }, () => Content('SECRET\n'))
        })
      }))

    expect(files).equal([])
    expect(dirs).equal([])
  })


  // The other side of the guard, so the test above measures it rather than
  // an inert path.
  test('without-dryrun-directories-are-created', async () => {
    const { files } = await gen({}, () =>
      Project({ folder: 'app' }, () => {
        Folder({ name: 'sub' }, () => {
          File({ name: 'a.txt' }, () => Content('X\n'))
        })
      }))

    expect(files.includes('/out/app/sub/a.txt')).true()
  })

})


// A STRING child of `List` used to emit nothing at all. The wrapper that
// renders one called `Content({indent, replace})` with no `src`, so the
// string was captured by the typeof test and then dropped:
// `List({item: [...]}, 'n={item.n}\n')` produced just the trailing newline.
//
// Nothing caught it because no fixture, test or doc example passed a string
// child - the component reference documents only the function form. Found
// while probing #40 and filed as #44. Go has no string-children concept, so
// this is TS-only; the `list_string_child` parity snapshot pins that the
// shorthand desugars to exactly the explicit body Go has to write by hand.
describe('list-string-child', () => {

  const gen = async (def: any) => {
    let nowI = 0
    const now = () => START_TIME + (++nowI * (60 * 1000))
    const { fs } = memfs({})
    await Jostraca({ now }).generate({ fs: () => fs, folder: '/out' }, cmp(def))
    return fs.readFileSync('/out/a.txt', 'utf8')
  }

  const ITEMS = [{ n: 'p' }, { n: 'q' }]

  const list = (props: any, children: any) => () =>
    Project({}, () => File({ name: 'a.txt' }, () => List(props, children)))


  // The regression: the string is rendered, once per item, and `{item.path}`
  // resolves in it exactly as it does in a function child.
  test('renders-and-resolves-the-macro', async () => {
    expect(await gen(list({ item: ITEMS, line: false }, 'n={item.n}\n')))
      .equal('n=p\nn=q\n')
  })


  // A string child with no macro is still emitted once per item - the
  // failure was in the wrapper, not in the substitution.
  test('renders-a-string-with-no-macro', async () => {
    expect(await gen(list({ item: ITEMS, line: false }, 'X\n')))
      .equal('X\nX\n')
  })


  // `indent` reaches a string child automatically, unlike a function child,
  // which has to apply it. The wrapper already threaded it through.
  test('applies-indent', async () => {
    expect(await gen(list({ item: ITEMS, indent: '>>' }, 'n={item.n}\n')))
      .equal('>>n=p\n>>n=q\n\n')
  })


  // Children iterate INSIDE the item loop, so two string children give
  // a=p,b=p,a=q,b=q rather than a=p,a=q,b=p,b=q.
  test('two-string-children-interleave-per-item', async () => {
    expect(await gen(list({ item: ITEMS, line: false },
      ['a={item.n}\n', 'b={item.n}\n'])))
      .equal('a=p\nb=p\na=q\nb=q\n')
  })


  // A string child and a function child compose.
  test('mixes-with-a-function-child', async () => {
    expect(await gen(list({ item: ITEMS, line: false }, [
      's={item.n}\n',
      (props: any) => Content({ src: 'f={item.n}\n', replace: props.replace }),
    ]))).equal('s=p\nf=p\ns=q\nf=q\n')
  })


  // The documented quiet limits still hold in a string child: a bare
  // `{item}` on a scalar list yields the empty string, because getx cannot
  // address the `val$` key each() wraps a scalar in.
  test('keeps-the-bare-item-limit', async () => {
    expect(await gen(list({ item: ['a', 'b'], line: false }, 'v={item}\n')))
      .equal('v=\nv=\n')
  })

})
