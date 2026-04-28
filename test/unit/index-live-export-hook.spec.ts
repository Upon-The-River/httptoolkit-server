import { expect } from 'chai';

import { resolveSessionHttpProxyPort } from '../../src/index';

describe('index live export hook session guards', () => {
    it('mock-session-started with missing http does not throw', () => {
        expect(() => resolveSessionHttpProxyPort({} as any)).not.to.throw();
        expect(resolveSessionHttpProxyPort({} as any)).to.equal(undefined);
    });

    it('mock-session-started with undefined payload does not throw', () => {
        expect(() => resolveSessionHttpProxyPort(undefined)).not.to.throw();
        expect(resolveSessionHttpProxyPort(undefined)).to.equal(undefined);
    });

    it('mock-session-started with http.getMockServer works as before', () => {
        const port = resolveSessionHttpProxyPort({
            http: {
                getMockServer: () => ({ port: 8000 })
            }
        } as any);

        expect(port).to.equal(8000);
    });
});
