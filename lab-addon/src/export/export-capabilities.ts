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
        notes: 'Addon export supports synthetic testing and can ingest opt-in official core live hook events via /export/ingest.'
    };
}
