import express from 'express';

const app = express();
app.use(express.json({ limit: '5mb' }));

app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'httptoolkit-lab-addon' });
});

// Migration target endpoints. Move implementation from the working fork's rest-api.ts here gradually.
// Keep official HTTP Toolkit core clean. Do not re-add these routes to src/api/rest-api.ts.
const pendingRoutes = [
    'POST /automation/session/start',
    'GET /automation/session/latest',
    'POST /automation/session/stop-latest',
    'POST /automation/android-adb/start-headless',
    'POST /automation/android-adb/stop-headless',
    'POST /automation/android-adb/recover-headless',
    'POST /automation/android-adb/rescue-network',
    'GET /automation/health',
    'GET /export/stream'
];

app.get('/migration/pending-routes', (_req, res) => {
    res.json({ pendingRoutes });
});

const port = Number(process.env.HTK_LAB_ADDON_PORT ?? 45457);
app.listen(port, '127.0.0.1', () => {
    console.log(`httptoolkit-lab-addon listening on http://127.0.0.1:${port}`);
});
