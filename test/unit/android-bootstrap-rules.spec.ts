import * as fs from 'fs';
import { expect } from 'chai';

import { prepareAndroidBootstrapRules } from '../../src/automation/android-bootstrap-rules';

describe('prepareAndroidBootstrapRules', () => {
    it('adds expected android bootstrap certificate rules and pass-through fallback', async () => {
        const calls: string[] = [];
        const session = {
            forGet: (url: string) => ({
                thenJson: async (_status: number, body: unknown) => {
                    calls.push(`json:${url}:${JSON.stringify(body)}`);
                },
                thenReply: async (status: number, body: string, headers: Record<string, string>) => {
                    calls.push(`reply:${url}:${status}:${body}:${headers['content-type']}`);
                }
            }),
            forAnyRequest: () => ({
                thenPassThrough: async () => {
                    calls.push('pass-through');
                }
            })
        };

        const result = await prepareAndroidBootstrapRules(
            {
                getConfig: async () => ({ certificateContent: 'cert-data' })
            } as any,
            8000,
            { session: session as any }
        );

        expect(result.applied).to.equal(true);
        expect(result.certificateAvailable).to.equal(true);
        expect(result.rules).to.deep.equal([
            'android-config-certificate-json',
            'android-certificate-pem',
            'pass-through-fallback'
        ]);
        expect(calls).to.deep.equal([
            'json:http://android.httptoolkit.tech/config:{"certificate":"cert-data"}',
            'reply:http://amiusing.httptoolkit.tech/certificate:200:cert-data:application/x-pem-file; charset=utf-8',
            'pass-through'
        ]);
    });

    it('handles missing certificate cleanly while keeping fallback', async () => {
        const calls: string[] = [];
        const session = {
            forGet: () => {
                throw new Error('forGet should not be called');
            },
            forAnyRequest: () => ({
                thenPassThrough: async () => {
                    calls.push('pass-through');
                }
            })
        };

        const result = await prepareAndroidBootstrapRules(
            {
                getConfig: async () => ({ certificateContent: '' })
            } as any,
            8001,
            { session: session as any }
        );

        expect(result.applied).to.equal(true);
        expect(result.certificateAvailable).to.equal(false);
        expect(result.warnings).to.deep.equal(['certificate-content-unavailable']);
        expect(result.rules).to.deep.equal(['pass-through-fallback']);
        expect(calls).to.deep.equal(['pass-through']);
    });

    it('contains no qidian or export/jsonl logic', () => {
        const source = fs.readFileSync('src/automation/android-bootstrap-rules.ts', 'utf8').toLowerCase();
        expect(source).to.not.contain('qidian');
        expect(source).to.not.contain('jsonl');
        expect(source).to.not.contain('/export');
    });
});
