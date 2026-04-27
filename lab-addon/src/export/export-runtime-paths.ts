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

export const resolveExportRuntimePaths = (overrides: ExportRuntimePathOverrides = {}): ExportRuntimePaths => {
    const runtimeRoot = overrides.runtimeRoot
        ? resolvePath(overrides.runtimeRoot)
        : path.resolve(getAddonRoot(), 'runtime');

    const exportDir = overrides.exportDir
        ? resolvePath(overrides.exportDir)
        : path.resolve(runtimeRoot, 'exports');

    const jsonlPath = overrides.jsonlPath
        ? resolvePath(overrides.jsonlPath)
        : path.resolve(exportDir, 'session_hits.jsonl');

    return {
        runtimeRoot,
        exportDir,
        jsonlPath
    };
};
