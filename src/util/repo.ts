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
  parent_folders: string[]
  text: string
  kind: string
  render?: (ctxt: any) => any
}

interface TemplateContext {
  name: string
  version: string
  year: number
  prefix: string
  suffix: string
  parent_folders: string[]
  props: object
  slots?: { [key: string]: string }
}

interface GenerateSpec {
  group: string
  repo: string
  basefolder: string
  repofolder: string
}

interface GroupSpec {
  name: string
  repos: MapRepo
}

interface RepoSpec {
  version: string
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

    let repos = group.repos.filter(repo => {
      return '' === spec.repo || repo.name === spec.repo
    })

    for (let rI = 0; rI < repos.length; rI++) {
      let repo = repos[rI]

      let repospec = intern.load_repo_spec(spec, repo)

      // inherit props from 'all' group
      let all_repo: Repo = all_group.repos[repo.name] || {}
      let props = intern.deep(all_repo.props, repo.props)
      let skip = false

      for (let template of templates) {
        skip = false

        let path =
          spec.repofolder +
          '/' +
          repo.name +
          '/' +
          template.path.substring(template_folder.length + 1)

        while (path !== (path = path.replace('%NAME%', repo.name))) { }

        let excludes: string[] =
          ('string' === typeof props.exclude$
            ? [props.exclude$]
            : (props.exclude$ as string[])) || []

        for (let exclude of excludes) {
          skip = skip || -1 !== path.indexOf(exclude)
        }

        if (!skip) {
          let text = ''

          if (Fs.existsSync(path)) {
            text = Fs.readFileSync(path).toString()
          }

          let repo_name_prefix = ''
          let repo_name_suffix = ''
          let m = repo.name.match(/^(.*)-([^-]*?)$/)

          if (m) {
            repo_name_prefix = m[1]
            repo_name_suffix = m[2]
          }

          let ctxt: TemplateContext = {
            name: repo.name,
            version: repospec.version,
            prefix: repo_name_prefix,
            suffix: repo_name_suffix,
            year: new Date().getFullYear(),
            parent_folders: template.parent_folders,
            props
          }

          let out = intern.render_template(template, ctxt, text)

          let folder_part = Path.dirname(path)
          Fs.mkdirSync(folder_part, { recursive: true })
          Fs.writeFileSync(path, out)

          console_log('SAVE: ' + path)
        } else {
          console_log('skip: ' + path)
        }
      }
    }
  },
  render_template(tm: Template, ctxt: TemplateContext, text: string) {
    text = text || ''
    ctxt.slots = {}

    // NOTE: slot *MUST* have newline prefix and suffix
    // This supports syntax comments in source code

    let jostraca_slot_re = /[^\r\n]*?JOSTRACA-SLOT-START:([\S]+)[^\r\n]*[\r\n]?([\s\S]*?)[\r\n]?[^\r\n]*JOSTRACA-SLOT-END:\1[^\r\n]*/
    let m: RegExpMatchArray | null = null
    let last = 0
    let index: number
    while ((m = jostraca_slot_re.exec(text.substring(last)))) {
      //console.log(m)
      let slot_full = m[0]
      let slot_name = m[1]

      // Need to preserve slot markers on re-insert
      ctxt.slots[slot_name] = slot_full

      index = m.index!

      // keep looking from end of last match
      last = last + index + slot_full.length
    }

    let render_text = tm.render!(ctxt)
    let out = render_text

    let jostraca_inject_re = /(.*?JOSTRACA-INJECT-START.*?)([\r\n])[\s\S]*?([^\r\n]*JOSTRACA-INJECT-END.*)/
    m = jostraca_inject_re.exec(text)
    //console.log('INJECT MATCH',m)

    if (m) {
      out = text.replace(m[0], m[1] + m[2] + render_text + m[3])
    }

    return out
  },
  load_templates(folder: string) {
    let found: Template[] = []
    walk(folder, [], found)
    intern.parse_templates(found)
    return found

    function walk(folder: string, parent_folders: string[], found: Template[]) {
      let files = Fs.readdirSync(folder).filter(file_name => {
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
            parent_folders,
            kind,
            name: file,
            text: Fs.readFileSync(path).toString()
          })
        } else {
          // NOTE: parent folders ordered by ancestor ascending,
          // and thus opposite to folder path order. This is more
          // useful for immediate parent folder name conventions
          let child_parents: string[] = [file].concat(parent_folders)
          walk(path, child_parents, found)
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
  load_repo_spec(spec: GenerateSpec, repo: Repo): RepoSpec {
    let version = ''
    let pkg_path = spec.repofolder + '/' + repo.name + '/package.json'
    if (Fs.existsSync(pkg_path)) {
      let pkg = require(pkg_path)
      version = pkg.version
    }

    let repospec: RepoSpec = {
      version
    }

    return repospec
  },
  load_repo_groups(folder: string) {
    let files = Fs.readdirSync(folder)

    files = files.filter((entry: string) => {
      // let entrystat = Fs.lstatSync(folder + '/' + entry)
      return (
        // entrystat.isFile() &&
        !entry.startsWith('.') && !entry.endsWith('~')
      )
    })

    let groups: { [group: string]: GroupSpec } = {}

    for (let groupname of files) {
      let group_def_loc = folder + '/' + groupname
      let is_folder = Fs.lstatSync(group_def_loc).isDirectory()
      let grouptext = ''

      // location is a folder, expect groupname.list file
      if (is_folder) {
        let groupfile = group_def_loc + '/' + groupname + '.list'
        if (Fs.existsSync(groupfile)) {
          grouptext = Fs.readFileSync(groupfile).toString()
        }
      }

      // location is a file
      else if (Fs.existsSync(group_def_loc)) {
        grouptext = Fs.readFileSync(group_def_loc).toString()
      }

      // try .list suffix
      else {
        grouptext = Fs.readFileSync(group_def_loc + '.list').toString()
      }

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
    return LodashDefaultsDeep.apply(null, rest)
  }
}

function console_log(...rest: any[]) {
  console.log(...rest)
}

function generate(spec: GenerateSpec) {
  return intern.generate(spec)
}

export { generate, intern }
