// Copyright © 2019 Richard Rodger and other contributors, MIT License.

const Fs = require('fs')

//import { Jsonic } from 'jsonic'
const Jsonic = require('jsonic')
const Ejs = require('ejs')

interface Repo {
  name: string
  order: number
  props: object
}

type MapRepo = Repo[] & { [key: string]: Repo }

interface Template {
  name: string
  path: string
  text: string
  kind: string
  render?: (ctxt: any) => any
}

interface TemplateContext {
  name: string
  props: object
  slots?: { [key: string]: string }
}

interface GenerateSpec {
  group: string
  basefolder: string
  repofolder: string
}

interface GroupSpec {
  name: string
  repos: Repo[]
}

const intern = {
  generate(spec: GenerateSpec) {
    let groups: { [group: string]: GroupSpec } = intern.load_repo_groups(
      spec.basefolder + '/repos'
    )
    let group = groups[spec.group]

    // console.log('group', spec.group, group)

    let template_folder = spec.basefolder + '/templates'
    let templates = intern.load_templates(template_folder)
    // console.log('templates', templates)

    for(let rI = 0; rI < group.repos.length; rI++ ) {
      let repo = group.repos[rI]
      // console.log('repo', repo)

      for (let template of templates) {
        let path =
          spec.repofolder +
          '/' +
          repo.name +
          '/' +
          template.path.substring(template_folder.length + 1)
        // console.log('REPO PATH',path)


        let text = ''

        if(Fs.existsSync(path)) {
          text = Fs.readFileSync(path).toString()
        }


        let ctxt: TemplateContext = {
          name: repo.name,
          props: repo.props
        }

        let out = intern.render_template(template, ctxt, text)
        // console.log('out', out)
        Fs.writeFileSync(path,out)
      }
    }
  },
  render_template(tm: Template, ctxt: TemplateContext, text: string) {
    text = text || ''
    ctxt.slots = {}

    // console.log(text)

    let jostraca_slot_re = /.*?JOSTRACA-SLOT-START:([\S]+)[^\r\n]*[\r\n]?([\s\S]*?)[\r\n]?[^\r\n]*JOSTRACA-SLOT-END:\1.*/
    let m: RegExpMatchArray | null = null
    let last = 0
    let index: number
    while ((m = jostraca_slot_re.exec(text.substring(last)))) {
      // console.log(m,m.index)
      let slot_full = m[0]
      let slot_name = m[1]
      let slot_text = m[2]

      ctxt.slots[slot_name] = slot_text

      index = m.index!
      last = last + index + slot_full.length
    }

    let out = tm.render!(ctxt)
    return out
  },
  load_templates(folder: string) {
    let found: Template[] = []
    walk(folder, found)
    intern.parse_templates(found)
    return found

    function walk(folder: string, found: Template[]) {
      let files = Fs.readdirSync(folder)
      for (let file of files) {
        let path = folder + '/' + file
        let entrystat = Fs.lstatSync(path)
        if (entrystat.isFile()) {
          let m = file.match(/\.([^.]+)$/)
          let kind = (m ? m[1] : '').toLowerCase()

          found.push({
            path,
            kind,
            name: file,
            text: Fs.readFileSync(path).toString()
          })
        } else {
          walk(path, found)
        }
      }
    }
  },
  parse_templates(templates: Template[]) {
    for (let template of templates) {
      let ejs_render = Ejs.compile(template.text)
      template.render = function(ctxt) {
        return ejs_render(ctxt)
      }
    }
  },
  load_repo_groups(folder: string) {
    let files = Fs.readdirSync(folder)

    files = files.filter((entry: string) => {
      let entrystat = Fs.lstatSync(folder + '/' + entry)
      return entrystat.isFile() && !entry.startsWith('.')
    })

    let groups: { [group: string]: GroupSpec } = {}

    for (let groupname of files) {
      // let groupname = files[i]
      let grouptext = Fs.readFileSync(folder + '/' + groupname).toString()
      let repolist: MapRepo = intern.parse_repo_list(grouptext) as MapRepo

      // index by repo name also
      repolist.forEach(repo => {
        repolist[repo.name] = repo
      })

      groups[groupname] = {
        repos: repolist,
        name: groupname
      }
    }

    return groups
  },
  parse_repo_list(text: string): Repo[] {
    let repo_lines: string[] = text.split('\n').filter(line => '' !== line)
    let order = 0
    let repos = repo_lines
      .map(line => {
        let m = line.match(/^([^#\.\s][^\s]*)(\s+.*)?$/)
        let name = null
        let props_str = null
        let props = null

        if (m) {
          name = m[1]
          props_str = m[2]
          props = props_str ? Jsonic(props_str.substring(1)) : {}
          return { name, order: order++, props }
        }

        return null
      })
      .filter(repo => null !== repo)

    return repos as Repo[]
  }
}

export { intern }
