import Path = require('path')
import { Command, flags } from '@oclif/command'

import { generate } from '../util/repo'

// TODO: better resolver needed
let config = {
  basefolder: process.cwd() + '/jostraca',
}

export default class Generate extends Command {
  static description = 'Generate repo files'

  static examples = [
    `$ jostraca generate`,
    `$ jostraca generate [group]`,
    `$ jostraca generate [group] [repo]`,
  ]

  static flags = {
    config: flags.string({ char: 'c', description: 'config folder' }),
  }

  static args = [{ name: 'group' }, { name: 'repo' }]

  async run() {
    const { args, flags } = this.parse(Generate)

    const group = args.group || 'all'
    const repo = args.repo || ''
    const basefolder = Path.resolve(flags.config || config.basefolder)
    const systemfolder = Path.dirname(basefolder)
    const repofolder = Path.dirname(systemfolder)

    const spec = {
      group,
      repo,
      basefolder,
      repofolder,
    }

    // console.log('JOSTRACA GENERATE', spec)
    generate(spec)
  }
}
