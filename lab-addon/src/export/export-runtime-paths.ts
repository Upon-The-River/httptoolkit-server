import * as path from 'path';

export interface ExportRuntimePathOverrides {
    runtimeRoot?: string;
    exportDir?: string;
    jsonlPath?: string;
}

export interface ExportRuntimePaths {
    runtimeRoot: string;
    exportDir: string;
    jsonlPath: string;
}

const getAddonRoot = (): string => {
    return path.resolve(__dirname, '../..');
};

const resolvePath = (targetPath: string): string => {
    return path.isAbsolute(targetPath)
        ? targetPath
        : path.resolve(getAddonRoot(), targetPath);
};

const readPathEnv = (name: 'HTK_LAB_ADDON_RUNTIME_ROOT' | 'HTK_LAB_ADDON_EXPORT_DIR' | 'HTK_LAB_ADDON_EXPORT_JSONL_PATH'): string | undefined => {
    const raw = process.env[name];
    if (!raw) return undefined;

    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};

export const resolveExportRuntimePaths = (overrides: ExportRuntimePathOverrides = {}): ExportRuntimePaths => {
    const runtimeRootInput = overrides.runtimeRoot ?? readPathEnv('HTK_LAB_ADDON_RUNTIME_ROOT') ?? 'runtime';
    const runtimeRoot = resolvePath(runtimeRootInput);

    const exportDirInput = overrides.exportDir ?? readPathEnv('HTK_LAB_ADDON_EXPORT_DIR');
    const exportDir = exportDirInput
        ? resolvePath(exportDirInput)
        : path.resolve(runtimeRoot, 'exports');

    const jsonlPathInput = overrides.jsonlPath ?? readPathEnv('HTK_LAB_ADDON_EXPORT_JSONL_PATH');
    const jsonlPath = jsonlPathInput
        ? resolvePath(jsonlPathInput)
        : path.resolve(exportDir, 'session_hits.jsonl');

    return {
        runtimeRoot,
        exportDir,
        jsonlPath
    };
};
