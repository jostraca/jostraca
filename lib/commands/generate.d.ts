import { Command, flags } from '@oclif/command';
export default class Generate extends Command {
    static description: string;
    static examples: string[];
    static flags: {
        config: flags.IOptionFlag<string | undefined>;
    };
    static args: {
        name: string;
    }[];
    run(): Promise<void>;
}
