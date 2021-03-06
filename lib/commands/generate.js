"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Path = require("path");
const command_1 = require("@oclif/command");
const repo_1 = require("../util/repo");
// TODO: better resolver needed
let config = {
    basefolder: process.cwd() + '/jostraca',
};
let Generate = /** @class */ (() => {
    class Generate extends command_1.Command {
        async run() {
            const { args, flags } = this.parse(Generate);
            const group = args.group || 'all';
            const repo = args.repo || '';
            const basefolder = Path.resolve(flags.config || config.basefolder);
            const systemfolder = Path.dirname(basefolder);
            const repofolder = Path.dirname(systemfolder);
            const spec = {
                group,
                repo,
                basefolder,
                repofolder,
            };
            // console.log('JOSTRACA GENERATE', spec)
            repo_1.generate(spec);
        }
    }
    Generate.description = 'Generate repo files';
    Generate.examples = [
        `$ jostraca generate`,
        `$ jostraca generate [group]`,
        `$ jostraca generate [group] [repo]`,
    ];
    Generate.flags = {
        config: command_1.flags.string({ char: 'c', description: 'config folder' }),
    };
    Generate.args = [{ name: 'group' }, { name: 'repo' }];
    return Generate;
})();
exports.default = Generate;
