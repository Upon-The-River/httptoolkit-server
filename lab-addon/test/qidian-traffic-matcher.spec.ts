import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { matchQidianTraffic } from '../src/qidian/qidian-traffic-matcher';

describe('matchQidianTraffic', () => {
    it('matches qidian.com host', () => {
        const result = matchQidianTraffic('https://www.qidian.com/book/123');

        assert.deepEqual(result, {
            matched: true,
            reason: 'host-match',
            matchedValue: 'qidian.com'
        });
    });

    it('matches druidv6.if.qidian.com', () => {
        const result = matchQidianTraffic(
            'https://druidv6.if.qidian.com/argus/api/v3/bookstore/get-book-detail',
            {
                hostIncludes: ['druidv6.if.qidian.com'],
                urlIncludes: [],
                excludeUrlIncludes: []
            }
        );

        assert.deepEqual(result, {
            matched: true,
            reason: 'host-match',
            matchedValue: 'druidv6.if.qidian.com'
        });
    });

    it('excludes android.httptoolkit.tech/config', () => {
        const result = matchQidianTraffic('http://android.httptoolkit.tech/config');

        assert.deepEqual(result, {
            matched: false,
            reason: 'excluded',
            matchedValue: 'android.httptoolkit.tech/config'
        });
    });

    it('excludes amiusing.httptoolkit.tech/certificate', () => {
        const result = matchQidianTraffic('http://amiusing.httptoolkit.tech/certificate');

        assert.deepEqual(result, {
            matched: false,
            reason: 'excluded',
            matchedValue: 'amiusing.httptoolkit.tech/certificate'
        });
    });

    it('returns no-match for unrelated URLs', () => {
        const result = matchQidianTraffic('https://example.com/some/api');

        assert.deepEqual(result, {
            matched: false,
            reason: 'no-match'
        });
    });
});
