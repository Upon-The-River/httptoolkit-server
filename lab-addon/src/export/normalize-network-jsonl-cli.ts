import { normalizeNetworkJsonl } from './normalize-network-jsonl';

const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name: string): boolean => args.includes(`--${name}`);

async function main() {
    const inputPath = getArg('inputPath');
    const outputPath = getArg('outputPath');

    if (!inputPath || !outputPath) {
        process.stderr.write('Missing required arguments: --inputPath and --outputPath\n');
        process.exit(2);
    }

    const summary = await normalizeNetworkJsonl({
        inputPath,
        outputPath,
        qidianOutputPath: getArg('qidianOutputPath'),
        maxRecords: getArg('maxRecords') ? Number(getArg('maxRecords')) : undefined,
        sinceBytes: getArg('sinceBytes') ? Number(getArg('sinceBytes')) : undefined,
        append: hasFlag('append'),
        includeSamples: hasFlag('includeSamples')
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

void main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
});
