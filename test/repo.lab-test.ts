/* Copyright © 2019 Richard Rodger and other contributors, MIT License. */

const Pkg = require('../package.json')

const Fs = require('fs')

const Ejs = require('ejs')

const Code = require('@hapi/code')
const Lab = require('@hapi/lab')
const Mock = require('mock-fs')

const lab = (exports.lab = Lab.script())
const describe = lab.describe
const it = lab.it
const expect = Code.expect

const Repo = require('../lib/util/repo')

describe('repo', () => {
  it('compiled', async () => {
    expect(
      Fs.statSync(__dirname + '/../src/util/repo.ts').mtimeMs,
      'TYPESCRIPT COMPILATION FAILED - SEE WATCH'
    ).most(Fs.statSync(__dirname + '/../lib/util/repo.js').mtimeMs)
  })

  it('intern.deep', () => {
    let out = Repo.intern.deep({x:1},{y:2,z:[1,{k:1,m:2}]},{x:2},{z:[2,{k:2}]})
    expect(out).equal({x:2,y:2,z:[2,{k:2,m:2}]})
  })
  
  it('intern.parse_repo_list', () => {
    var text = `a

bb
# comment
c x:1
d x:{y:1},z:'q'
`

    var repos = Repo.intern.parse_repo_list(text)
    // console.log('TTTTTTT', repos)

    expect(repos.length).equal(4)

    expect(repos).includes([
      { name: 'a', order: 0, props: {} },
      { name: 'bb', order: 1, props: {} },
      { name: 'c', order: 2, props: { x: 1 } },
      { name: 'd', order: 3, props: { x: { y: 1 }, z: 'q' } }
    ])
  })

  it('intern.load_repos', () => {
    Mock({
      test: {
        subfolder: {},
        empty: '',
        emptier: '\n\n',
        all: 'a\nb\n',
        '.not-a-repo': '',
        foo: 'c\nd\n.ignore\n# comment'
      }
    })

    var groups = Repo.intern.load_repo_groups('test')
    //console.dir(groups, { depth: null })

    expect(groups).includes({
      all: {
        repos: [
          { name: 'a', order: 0, props: {} },
          { name: 'b', order: 1, props: {} }
        ],
        name: 'all'
      },
      emptier: { repos: [], name: 'emptier' },
      empty: { repos: [], name: 'empty' },
      foo: {
        repos: [
          { name: 'c', order: 0, props: {} },
          { name: 'd', order: 1, props: {} }
        ],
        name: 'foo'
      }
    })

    expect(groups.all.repos.a).includes({ name: 'a', order: 0, props: {} })
  })

  it('intern.load_templates', () => {
    Mock({
      'test-a': {
        '.travis.yml': 'travis-A',
        docker: {
          stage: {
            Makefile: 'Makefile-As',
            Dockerfile: 'Dockerfile-As'
          },
          prod: {
            Makefile: 'Makefile-Ap',
            Dockerfile: 'Dockerfile-Ap'
          }
        },
        srv: {
          'name-kind.dev.js': 'srv-dev-A',
          'name-kind.stage.js': 'srv-stage-A',
          'name-kind.prod.js': 'srv-prod-A',
          'options.js': 'options-A'
        }
      },
      'test-b': {
        '.travis.yml': 'travis-B',
        docker: {
          stage: {
            Makefile: 'Makefile-Bs',
            Dockerfile: 'Dockerfile-Bs'
          },
          prod: {
            Makefile: 'Makefile-Bp',
            Dockerfile: 'Dockerfile-Bp'
          }
        },
        srv: {
          'name-kind.dev.js': 'srv-dev-B',
          'name-kind.stage.js': 'srv-stage-B',
          'name-kind.prod.js': 'srv-prod-B',
          'options.js': 'options-B'
        }
      }
    })

    var found = Repo.intern.load_templates('test-a')
    //console.dir(found,{depth:null})

    found = found.map(tm => {
      return { path: tm.path, kind: tm.kind, name: tm.name, text: tm.text }
    })

    expect(found).equals([
      {
        path: 'test-a/.travis.yml',
        kind: 'yml',
        name: '.travis.yml',
        text: 'travis-A'
      },
      {
        path: 'test-a/docker/prod/Dockerfile',
        kind: '',
        name: 'Dockerfile',
        text: 'Dockerfile-Ap'
      },
      {
        path: 'test-a/docker/prod/Makefile',
        kind: '',
        name: 'Makefile',
        text: 'Makefile-Ap'
      },
      {
        path: 'test-a/docker/stage/Dockerfile',
        kind: '',
        name: 'Dockerfile',
        text: 'Dockerfile-As'
      },
      {
        path: 'test-a/docker/stage/Makefile',
        kind: '',
        name: 'Makefile',
        text: 'Makefile-As'
      },
      {
        path: 'test-a/srv/name-kind.dev.js',
        kind: 'js',
        name: 'name-kind.dev.js',
        text: 'srv-dev-A'
      },
      {
        path: 'test-a/srv/name-kind.prod.js',
        kind: 'js',
        name: 'name-kind.prod.js',
        text: 'srv-prod-A'
      },
      {
        path: 'test-a/srv/name-kind.stage.js',
        kind: 'js',
        name: 'name-kind.stage.js',
        text: 'srv-stage-A'
      },
      {
        path: 'test-a/srv/options.js',
        kind: 'js',
        name: 'options.js',
        text: 'options-A'
      }
    ])

    found = Repo.intern.load_templates('test-b')

    found = found.map(tm => {
      return { path: tm.path, kind: tm.kind, name: tm.name, text: tm.text }
    })

    //console.dir(found,{depth:null})
    expect(found).equals([
      {
        path: 'test-b/.travis.yml',
        kind: 'yml',
        name: '.travis.yml',
        text: 'travis-B'
      },
      {
        path: 'test-b/docker/prod/Dockerfile',
        kind: '',
        name: 'Dockerfile',
        text: 'Dockerfile-Bp'
      },
      {
        path: 'test-b/docker/prod/Makefile',
        kind: '',
        name: 'Makefile',
        text: 'Makefile-Bp'
      },
      {
        path: 'test-b/docker/stage/Dockerfile',
        kind: '',
        name: 'Dockerfile',
        text: 'Dockerfile-Bs'
      },
      {
        path: 'test-b/docker/stage/Makefile',
        kind: '',
        name: 'Makefile',
        text: 'Makefile-Bs'
      },
      {
        path: 'test-b/srv/name-kind.dev.js',
        kind: 'js',
        name: 'name-kind.dev.js',
        text: 'srv-dev-B'
      },
      {
        path: 'test-b/srv/name-kind.prod.js',
        kind: 'js',
        name: 'name-kind.prod.js',
        text: 'srv-prod-B'
      },
      {
        path: 'test-b/srv/name-kind.stage.js',
        kind: 'js',
        name: 'name-kind.stage.js',
        text: 'srv-stage-B'
      },
      {
        path: 'test-b/srv/options.js',
        kind: 'js',
        name: 'options.js',
        text: 'options-B'
      }
    ])
  })

  it('intern.load_templates', () => {
    Mock({
      test: {
        foo: 'AAA <%=qaz%> BBB'
      }
    })

    var found = Repo.intern.load_templates('test')
    Repo.intern.parse_templates(found)
    //console.dir(found,{depth:null})
    expect(found[0]).includes({
      path: 'test/foo',
      kind: '',
      name: 'foo',
      text: 'AAA <%=qaz%> BBB'
    })
    expect(found[0].render).function()

    var out = found[0].render({ qaz: 'WSX' })
    expect(out).equal('AAA WSX BBB')
  })

  it('intern.render_template', () => {
    var text0 = 'AAA <%=name%> BBB <%=props.qaz%> CCC'
    var tm0_render = Ejs.compile(text0)
    var tm0 = {
      name: 'tm0',
      render: function(ctxt) {
        return tm0_render(ctxt)
      }
    }

    var out = Repo.intern.render_template(tm0, {
      name: 'tm0',
      props: { qaz: 'wsx' }
    })
    //console.log(out)
    expect(out).equal('AAA tm0 BBB wsx CCC')

    var text1_src = `
DDD-old
tm01-old
# JOSTRACA-SLOT-START:zed #
edc
# JOSTRACA-SLOT-END:zed #
EEE
wsx-old
FFF
`

    var text1_tm = `
DDD
<%=name%>
<%=slots.zed%>
EEE
<%=props.qaz%>
FFF
`
    var tm1_render = Ejs.compile(text1_tm)
    var tm1 = {
      name: 'tm1',
      render: function(ctxt) {
        return tm1_render(ctxt)
      }
    }

    var out = Repo.intern.render_template(
      tm1,
      { name: 'tm01', props: { qaz: 'wsx' } },
      text1_src
    )
    //console.log(out)

    //expect(out).equal('\nDDD\ntm01\nedc\nEEE\nwsx\nFFF\n')
    expect(out).equal(`
DDD
tm01
# JOSTRACA-SLOT-START:zed #
edc
# JOSTRACA-SLOT-END:zed #
EEE
wsx
FFF
`)
  })

  it('intern.generate', () => {
    Mock({
      work: {
        system: {
          jostraca: {
            repos: {
              all: `
foo x:1,y:3
bar x:2
qaz {y:2,z:4}
`,
              red: `
foo y:5
bar x:6,y:7
`
            },
            templates: {
              aaa: 'lorem',
              bbb: 'ipsum <%=name%>',
              ccc: {
                ddd: 'dolor <%=name%> sit <%=props.x%> amet <%=props.y%>',
                eee:
                'A <%=name%> B <%=props.x%> C <%=props.y%>' +
                  ' D <%=slots.zed%> E'
              }
            }
          }
        },
        foo: {
          fff: 'QQQ0',
          ggg: {
            hhh: 'WWW0'
          },
          ccc: {
            iii: 'EEE0',
            ddd: 'old0',
            eee:
            'A NAME B X C Y' +
              ' D JOSTRACA-SLOT-START:zed\n foozed \nJOSTRACA-SLOT-END:zed E0'
          }
        },
        bar: {
          fff: 'QQQ1',
          ggg: {
            hhh: 'WWW1'
          },
          ccc: {
            iii: 'EEE1',
            ddd: 'old1',
            eee:
            'A NAME B X C Y' +
              ' D JOSTRACA-SLOT-START:zed\n barzed \nJOSTRACA-SLOT-END:zed E1'
          }
        },
        qaz: {}
      }
    })

    Repo.intern.generate({
      group: 'all',
      repo: '',
      basefolder: 'work/system/jostraca',
      repofolder: 'work'
    })

    var files = {
      foo: [
        'aaa',
        'bbb',
        'fff',
        'ggg/hhh',
        'ccc/iii',
        'ccc/ddd',
        'ccc/eee'
      ],
      bar: [
        'aaa',
        'bbb',
        'fff',
        'ggg/hhh',
        'ccc/iii',
        'ccc/ddd',
        'ccc/eee'
      ],
      qaz: [
        'aaa',
        'bbb',
        'ccc/ddd',
        'ccc/eee'
      ]
    }

    var repos = ['foo', 'bar', 'qaz']

    var content = {}

    for (var repo of repos) {
      content[repo] = {}
      for (var file of files[repo]) {
        content[repo][file] = Fs.readFileSync(
          'work/' + repo + '/' + file
        ).toString()
      }
    }

    // console.dir(content)

    expect(content).equal({
      foo: {
        aaa: 'lorem',
        bbb: 'ipsum foo',
        fff: 'QQQ0',
        'ggg/hhh': 'WWW0',
        'ccc/iii': 'EEE0',
        'ccc/ddd': 'dolor foo sit 1 amet 3',
        'ccc/eee': 'A foo B 1 C 3 D A NAME B X C Y D JOSTRACA-SLOT-START:zed\n foozed \nJOSTRACA-SLOT-END:zed E0 E'
      },
      bar: {
        aaa: 'lorem',
        bbb: 'ipsum bar',
        fff: 'QQQ1',
        'ggg/hhh': 'WWW1',
        'ccc/iii': 'EEE1',
        'ccc/ddd': 'dolor bar sit 2 amet ',
        'ccc/eee': 'A bar B 2 C  D A NAME B X C Y D JOSTRACA-SLOT-START:zed\n barzed \nJOSTRACA-SLOT-END:zed E1 E'
      },
      qaz:
      { aaa: 'lorem',
        bbb: 'ipsum qaz',
        'ccc/ddd': 'dolor qaz sit  amet 2',
        'ccc/eee': 'A qaz B  C 2 D  E' }
    })


    // sub group - verify repo props merge
    
    Repo.generate({
      group: 'red',
      repo: '',
      basefolder: 'work/system/jostraca',
      repofolder: 'work'
    })

    repos = ['foo', 'bar']
    content = {}

    for (var repo of repos) {
      content[repo] = {}
      for (var file of files[repo]) {
        content[repo][file] = Fs.readFileSync(
          'work/' + repo + '/' + file
        ).toString()
      }
    }

    expect(content).equal({
      foo: {
        aaa: 'lorem',
        bbb: 'ipsum foo',
        fff: 'QQQ0',
        'ggg/hhh': 'WWW0',
        'ccc/iii': 'EEE0',
        'ccc/ddd': 'dolor foo sit 1 amet 5',
        'ccc/eee': 'A foo B 1 C 5 D A foo B 1 C 3 D A NAME B X C Y D JOSTRACA-SLOT-START:zed\n foozed \nJOSTRACA-SLOT-END:zed E0 E E'
      },
      bar: {
        aaa: 'lorem',
        bbb: 'ipsum bar',
        fff: 'QQQ1',
        'ggg/hhh': 'WWW1',
        'ccc/iii': 'EEE1',
        'ccc/ddd': 'dolor bar sit 6 amet 7',
        'ccc/eee': 'A bar B 6 C 7 D A bar B 2 C  D A NAME B X C Y D JOSTRACA-SLOT-START:zed\n barzed \nJOSTRACA-SLOT-END:zed E1 E E'
      },
    })
  })


  it('intern.inject', () => {

    var text1_src = `
{
  "name": "foo",
  "JOSTRACA-INJECT-START": "",
  "replace": "this"
  "JOSTRACA-INJECT-END": "",
  "deps": {
    "bar": "zed"
  }
}
`

    var text1_tm = `
  "qaz": "<%-name%>",
  "wsx": "<%-props.wsx%>",
  "edc": "qwe",
`
    var tm1_render = Ejs.compile(text1_tm)
    var tm1 = {
      name: 'tm1',
      render: function(ctxt) {
        return tm1_render(ctxt)
      }
    }

    var out = Repo.intern.render_template(
      tm1,
      { name: 'tm01', props: { wsx: 'asd' } },
      text1_src
    )
    //console.log(out)


    expect(out).equal(`
{
  "name": "foo",
  "JOSTRACA-INJECT-START": "",

  "qaz": "tm01",
  "wsx": "asd",
  "edc": "qwe",
  "JOSTRACA-INJECT-END": "",
  "deps": {
    "bar": "zed"
  }
}
`)
  })

    
})
