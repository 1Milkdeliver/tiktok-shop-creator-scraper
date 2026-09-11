# Development Guide

## Requirements

- Node.js 22.12+
- Google Chrome installed locally (`puppeteer-core` connects to it)

## Commands

```bash
npm ci
npm start
npm test
npm run build -- --publish never
```

If the Electron binary is missing, run `node node_modules/electron/install.js`.

## Packaging rules

- Unsigned builds use `win.signExecutable: false`.
- Installer icons are injected by `afterPack.js`; use `rebuild-icons.js` when regenerating assets.
- Every new UI label, dialog, prompt and field must be added to both languages through `I18N`.
- Release notes put English first and Chinese second.

See the README “Release / Update” section for publishing and differential-update rules.
