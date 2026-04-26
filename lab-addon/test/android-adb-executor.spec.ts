import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseAndroidSetting } from '../src/android/adb-executor';

describe('parseAndroidSetting', () => {
    it('ignores null and empty values', () => {
        assert.equal(parseAndroidSetting(''), null);
        assert.equal(parseAndroidSetting('   '), null);
        assert.equal(parseAndroidSetting('null'), null);
        assert.equal(parseAndroidSetting(' NULL '), null);
    });

    it('does not treat stderr-like output as valid setting', () => {
        assert.equal(parseAndroidSetting('error: device offline'), null);
        assert.equal(parseAndroidSetting('adb: failed to run shell command'), null);
        assert.equal(parseAndroidSetting('Usage: adb shell settings get ...'), null);
    });

    it('returns normal setting output', () => {
        assert.equal(parseAndroidSetting(' 10.0.2.2:8080 \n'), '10.0.2.2:8080');
    });
});
