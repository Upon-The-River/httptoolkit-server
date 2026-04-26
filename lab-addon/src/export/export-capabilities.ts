import { ExportCapabilities } from './export-types';

export function getExportCapabilities(): ExportCapabilities {
    return {
        configTargets: { implemented: true },
        matcher: { implemented: true },
        ingest: { implemented: true },
        stream: {
            implemented: false,
            status: 'requires-core-hook',
            reason: 'Addon cannot observe live HTTP Toolkit traffic without an official core event hook.'
        },
        notes: 'Addon-side export supports synthetic event testing and normalized JSONL-compatible records.'
    };
}
