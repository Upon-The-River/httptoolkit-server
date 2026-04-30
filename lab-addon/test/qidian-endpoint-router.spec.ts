import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { routeQidianEndpoint } from '../src/export/qidian-endpoint-router';

describe('routeQidianEndpoint', () => {
    it('maps druid endpoints to endpoint keys and ids', () => {
        const cases = [
            ['https://druidv6.if.qidian.com/argus/api/v1/booklevel/detail?bookId=1041637443', 'druidv6.argus.booklevel.detail'],
            ['https://druidv6.if.qidian.com/argus/api/v1/popup/getlistv3?positionMark=POPUP_ROLE&bookId=1041637443&roleId=81952238930550507', 'druidv6.argus.popup.getlistv3'],
            ['https://druidv6.if.qidian.com/argus/api/v1/bookrole/starinfo?bookId=1041637443&roleId=81952238930550507', 'druidv6.argus.bookrole.starinfo'],
            ['https://druidv6.if.qidian.com/argus/api/v1/bookrole/v2/getroledetails?bookId=1041637443&roleId=81952238930550507', 'druidv6.argus.bookrole.v2.getroledetails']
        ] as const;

        for (const [url, endpointKey] of cases) {
            const routed = routeQidianEndpoint(url);
            assert.equal(routed.isQidian, true);
            assert.equal(routed.endpointKey, endpointKey);
            assert.equal(routed.ids.bookId, '1041637443');
        }
    });
});
