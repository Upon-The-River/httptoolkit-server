import targetTraffic from './qidian-target-traffic.json';

export interface QidianTrafficRuleConfig {
    hostIncludes: string[];
    urlIncludes: string[];
    excludeUrlIncludes: string[];
}

export interface QidianTrafficMatchResult {
    matched: boolean;
    reason: 'excluded' | 'host-match' | 'url-match' | 'no-match';
    matchedValue?: string;
}

export function matchQidianTraffic(url: string, config: QidianTrafficRuleConfig = targetTraffic): QidianTrafficMatchResult {
    const normalized = url.toLowerCase();
    const excluded = config.excludeUrlIncludes.find((item) => normalized.includes(item.toLowerCase()));
    if (excluded) return { matched: false, reason: 'excluded', matchedValue: excluded };
    let host = '';
    try { host = new URL(url).host.toLowerCase(); } catch { /* keep empty host */ }
    const hostMatch = config.hostIncludes.find((item) => host.includes(item.toLowerCase()));
    if (hostMatch) return { matched: true, reason: 'host-match', matchedValue: hostMatch };
    const urlMatch = config.urlIncludes.find((item) => normalized.includes(item.toLowerCase()));
    if (urlMatch) return { matched: true, reason: 'url-match', matchedValue: urlMatch };
    return { matched: false, reason: 'no-match' };
}
