import { HeadlessBackendKind } from './headless-backend-strategy';

export interface HeadlessConfig {
    backend: HeadlessBackendKind;
    startCommand?: string;
    startArgs: string[];
}

const parseStartArgs = (input: string | undefined): string[] => {
    if (!input || input.trim().length === 0) {
        return [];
    }

    const trimmed = input.trim();
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) {
                return parsed;
            }
        } catch {
            return [];
        }
        return [];
    }

    const matches = trimmed.match(/"[^"]*"|'[^']*'|\S+/g);
    if (!matches) {
        return [];
    }

    return matches.map((token) => token.replace(/^['"]|['"]$/g, '')).filter((token) => token.length > 0);
};

export const loadHeadlessConfig = (env: NodeJS.ProcessEnv = process.env): HeadlessConfig => {
    const requestedBackend = env.LAB_ADDON_HEADLESS_BACKEND;
    const startCommand = env.LAB_ADDON_HEADLESS_START_COMMAND?.trim();
    const startArgs = parseStartArgs(env.LAB_ADDON_HEADLESS_START_ARGS);

    const backend: HeadlessBackendKind = requestedBackend === 'local-process' && startCommand
        ? 'local-process'
        : 'safe-stub';

    return {
        backend,
        startCommand: startCommand || undefined,
        startArgs
    };
};
