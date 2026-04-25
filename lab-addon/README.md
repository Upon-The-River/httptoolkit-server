# httptoolkit-lab-addon

This is a migration-stage external addon for the local Android/headless/Qidian tooling that was previously embedded inside a modified HTTP Toolkit server fork.

Target principle:

```text
official HTTP Toolkit server = clean capture base
httptoolkit-lab-addon = Android control, network recovery, Qidian matching, live export, operational scripts
core patches = optional and manually reviewed only
```

Start with the addon skeleton:

```powershell
cd httptoolkit-lab-addon
npm install
npm run typecheck
npm run start
```

Health check:

```powershell
curl http://127.0.0.1:45457/health
```

The copied TypeScript files are migration assets. Some imports still reflect the original in-core location and should be normalized during migration.
