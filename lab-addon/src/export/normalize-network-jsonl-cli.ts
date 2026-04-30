import { normalizeNetworkJsonl } from './normalize-network-jsonl';

const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name: string): boolean => args.includes(`--${name}`);

async function main() {
    const summary = await normalizeNetworkJsonl({
        inputPath: getArg('inputPath')!,
        outputPath: getArg('outputPath')!,
        qidianOutputPath: getArg('qidianOutputPath'),
        maxRecords: getArg('maxRecords') ? Number(getArg('maxRecords')) : undefined,
        sinceBytes: getArg('sinceBytes') ? Number(getArg('sinceBytes')) : undefined,
        append: hasFlag('append'),
        includeSamples: hasFlag('includeSamples')
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

void main();
