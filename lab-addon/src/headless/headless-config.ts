import { HeadlessBackendKind } from './headless-backend-strategy';

export interface HeadlessConfig {
    backend: HeadlessBackendKind;
    startCommand?: string;
    startArgs: string[];
    workingDir?: string;
    startEnv?: Record<string, string>;
    validationErrors: string[];
}

const parseStartArgs = (input: string | undefined): { args: string[], error?: string } => {
    if (!input || input.trim().length === 0) {
        return { args: [] };
    }

    const trimmed = input.trim();
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) {
                return { args: parsed };
            }

            return {
                args: [],
                error: 'LAB_ADDON_HEADLESS_START_ARGS must be a JSON string array when JSON format is used.'
            };
        } catch {
            return {
                args: [],
                error: 'LAB_ADDON_HEADLESS_START_ARGS contains invalid JSON.'
            };
        }
    }

    const matches = trimmed.match(/"[^"]*"|'[^']*'|\S+/g);
    if (!matches) {
        return { args: [] };
    }

    return {
        args: matches
            .map((token) => token.replace(/^['"]|['"]$/g, ''))
            .filter((token) => token.length > 0)
    };
};

const parseEnvJson = (input: string | undefined): { env?: Record<string, string>, error?: string } => {
    if (!input || input.trim().length === 0) {
        return {};
    }

    try {
        const parsed = JSON.parse(input);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
            return { error: 'LAB_ADDON_HEADLESS_ENV_JSON must be a JSON object of string values.' };
        }

        const entries = Object.entries(parsed);
        const invalid = entries.find(([, value]) => typeof value !== 'string');
        if (invalid) {
            return { error: `LAB_ADDON_HEADLESS_ENV_JSON value for "${invalid[0]}" must be a string.` };
        }

        return { env: Object.fromEntries(entries) as Record<string, string> };
    } catch {
        return { error: 'LAB_ADDON_HEADLESS_ENV_JSON contains invalid JSON.' };
    }
};

export const loadHeadlessConfig = (env: NodeJS.ProcessEnv = process.env): HeadlessConfig => {
    const validationErrors: string[] = [];

    const requestedBackend = env.LAB_ADDON_HEADLESS_BACKEND;
    const startCommand = env.LAB_ADDON_HEADLESS_START_COMMAND?.trim();
    const startArgsResult = parseStartArgs(env.LAB_ADDON_HEADLESS_START_ARGS);
    const workingDir = env.LAB_ADDON_HEADLESS_WORKING_DIR?.trim();
    const startEnvResult = parseEnvJson(env.LAB_ADDON_HEADLESS_ENV_JSON);

    if (startArgsResult.error) {
        validationErrors.push(startArgsResult.error);
    }

    if (startEnvResult.error) {
        validationErrors.push(startEnvResult.error);
    }

    const backend: HeadlessBackendKind = requestedBackend === 'local-process' && startCommand
        ? 'local-process'
        : 'safe-stub';

    return {
        backend,
        startCommand: startCommand || undefined,
        startArgs: startArgsResult.args,
        workingDir: workingDir || undefined,
        startEnv: startEnvResult.env,
        validationErrors
    };
};
