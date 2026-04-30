export type QueryValue = string | string[];

export interface RoutedQidianEndpoint {
    isQidian: boolean;
    host?: string;
    path?: string;
    endpointKey: string;
    query: Record<string, QueryValue>;
    ids: Record<string, string>;
}

const QIDIAN_HOSTS = new Set(['qidian.com', 'www.qidian.com', 'druidv6.if.qidian.com']);

const toQueryObject = (params: URLSearchParams): Record<string, QueryValue> => {
    const query: Record<string, QueryValue> = {};
    for (const [key, value] of params.entries()) {
        const existing = query[key];
        if (existing === undefined) query[key] = value;
        else if (Array.isArray(existing)) existing.push(value);
        else query[key] = [existing, value];
    }
    return query;
};

const slugifyPath = (path: string): string => path
    .replace(/^\/+/, '')
    .replace(/[^a-zA-Z0-9/._-]+/g, '-')
    .replace(/[/.]+/g, '.')
    .replace(/-+/g, '-')
    .replace(/^\.+|\.+$/g, '')
    .toLowerCase() || 'root';

export function routeQidianEndpoint(url: string): RoutedQidianEndpoint {
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        const path = parsed.pathname;
        const query = toQueryObject(parsed.searchParams);

        const ids: Record<string, string> = {};
        for (const [key, value] of Object.entries(query)) {
            if (/id$/i.test(key) && typeof value === 'string') ids[key] = value;
        }

        const isQidian = host === 'druidv6.if.qidian.com' || host.endsWith('.qidian.com') || QIDIAN_HOSTS.has(host);
        if (!isQidian) {
            return { isQidian: false, host, path, endpointKey: 'non-qidian', query, ids };
        }

        const normalizedPath = path.toLowerCase();
        let endpointKey: string;

        if (host === 'druidv6.if.qidian.com' && normalizedPath.startsWith('/argus/api/v1/')) {
            endpointKey = `druidv6.argus.${slugifyPath(normalizedPath.replace('/argus/api/v1/', ''))}`;
        } else {
            endpointKey = `qidian.unknown.${slugifyPath(path)}`;
        }

        return { isQidian, host, path, endpointKey, query, ids };
    } catch {
        return { isQidian: false, endpointKey: 'invalid-url', query: {}, ids: {} };
    }
}
