// Regression tests for output-path containment and backup-file naming.
//
// These three defects share a theme: a generated path escaping where the
// caller expected it to land, or two files colliding on one backup path.
// All are data-integrity issues, so each keeps an explicit test.

import { test, describe } from 'node:test'
import { expect } from './expect'

import { memfs } from '../dist/util/memfs'

import {
  Jostraca,
  Project,
  Folder,
  File,
  Content,
} from '../'


// 2025-01-01T00:00:00.000Z
const START_TIME = 1735689600000

const outkeys = (vol: any) =>
  Object.keys(vol.toJSON()).filter((k: string) => !k.includes('.jostraca')).sort()


describe('containment', () => {

  // A File with no enclosing Project used to join onto an empty folder
  // path, producing '/<name>' — an absolute path at the filesystem root,
  // ignoring the configured output folder entirely.
  test('file-without-project-stays-in-output-folder', async () => {
    const { fs, vol } = memfs({})
    const jostraca = Jostraca({ now: () => START_TIME, fs: () => fs })

    await jostraca.generate({ folder: '/out' }, () => {
      File({ name: 'x.txt' }, () => Content('hi\n'))
    })

    expect(outkeys(vol)).equal(['/out/x.txt'])
  })


  test('folder-without-project-stays-in-output-folder', async () => {
    const { fs, vol } = memfs({})
    const jostraca = Jostraca({ now: () => START_TIME, fs: () => fs })

    await jostraca.generate({ folder: '/out' }, () => {
      Folder({ name: 'sub' }, () => {
        File({ name: 'y.txt' }, () => Content('hi\n'))
      })
    })

    expect(outkeys(vol)).equal(['/out/sub/y.txt'])
  })


  // Names compose straight into output paths and models are routinely
  // third-party data, so a `..` segment is an arbitrary-file-write.
  test('file-name-rejects-traversal', async () => {
    const { fs } = memfs({})
    const jostraca = Jostraca({ now: () => START_TIME, fs: () => fs })

    await expect(async () =>
      await jostraca.generate({ folder: '/out' }, () =>
        Project({ folder: 'p' }, () =>
          File({ name: '../../../../etc/pwned.txt' }, () => Content('OWNED\n')))))
      .rejects(/must not contain a "\.\." path segment/)
  })


  test('folder-name-rejects-traversal', async () => {
    const { fs } = memfs({})
    const jostraca = Jostraca({ now: () => START_TIME, fs: () => fs })

    await expect(async () =>
      await jostraca.generate({ folder: '/out' }, () =>
        Project({ folder: 'p' }, () =>
          Folder({ name: '../..' }, () =>
            File({ name: 'e.txt' }, () => Content('X\n'))))))
      .rejects(/must not contain a "\.\." path segment/)
  })


  // A leading `/` in a Folder name is a supported feature (it composes
  // with the Project folder) and must keep working — see the
  // `absolute_paths` parity scenario.
  test('absolute-folder-name-still-composes', async () => {
    const { fs, vol } = memfs({})
    const jostraca = Jostraca({ now: () => START_TIME, fs: () => fs })

    await jostraca.generate({ folder: '/top' }, () => {
      Project({ folder: '/top/sdk' }, () => {
        Folder({ name: '/code/js' }, () => {
          File({ name: 'foo.js' }, () => Content('// foo\n'))
        })
      })
    })

    expect(outkeys(vol)).equal(['/top/sdk/code/js/foo.js'])
  })


  // Node's Path.extname('.env') is '', so the old regex-strip removed the
  // whole name: every dotfile in a folder collapsed onto the same `.old`
  // backup and the second one destroyed the first one's copy.
  test('preserve-backs-up-dotfiles-distinctly', async () => {
    const { fs, vol } = memfs({})
    fs.mkdirSync('/out/p', { recursive: true })
    fs.writeFileSync('/out/p/.env', 'OLD-ENV\n')
    fs.writeFileSync('/out/p/.npmrc', 'OLD-NPMRC\n')

    const jostraca = Jostraca({ now: () => START_TIME, fs: () => fs })

    await jostraca.generate(
      { folder: '/out', existing: { txt: { preserve: true } } },
      () => Project({ folder: 'p' }, () => {
        File({ name: '.env' }, () => Content('NEW-ENV\n'))
        File({ name: '.npmrc' }, () => Content('NEW-NPMRC\n'))
      }))

    const json: any = vol.toJSON()
    expect(json['/out/p/.env.old']).equal('OLD-ENV\n')
    expect(json['/out/p/.npmrc.old']).equal('OLD-NPMRC\n')
    expect(json['/out/p/.env']).equal('NEW-ENV\n')
    expect(json['/out/p/.npmrc']).equal('NEW-NPMRC\n')
  })


  // Backup naming for ordinary files must be unchanged by the dotfile fix.
  test('preserve-backup-naming-unchanged-for-normal-files', async () => {
    const { fs, vol } = memfs({})
    fs.mkdirSync('/out/p', { recursive: true })
    fs.writeFileSync('/out/p/a.txt', 'OLD\n')
    fs.writeFileSync('/out/p/b.min.js', 'OLDJS\n')

    const jostraca = Jostraca({ now: () => START_TIME, fs: () => fs })

    await jostraca.generate(
      { folder: '/out', existing: { txt: { preserve: true } } },
      () => Project({ folder: 'p' }, () => {
        File({ name: 'a.txt' }, () => Content('NEW\n'))
        File({ name: 'b.min.js' }, () => Content('NEWJS\n'))
      }))

    const json: any = vol.toJSON()
    expect(json['/out/p/a.old.txt']).equal('OLD\n')
    expect(json['/out/p/b.min.old.js']).equal('OLDJS\n')
  })

})
