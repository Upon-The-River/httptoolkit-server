import { describe, expect, it } from 'vitest';

import { matchQidianTraffic } from '../src/qidian/qidian-traffic-matcher';

describe('matchQidianTraffic', () => {
    it('matches qidian.com host', () => {
        const result = matchQidianTraffic('https://www.qidian.com/book/123');

        expect(result).toEqual({
            matched: true,
            reason: 'host-match',
            matchedValue: 'qidian.com'
        });
    });

    it('matches druidv6.if.qidian.com', () => {
        const result = matchQidianTraffic('https://druidv6.if.qidian.com/argus/api/v3/bookstore/get-book-detail');

        expect(result).toEqual({
            matched: true,
            reason: 'host-match',
            matchedValue: 'druidv6.if.qidian.com'
        });
    });

    it('excludes android.httptoolkit.tech/config', () => {
        const result = matchQidianTraffic('http://android.httptoolkit.tech/config');

        expect(result).toEqual({
            matched: false,
            reason: 'excluded',
            matchedValue: 'android.httptoolkit.tech/config'
        });
    });

    it('excludes amiusing.httptoolkit.tech/certificate', () => {
        const result = matchQidianTraffic('http://amiusing.httptoolkit.tech/certificate');

        expect(result).toEqual({
            matched: false,
            reason: 'excluded',
            matchedValue: 'amiusing.httptoolkit.tech/certificate'
        });
    });

    it('returns no-match for unrelated URLs', () => {
        const result = matchQidianTraffic('https://example.com/some/api');

        expect(result).toEqual({
            matched: false,
            reason: 'no-match'
        });
    });
});
