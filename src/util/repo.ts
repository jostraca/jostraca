// Copyright © 2019 Richard Rodger and other contributors, MIT License.

import Fs = require('fs')
import Path = require('path')


//import { Jsonic } from 'jsonic'
const Jsonic = require('jsonic')
const Ejs = require('ejs')
const LodashDefaultsDeep = require('lodash.defaultsdeep')

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
  repos: MapRepo
}

const intern = {
  generate(spec: GenerateSpec) {
    let groups: { [group: string]: GroupSpec } = intern.load_repo_groups(
      spec.basefolder + '/repos'
    )
    let all_group = groups.all
    let group = groups[spec.group]

    let template_folder = spec.basefolder + '/templates'
    let templates = intern.load_templates(template_folder)

    // console.log('JOSTRACA GENERATE group', group, groups)
    // console.log('JOSTRACA GENERATE tm', templates)
    
    for (let rI = 0; rI < group.repos.length; rI++) {
      let repo = group.repos[rI]

      // inherit props from 'all' group
      let all_repo: Repo = all_group.repos[repo.name]
      let props = intern.deep(all_repo.props,repo.props)

      for (let template of templates) {
        let path =
          spec.repofolder +
          '/' +
          repo.name +
          '/' +
          template.path.substring(template_folder.length + 1)

        let text = ''

        if (Fs.existsSync(path)) {
          text = Fs.readFileSync(path).toString()
        }

        let ctxt: TemplateContext = {
          name: repo.name,
          props
        }

        let out = intern.render_template(template, ctxt, text)

        // console.log('JOSTRACA GENERATE out', repo, template.path, path, out)
        
        let folder_part = Path.dirname(path)
        Fs.mkdirSync(folder_part, {recursive:true})
        Fs.writeFileSync(path, out)
      }
    }
  },
  render_template(tm: Template, ctxt: TemplateContext, text: string) {
    text = text || ''
    ctxt.slots = {}

    let jostraca_slot_re =
      /.*?JOSTRACA-SLOT-START:([\S]+)[^\r\n]*[\r\n]?([\s\S]*?)[\r\n]?[^\r\n]*JOSTRACA-SLOT-END:\1.*/
    let m: RegExpMatchArray | null = null
    let last = 0
    let index: number
    while ((m = jostraca_slot_re.exec(text.substring(last)))) {
      let slot_full = m[0]
      let slot_name = m[1]

      // Need to preserve slot markers on re-insert
      ctxt.slots[slot_name] = slot_full

      index = m.index!

      // keep looking from end of last match
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
      let files = Fs.readdirSync(folder).filter(file_name=>{
        return !file_name.endsWith('~')
      })
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
      let ejs_render = Ejs.compile(template.text, {})
      template.render = function(ctxt) {
        return ejs_render(ctxt)
      }
    }
  },
  load_repo_groups(folder: string) {
    let files = Fs.readdirSync(folder)

    files = files.filter((entry: string) => {
      let entrystat = Fs.lstatSync(folder + '/' + entry)
      return entrystat.isFile() && !entry.startsWith('.') && !entry.endsWith('~')
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
  },

  // NOTE: treats arrays as if objects where indexes are keys - this is desired
  deep(...rest: any[]): any {
    rest = rest.reverse()
    rest.unshift({})
    return LodashDefaultsDeep.apply(null,rest)
  }
}

function generate(spec: GenerateSpec) {
  return intern.generate(spec)
}

export { generate, intern }
