# v1.5.3 Release Readiness

## Scope

- Release version: `1.5.3` (Windows x64 / NSIS).
- Installer: `tiktok-shop-creator-scraper-setup-1.5.3.exe`.
- Release notes: [release-notes-1.5.3.md](release-notes-1.5.3.md).
- This release preserves the existing update channel and the `creators.db` data path. Partner Center authorization remains session-only and must be re-imported after restarting the app.

## Verification

| Check | Result |
| --- | --- |
| Product test suite | Passed: 179 tests, 0 failures |
| Runtime dependency audit | Passed: `npm audit --omit=dev --audit-level=low`, 0 vulnerabilities |
| Full dependency audit | Exception recorded below; no forced downgrade applied |
| Packaged resource / module check | Passed: 22 required modules; ASAR SHA-256 `444652f1b8fc043e885121083b5994ce4570cd7ed677f45be269f7e4494bf721` |
| Packaged startup smoke check | Passed: database ready, creator navigation and account/contact IPC present; no production user data accessed; no visible window opened |
| Update manifest and blockmap | Passed: manifest SHA-512 matches installer; blockmap coverage verified |
| Local differential update reconstruction | Passed: v1.5.2 → v1.5.3; 12,739,106 bytes transferred of 122,811,875 (89.63% reused), 85 range responses, zero full-installer fallback requests; reconstructed SHA-512 and SHA-256 match |
| Authenticode signature | Not signed (no signing certificate configured) |
| Live TikTok Shop scrape / contacts / multi-market behavior | Not tested in this release validation |

- Installer SHA-256: `42e15853f7aa1f5b42d280d48931862ddf96949f18bbe2279b6a69f88ae1acb3`
- Installer size: `122,811,875` bytes.
- Blockmap SHA-256: `7da5d8bcd9029b2c76f326a9c169f850001c22a2547a6c884fce4423d7c97159`.

## Dependency audit exception

The full `npm audit --audit-level=low` reports 9 advisories in development/build dependency paths: 8 moderate and 1 high. The report includes `brace-expansion` and the transitive build chain `sprintf-js` → `roarr` → `global-agent` → `@electron/get` / `electron-builder`. `npm audit fix` was applied without `--force`; remaining advisories were not resolved. npm's suggested `--force` remediation would downgrade `electron-builder` to `26.5.0`, so it was not used. The production/runtime-only audit is clean. Reassess these advisories when compatible upstream dependency updates are available.

## Release checklist

- [x] Version, lockfile, changelog, both language readmes and release notes updated.
- [x] `npm test` passed.
- [x] Runtime audit passed; full-audit exception documented.
- [x] Windows x64 package built and package/startup/update checks passed.
- [x] Differential reconstruction verified against the existing public v1.5.2 artifacts without executing either installer or accessing production updater cache.
- [ ] Review staged diff for secrets and user-local data; commit and push `main` and `v1.5.3` tag.
- [ ] Publish GitHub Release with the installer, matching `.blockmap`, and `latest.yml`; verify public assets and updater metadata.
