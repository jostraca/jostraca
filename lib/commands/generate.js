"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Path = require("path");
const command_1 = require("@oclif/command");
const repo_1 = require("../util/repo");
// TODO: better resolver needed
let config = {
    basefolder: process.cwd() + '/jostraca',
};
class Generate extends command_1.Command {
    async run() {
        const { args, flags } = this.parse(Generate);
        const group = args.group || 'all';
        const basefolder = Path.resolve(flags.config || config.basefolder);
        const systemfolder = Path.dirname(basefolder);
        const repofolder = Path.dirname(systemfolder);
        const spec = {
            group,
            basefolder,
            repofolder
        };
        // console.log('JOSTRACA GENERATE', spec)
        repo_1.generate(spec);
    }
}
exports.default = Generate;
Generate.description = 'Generate repo files';
Generate.examples = [
    `$ jostraca generate`,
    `$ jostraca generate [group]`,
];
Generate.flags = {
    config: command_1.flags.string({ char: 'c', description: 'config folder' }),
};
Generate.args = [{ name: 'group' }];
