import { ExportMatchResult, ExportTargetRule, SyntheticHttpEvent } from './export-types';

export function matchExportEvent(event: SyntheticHttpEvent, targets: ExportTargetRule[]): ExportMatchResult {
    for (const target of targets) {
        const reasons: string[] = [];

        if (target.methods?.length && !target.methods.includes(event.method.toUpperCase())) {
            reasons.push('method-mismatch');
            continue;
        }

        if (target.statusCodes?.length && !target.statusCodes.includes(event.statusCode)) {
            reasons.push('status-code-mismatch');
            continue;
        }

        if (target.urlIncludes?.length && !target.urlIncludes.some((piece) => event.url.includes(piece))) {
            reasons.push('url-include-mismatch');
            continue;
        }

        if (target.urlRegex && !(new RegExp(target.urlRegex).test(event.url))) {
            reasons.push('url-regex-mismatch');
            continue;
        }

        return {
            matched: true,
            targetName: target.name,
            reasons: ['matched']
        };
    }

    return {
        matched: false,
        reasons: ['no-target-matched']
    };
}
