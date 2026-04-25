import * as http from 'http';
import * as fs from 'fs/promises';
import { expect } from 'chai';
import express from 'express';
import * as mockttp from 'mockttp';
import * as tmp from 'tmp';

import { delay } from '@httptoolkit/util';

import { exposeRestAPI } from '../../src/api/rest-api';
import { LiveResponseExporter, LiveExportHit, LiveExportStreamHit } from '../../src/export/live-exporter';

describe('Live response exporter', () => {
    const mockServer = mockttp.getLocal();

    beforeEach(() => mockServer.start());
    afterEach(() => mockServer.stop());

    it('writes matching response hits and payload files', async () => {
        const tmpDir = tmp.dirSync({ unsafeCleanup: true });
        const configPath = `${tmpDir.name}/live-export-targets.json`;
        const exportPath = `${tmpDir.name}/exports`;

        await fs.writeFile(configPath, JSON.stringify({
            enabled: true,
            targets: [
                {
                    name: 'local-target',
                    methods: ['GET'],
                    urlIncludes: ['localhost'],
                    statusCodes: [200]
                }
            ]
        }));

        const exporter = new LiveResponseExporter(configPath, exportPath);
        await exporter.initialize();
        await exporter.attachToMockServer(mockServer);

        await mockServer.forGet('/match').thenReply(200, '{"ok":true}', {
            'content-type': 'application/json'
        });

        const streamedHitPromise = new Promise<LiveExportStreamHit>((resolve) => {
            const unsubscribe = exporter.subscribe((hit) => {
                unsubscribe();
                resolve(hit);
            });
        });

        const response = await fetch(mockServer.urlFor('/match'));
        expect(response.status).to.equal(200);
        await response.text();

        await delay(80);

        const hitsRaw = await fs.readFile(`${exportPath}/session_hits.jsonl`, 'utf8');
        const hit = JSON.parse(hitsRaw.trim()) as LiveExportHit;

        expect(hit.method).to.equal('GET');
        expect(hit.url).to.contain('/match');
        expect(hit.status).to.equal(200);
        expect(hit.contentType).to.equal('application/json');
        expect(hit.payloadPath).to.match(/^payloads\//);
        expect(hit.payloadPath).to.not.include('\\');
        expect(hit.payloadPath).to.match(/\.json$/);

        const payloadRaw = await fs.readFile(`${exportPath}/${hit.payloadPath}`);
        expect(payloadRaw.length).to.be.greaterThan(0);

        const streamedHit = await streamedHitPromise;
        expect(streamedHit.bodyEncoding).to.equal('utf8');
        expect(payloadRaw.toString('utf8')).to.equal(streamedHit.bodyInline);

        tmpDir.removeCallback();
    });

    it('streams new hits from /export/stream', async () => {
        const tmpDir = tmp.dirSync({ unsafeCleanup: true });
        const configPath = `${tmpDir.name}/live-export-targets.json`;
        const exportPath = `${tmpDir.name}/exports`;

        await fs.writeFile(configPath, JSON.stringify({
            enabled: true,
            targets: [
                {
                    methods: ['GET'],
                    urlIncludes: ['localhost']
                }
            ]
        }));

        const exporter = new LiveResponseExporter(configPath, exportPath);
        await exporter.initialize();
        await exporter.attachToMockServer(mockServer);

        const app = express();
        exposeRestAPI(app, {
            getVersion: () => 'test',
            updateServer: () => undefined,
            shutdownServer: () => undefined,
            getConfig: async () => ({}),
            getNetworkInterfaces: () => ({}),
            getInterceptors: async () => ({}),
            getInterceptorMetadata: async () => ({}),
            activateInterceptor: async () => ({}),
            sendRequest: async () => { throw new Error('unused'); }
        } as any, exporter);

        const server = await new Promise<http.Server>((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });

        const port = (server.address() as any).port;

        const firstLinePromise = new Promise<string>((resolve, reject) => {
            const req = http.get({
                host: '127.0.0.1',
                port,
                path: '/export/stream'
            }, (res) => {
                let buffer = '';
                res.on('data', (chunk) => {
                    buffer += chunk.toString('utf8');
                    const newlineIndex = buffer.indexOf('\n');
                    if (newlineIndex >= 0) {
                        resolve(buffer.slice(0, newlineIndex));
                        req.destroy();
                    }
                });
            });
            req.on('error', reject);
        });

        await mockServer.forGet('/stream-hit').thenReply(200, 'stream-body', {
            'content-type': 'text/plain'
        });
        const response = await fetch(mockServer.urlFor('/stream-hit'));
        await response.text();

        const firstLine = await firstLinePromise;
        const streamedHit = JSON.parse(firstLine) as LiveExportStreamHit;

        expect(streamedHit.url).to.contain('/stream-hit');
        expect(streamedHit.status).to.equal(200);
        expect(streamedHit.payloadPath).to.match(/^payloads\//);
        expect(streamedHit.payloadPath).to.not.include('\\');
        expect(streamedHit.bodyEncoding).to.equal('utf8');
        expect(streamedHit.bodyInline).to.equal('stream-body');
        const payloadText = await fs.readFile(`${exportPath}/${streamedHit.payloadPath}`, 'utf8');
        expect(payloadText).to.equal(streamedHit.bodyInline);

        await new Promise((resolve) => server.close(resolve));
        tmpDir.removeCallback();
    });

    it('falls back to .bin payload extension for unknown content types', async () => {
        const tmpDir = tmp.dirSync({ unsafeCleanup: true });
        const configPath = `${tmpDir.name}/live-export-targets.json`;
        const exportPath = `${tmpDir.name}/exports`;

        await fs.writeFile(configPath, JSON.stringify({
            enabled: true,
            targets: [{ methods: ['GET'], urlIncludes: ['localhost'] }]
        }));

        const exporter = new LiveResponseExporter(configPath, exportPath);
        await exporter.initialize();
        await exporter.attachToMockServer(mockServer);

        await mockServer.forGet('/binary').thenReply(200, Buffer.from([0xde, 0xad]), {
            'content-type': 'application/octet-stream'
        });

        const response = await fetch(mockServer.urlFor('/binary'));
        expect(response.status).to.equal(200);
        await response.arrayBuffer();

        await delay(80);

        const hitsRaw = await fs.readFile(`${exportPath}/session_hits.jsonl`, 'utf8');
        const hit = JSON.parse(hitsRaw.trim()) as LiveExportHit;

        expect(hit.contentType).to.equal('application/octet-stream');
        expect(hit.payloadPath).to.match(/\.bin$/);
        expect(hit).to.not.have.property('body');
        expect(hit).to.not.have.property('bodyInline');

        tmpDir.removeCallback();
    });

    it('streams binary response bodies as base64', async () => {
        const tmpDir = tmp.dirSync({ unsafeCleanup: true });
        const configPath = `${tmpDir.name}/live-export-targets.json`;
        const exportPath = `${tmpDir.name}/exports`;

        await fs.writeFile(configPath, JSON.stringify({
            enabled: true,
            targets: [{ methods: ['GET'], urlIncludes: ['localhost'] }]
        }));

        const exporter = new LiveResponseExporter(configPath, exportPath);
        await exporter.initialize();
        await exporter.attachToMockServer(mockServer);

        const app = express();
        exposeRestAPI(app, {
            getVersion: () => 'test',
            updateServer: () => undefined,
            shutdownServer: () => undefined,
            getConfig: async () => ({}),
            getNetworkInterfaces: () => ({}),
            getInterceptors: async () => ({}),
            getInterceptorMetadata: async () => ({}),
            activateInterceptor: async () => ({}),
            sendRequest: async () => { throw new Error('unused'); }
        } as any, exporter);

        const server = await new Promise<http.Server>((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });

        const port = (server.address() as any).port;
        const expectedBody = Buffer.from([0xde, 0xad, 0xbe, 0xef]);

        const firstLinePromise = new Promise<string>((resolve, reject) => {
            const req = http.get({
                host: '127.0.0.1',
                port,
                path: '/export/stream'
            }, (res) => {
                let buffer = '';
                res.on('data', (chunk) => {
                    buffer += chunk.toString('utf8');
                    const newlineIndex = buffer.indexOf('\n');
                    if (newlineIndex >= 0) {
                        resolve(buffer.slice(0, newlineIndex));
                        req.destroy();
                    }
                });
            });
            req.on('error', reject);
        });

        await mockServer.forGet('/binary-stream').thenReply(200, expectedBody, {
            'content-type': 'application/octet-stream'
        });

        const response = await fetch(mockServer.urlFor('/binary-stream'));
        expect(response.status).to.equal(200);
        await response.arrayBuffer();

        const firstLine = await firstLinePromise;
        const streamedHit = JSON.parse(firstLine) as LiveExportStreamHit;

        expect(streamedHit.bodyEncoding).to.equal('base64');
        expect(streamedHit.bodyInline).to.equal(expectedBody.toString('base64'));

        await new Promise((resolve) => server.close(resolve));
        tmpDir.removeCallback();
    });

    it('uses content-type specific payload extensions for known textual types', async () => {
        const tmpDir = tmp.dirSync({ unsafeCleanup: true });
        const configPath = `${tmpDir.name}/live-export-targets.json`;
        const exportPath = `${tmpDir.name}/exports`;

        await fs.writeFile(configPath, JSON.stringify({
            enabled: true,
            targets: [{ methods: ['GET'], urlIncludes: ['localhost'] }]
        }));

        const exporter = new LiveResponseExporter(configPath, exportPath);
        await exporter.initialize();
        await exporter.attachToMockServer(mockServer);

        await mockServer.forGet('/text').thenReply(200, 'plain', {
            'content-type': 'text/plain'
        });
        await (await fetch(mockServer.urlFor('/text'))).text();

        await mockServer.forGet('/xml').thenReply(200, '<ok />', {
            'content-type': 'application/xml'
        });
        await (await fetch(mockServer.urlFor('/xml'))).text();

        await mockServer.forGet('/js').thenReply(200, 'console.log("ok")', {
            'content-type': 'application/javascript'
        });
        await (await fetch(mockServer.urlFor('/js'))).text();

        await delay(80);

        const hitsRaw = await fs.readFile(`${exportPath}/session_hits.jsonl`, 'utf8');
        const hits = hitsRaw.trim().split('\n').map((line) => JSON.parse(line) as LiveExportHit);

        const textHit = hits.find((hit) => hit.url.includes('/text'));
        const xmlHit = hits.find((hit) => hit.url.includes('/xml'));
        const jsHit = hits.find((hit) => hit.url.includes('/js'));

        expect(textHit?.payloadPath).to.match(/\.txt$/);
        expect(xmlHit?.payloadPath).to.match(/\.xml$/);
        expect(jsHit?.payloadPath).to.match(/\.js$/);

        tmpDir.removeCallback();
    });
});
