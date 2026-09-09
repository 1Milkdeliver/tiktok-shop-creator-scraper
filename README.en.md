<p align='center'>
<img src='./icon-256.png' width="150" height="150" alt="TikTokShop Creator Scraper Icon" />
</p>

<h1 align="center">TikTokShop Creator Scraper</h1>

<p align="center">Open-source desktop app for TikTok Shop sellers to discover, analyze and export affiliate creator data — GMV, followers, engagement, bio, email, MCN info — to CSV/Excel.</p>

<p align="center">
  <a href="https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/stargazers"><img src="https://img.shields.io/github/stars/1Milkdeliver/tiktok-shop-creator-scraper" alt="Stars Badge"/></a>
  <a href="https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/network/members"><img src="https://img.shields.io/github/forks/1Milkdeliver/tiktok-shop-creator-scraper" alt="Forks Badge"/></a>
  <a href="https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/blob/main/LICENSE"><img src="https://img.shields.io/github/license/1Milkdeliver/tiktok-shop-creator-scraper" alt="License Badge"/></a>
  <a href="https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/releases/latest"><img src="https://img.shields.io/github/v/release/1Milkdeliver/tiktok-shop-creator-scraper" alt="Latest Release"/></a>
</p>

<div align="center">
  <a href="./README.md">中文</a> / <a href="./README.en.md">English</a>
</div>

---

## 📑 Table of Contents

- [🚀 Introduction](#-introduction)
- [🎯 Who It's For](#-who-its-for)
- [✨ Features](#-features)
- [📊 Data You Can Collect](#-data-you-can-collect)
- [📦 Install](#-install)
- [🚀 Quick Start](#-quick-start)
- [❓ FAQ](#-faq)
- [💻 Development](#-development)
- [📤 Release / Update](#-release--update)
- [📄 License](#-license)

---

## 🚀 Introduction

**TikTokShop Creator Scraper** is an open-source desktop application built for **TikTok Shop sellers** to:

- Scrape creator data from the TikTok Shop Affiliate (联盟) marketplace — search by keywords, or import creator IDs / @handles / TikTok links directly
- **Local creator library (SQLite)**: scraped creators are stored, deduplicated, browsable, sortable and filterable — builds up as you scrape
- **Activity classification**: creators are automatically tagged active / inactive / unknown with explainable signals (last publish, growth, GMV trend)
- Analyze creator performance (GMV, sales, engagement, follower demographics, PPS score)
- Extract bio, collaboration email and MCN agency; optionally authorize your Partner Center session to enrich existing records with WhatsApp, LINE and other contacts provided by the platform
- Export everything to **CSV / Excel** with selectable fields — headers follow the UI language (CN/EN one-click switch)
- Output history with one-click **Continue / Refresh / Open / Delete**, resume from breakpoints, automatic deduplication

> Open-source · GPL-3.0 · Windows desktop app · Multi-account concurrent scraping · Auto-update

## 🎯 Who It's For

- **TikTok Shop Sellers** — find creators to collaborate with, screen potential partners
- **Affiliate Ops / Business Dev** — batch-organize creator info, reach out for collaboration
- **Product Selection Teams** — analyze creator data by category

## ✨ Features

| Feature | Description |
|---|---|
| 🎨 Workspaces | Sidebar: **Overview / Task Center / Creator Library / Export Center**, bilingual |
| 💾 Creator library | SQLite storage: auto-dedupe, browse / sort / filter / refresh |
| 📊 Activity status | Auto-tags creators active / inactive / unknown with explainable signals |
| ⏱️ Refresh progress | Live progress bar + estimated remaining time while updating the library |
| 🔍 Creator scraping | Batch keyword search, or import ID / @handle / TikTok links directly |
| 🌍 Multi-region | Choose US / UK / Southeast Asia / LATAM shop regions |
| 📧 Contact info | Bio, email, MCN; optional Partner Center authorization for available WhatsApp, LINE, Zalo, Viber, Facebook and other contacts |
| 📁 Export | CSV / Excel with customizable fields; headers follow UI language |
| 🚀 Dual speed modes | Fast mode (list only) vs Full mode (list + details), Full by default |
| 🔁 Resume history | One-click **Continue** (new creators only) or **Refresh** (re-scrape all, overwrite) |
| 🧹 Deduplication | New-only collection skips saved creator IDs within the selected region; explicit refresh updates existing records |
| 👥 Multi-account | Seller collection supports keyword sharding / same-keyword splits; throughput depends on permissions, workload and platform responses |
| 🛡️ Error handling | Seller collection has cooldown/backup-session handling; Partner enrichment stops and preserves progress on verification, throttling or permission errors, which may require manual action |
| 🔄 Cookie auto-replace | Same-account cookies auto-replace old entries; confirmed-invalid cookies are cleaned up after a run |
| 🗂️ Two-level category filter | TikTok-backend-style category picker: top-level category + vertical (2nd-level) category |
| ✅ Quick filters | **Has email / Has WhatsApp / Active only**; email and WhatsApp filters intersect when both selected. Deselect all display fields retains the creator-page column |
| ⏯️ Tri-state control | Pause / Resume / one-click **Finish & Export** (seconds-fast wind-down) |
| 🛡️ Quit protection | Exiting during a scrape asks: Save & Export / Discard / Cancel |
| 🌐 Bilingual UI | Chinese / English interface, field list and headers with one-click switch |
| 🔄 Auto-update | Checks for new versions on startup, one-click update (differential download) |
| 💾 Data memory | Remembers cookies, output history, resumes from breakpoints |
| 🖥️ Desktop integration | Desktop shortcut, custom icon, auto output/log folders |

## 📊 Data You Can Collect

| Category | Fields |
|---|---|
| Basic Info | creator page, nickname, creator ID, region, follower count |
| Sales Data | total GMV, GMV range, video GMV, live GMV, units sold, units sold range, category |
| Content Performance | avg/median video views, engagement, e-comm engagement, e-comm GPM, live GPM, e-comm avg UV |
| Follower Profile | age distribution, gender split (%), PPS score, fast growing, collaborated, category permission, live auction |
| Details (optional) | bio, collaboration email (auto-extracted), MCN agency, **vertical (2nd-level) category** |
| Partner contact enrichment | email, WhatsApp, LINE, Zalo, Viber, Facebook, other contacts, separate dialing codes, source and checked status/time |

Availability depends on the platform response and account permissions. Missing contacts stay empty; numbers and country codes are not guessed. Avatars are not stored in the current local library. Partner **Full profile + contacts** is off by default and pending live validation, not a guarantee that all profile fields can be collected.

## 📦 Install

### Existing users: use in-app incremental updates first

1. Wait for the startup update prompt or click **Check for Updates**, review the notes and confirm the download.
2. The updater reuses the cached old installer where possible and downloads changed blocks, with in-app progress.
3. When idle, choose **Restart & install** for a silent update without repeating the license/directory wizard. Alternatively, keep using the app and install on normal exit. Finish scraping/contact-enrichment tasks first.
4. The data location stays unchanged. Before important upgrades, stop tasks, close the app and back up `%APPDATA%\tiktok-shop-creator-scraper` locally, then reopen the app to update. Do not uninstall or clear the creator library.

**Incremental does not always mean small.** Real download checks: 1.3.0 → 1.3.1 downloads about **1.96 MB**; 1.3.1 → 1.4.0 reuses only **1.53%** after major Electron/dependency changes and downloads about **120.86 MB**. Both paths passed range download, reconstruction and dual-hash verification; installation was not executed. See the [incremental-update verification record](docs/incremental-update-verification-2026-09-09.md). MB is decimal, excluding blockmaps, HTTP overhead and the old base installer downloaded to prepare the test.

Missing old-installer cache, unavailable blockmaps or differential checksum failure cause automatic full-download fallback; installation still stays in-app. Manual installation below is a fallback when in-app updating is unavailable.

### First installation / fallback if automatic updating fails

⬇️ [**Download the latest Windows x64 installer**](https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/releases/latest)

- Run the installer wizard, accept the license agreement
- Desktop shortcut created automatically
- Choose an output directory; the default attempts `output/` beside the app, falling back to user data if unwritable
- Before manual replacement, stop tasks, exit and back up local data. The installer terminates old app processes. Uninstalling the old version is unnecessary

> The installer is unsigned and may trigger SmartScreen. Confirm the project Release source and checksums; do not disable system protection. The installer bundles its runtime, so Node.js is not needed; browser collection requires local Google Chrome.

## 🚀 Quick Start

### Step 1 — Export your Cookie (required)

The app needs your TikTok Shop Affiliate **login cookie** to access creator data. Exporting it takes ~2 minutes:

1. **Open Chrome** (or Edge) and go to the TikTok Shop Affiliate backend:
   **`https://affiliate.tiktokshopglobalselling.com`**
2. **Log in** to your seller account and open the **Creator Marketplace** (达人广场) page
3. **Install the Cookie-Editor extension**:
   [**Cookie-Editor**](https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm)
   → click "Add to Chrome" → confirm in the popup
   > If you already have it, skip this step. (Other compatible extensions: EditThisCookie, Cookie-Editor, etc.)
4. **Open the extension** — click the puzzle 🧩 icon (Extensions) in Chrome's top-right, then click **Cookie-Editor**
5. Click the **Export** button (bottom of the Cookie-Editor panel) — your cookies are now copied to the clipboard as a JSON text
6. **Paste or save it**:
   - **Option A (paste)**: open the app, click in the cookie box, paste (Ctrl+V) — done
   - **Option B (file)**: paste into a text file, save as `cookies.json`, then drag it into the app or click "Browse…"

> 💡 **What is a cookie?** A login credential sent to the corresponding TikTok platform for authorized requests, not telemetry sent to the project author. Seller sessions are saved in local settings; imported Partner enrichment sessions stay in app-process memory and must be reimported after exit. Never upload session files or local data backups to GitHub.

### Step 2 — Configure & Start

1. **Creator region**: choose the TikTok Shop site to scrape (e.g. US / UK / Southeast Asia)
2. **Scrape target**:
   - **Keyword search**: check creator categories / enter keywords to scrape marketplace results
   - **Import list**: paste creator IDs, @handles or TikTok links (one per line) to scrape only those
3. **Scrape mode**: **Full mode** is default (seller list + details: bio/email/MCN); **Fast mode** skips details and is usually faster, depending on platform responses
4. **Scrape scope**:
   - **New only (default)**: automatically skips already-scraped creators
   - **Re-scrape all**: re-scrapes everything and overwrites to refresh data
5. **Export settings**: choose CSV or Excel, pick an output folder, check the fields to export (headers follow UI language)
6. Click **▶ Start Scraping** — progress shows in the log below (Pause / Resume / one-click **Finish & Export** with seconds-fast wind-down; running-state Pause/Stop buttons are highlighted amber/red)
7. When done, the app shows **🆕 N new · 🔄 M updated**. The scrape page no longer writes a file automatically — data lives in the Creator Library; export a file from the Library / History when you need one

> 🆕 **First time?** Click **🔍 Test** first to verify everything works with a 1-page trial scrape (isolated environment, no full run).

> 🔁 **Want to continue a previous scrape?** In "History", find the file and click **🔼 Continue** to scrape only new creators and write back to the same file, or **🔄 Refresh** to re-scrape all and overwrite.

### Step 3 — Creator Library

- Switch to **📚 Creator Library** in the sidebar: every scraped creator is automatically stored in a local SQLite database (deduplicated)
- Sort / filter by nickname, followers, GMV, sales, activity status; **TikTok-backend-style filter bar**: region, category (two-level: top + vertical), audience ages/gender, PPS score, units sold, avg views, followers, GMV, activity — multi-select with removable chips
- Use **Has email / Has WhatsApp / Active only** to shortlist partners; the display-field drawer supports **Show all / Deselect all**, retaining the creator-page column
- **➕ Continue scraping**: reuses the last keywords to collect NEW creators, skipping ones already in the library, merging results in
- **Update creators**: re-scrapes the current filtered scope and refreshes the library (progress bar + remaining time + new/updated counts)
- **Activity**: the app uses last-publish time, growth trend and GMV changes to flag creators that may have stopped or slowed down — quickly screen out "zombie creators" before outreach
- Library data lives only on your machine — no external service involved

> 💡 **Vertical category**: the 2nd-level category comes from each creator's `vertical_pro_category` tag and is only returned for some creators. Run "Update creators" (Full mode) to backfill it.

### Step 4 — Enrich WhatsApp, LINE and other contacts (optional)

1. Filter existing records in **Creator Library** and open **Enrich profiles & contacts**. Clear “Has email / Has WhatsApp” before a first enrichment pass so records lacking contacts are not excluded.
2. Choose **Import Partner Cookie JSON**, select a JSON array exported from your own Partner Center session (`.json` / `.txt`), and choose its **Partner region**. Seller and Partner permissions are not interchangeable.
3. Keep the default **Contacts only**, refresh the scope count, then start. Scope is the intersection of the current filters and selected region; only existing records are updated, without deleting the library or creating unrelated records.
4. **No software-imposed creator count limit**: snapshot all matching IDs at start, deduplicate and process the whole scope, regardless of table pagination. Filter changes and newly imported records do not join the running job. Read and save one creator at a time, with a default 10-second serial interval; no chat pages, messages or invitations.
5. Stop while preserving progress. After restart, reimport authorization, keep the same region/filters and **skip already checked creators** to resume. Each saved response is a durable checkpoint, including successful “not provided” results; failed/unsaved reads never count as complete. Deselect the option to recheck saved creators.
6. Contacts-only mode retries network failures, timeouts and HTTP 500/502/503/504 after 30 / 60 / 120 seconds, then every 5 minutes until recovery or Stop, without skipping the pending creator. Actual throttling, verification, expired sessions or denied access pause immediately, without retries or an assumed daily quota. Failed writes and invalid response formats also pause with saved progress preserved to protect data. No software count limit is not a promise of unlimited platform quota or throttle-free access.

Numbers are stored as text, with separate country codes when provided. **Full profile + contacts (pending live validation)** is a separate optional mode with a warning, not equivalent to the verified contact-only path.

## ❓ FAQ

**Q: `1.3.2-contacts.2` reports `No published versions on GitHub` when checking for updates?**

A: The old preview omitted an explicit stable-channel policy. The updater infers a custom `contacts` channel from its suffix and ignores stable releases when no matching preview is published. This is not an empty repository or a damaged library. Source now selects stable releases and prohibits downgrades, but the old preview cannot download this fix itself. Stop tasks, exit and back up local data, then perform one manual upgrade with the official installer without uninstalling/clearing data. Continue using in-app updates afterward. This source fix does not replace the published 1.4.0 installer.

**Q: "Page did not load properly"?**  
A: Check session validity, account permissions, networking and platform verification in the corresponding backend. Re-export the session if necessary; validity is not a fixed three days.

**Q: Scraping is slow?**  
A: Intervals, detail-request count, permissions and platform responses affect speed. Full mode queries individual profiles and is usually slower than list-only collection. Partner contact enrichment is serial with a safety interval; no fixed multiplier or hourly yield is promised.

**Q: How do I use multiple accounts?**  
A: Click "＋ Add Account" in the cookie area and paste multiple account cookies. The app scrapes concurrently with staggered starts.

**Q: Will a new cookie for the same account be duplicated?**  
A: No. Pasting a cookie that matches an existing account (same sessionid / sid_guard etc.) automatically replaces the old entry. Cookies confirmed invalid during a run (redirected to login/blank page) are auto-removed afterwards; cookies merely expired-by-date but still working are kept.

**Q: "Detail timeout, skipped" in the log?**  
A: v1.2.10 and earlier had a false-alarm bug: a "timeout" line was printed 90s after every successful detail fetch (nothing was actually lost). Fixed in v1.2.11 — the log only fires on a real timeout (and includes the creator ID).

**Q: Interrupted mid-scrape?**  
A: Use Continue in history or the library to skip saved records by region and creator ID; explicitly refresh when updating old profiles. Partner enrichment can skip checked creators and continue the remainder. Expired sessions and verification may require your intervention; recovery is not always unattended.

**Q: Will already-scraped creators be scraped again?**  
A: No, by default. "New only" mode skips creators already saved (dedup by creator ID); choose "Re-scrape all" to refresh data.

**Q: What is the Creator Library (v1.2.0)?**  
A: Scraped creators are automatically stored in a local SQLite database with deduplication — browse, sort, filter, and refresh. Data stays on your machine only.

**Q: How is "activity" judged?**  
A: The app combines last-publish time, growth trend and GMV changes to classify creators as active / inactive / unknown — useful for screening out creators who may have stopped posting or are declining before you reach out.

**Q: Will I lose data when quitting?**  
A: Quitting during a scrape shows a dialog: "Save & Export" (finish and export first, then quit) / "Discard" / "Cancel" — data is never silently lost.

**Q: No email found?**  
A: In Full mode the app auto-extracts emails from creator bios. If the creator didn't write an email in their bio, the cell is empty — that's normal.

**Q: What do the numbers in "Audience Gender" mean?**  
A: Percentages (e.g. `Female: 79.47%`), not counts. TikTok's API returns "share × 100" values and the app converts them back to percentages automatically.

**Q: MCN agency is empty?**  
A: Most creators aren't bound to an MCN — TikTok returns "not authorized", which is normal, not a scraping failure.

## 💻 Development

```bash
npm ci
npm start          # run in dev mode (runs source directly)
npm run build -- --publish never  # build → dist/tiktok-shop-creator-scraper-setup-<version>.exe
```

> - Requires Google Chrome installed locally (the app connects via puppeteer-core).
> - Source development requires Node.js 22.12+; installers bundle the runtime. If the Electron binary is missing, run `node node_modules/electron/install.js`.
> - Unsigned builds use `win.signExecutable: false` while preserving executable icon and version metadata.
> - The installer icon is injected via the `afterPack.js` hook + rcedit; `rebuild-icons.js` regenerates the icon assets.

> 🌐 **Bilingual convention (mandatory)**: every new UI label, button, dialog, tooltip, field name and prompt must ship in BOTH Chinese and English (use the existing `I18N` dictionary + `uiLang` mechanism). A feature that lacks an English version is not done. Release notes must also be bilingual (English first — `What's new in vX.Y.Z` — then Chinese — `更新内容`).

## 📤 Release / Update

The existing path is **version check → user consent → differential download/reconstruction → verification → silent installation when idle or on exit**. Existing users do not need to repeat a manual installer wizard. Publishers still provide a complete installer: the updater downloads ranges from it, and it also serves first installs and full-download fallback.

See [1.4.0 dependencies and compatibility](docs/release-readiness-1.4.0.md) and [real differential/fallback verification](docs/incremental-update-verification-2026-09-09.md). **1.4.1 below is only a next-release example**, not a published version. Replace it consistently and author the corresponding bilingual release-notes file first:

```bash
# 1. Bump version (example: 1.4.0 → 1.4.1)
npm version patch --no-git-tag-version

# 2. Build installer
npm test
npm audit --audit-level=low
npm run build -- --publish never

# 3. Verify packaged source/runtime; builder generates latest.yml, ASCII installer and blockmap
node scripts/verify-release-package.js dist/win-unpacked
node scripts/verify-electron-startup.js dist/win-unpacked
node scripts/verify-update-artifacts.js dist
# From 1.4.0, do not run legacy prepare-release.js (old Chinese-named artifacts only).

# 4. Commit and tag
# Review and stage only source/docs; never credentials, databases or live-test artifacts
git commit -m "release 1.4.1"
git push origin main
git tag v1.4.1
git push origin v1.4.1

# 5. Create a draft Release and upload all 3 assets (small files first)
#    ⚠️ Release notes use a FIXED format: English first ("What's new in vX.Y.Z"),
#    then Chinese ("更新内容"). The update dialog lists every skipped version,
#    so each version needs both languages.
gh release create v1.4.1 --draft --title "v1.4.1" --notes-file docs/release-notes-1.4.1.md
gh release upload v1.4.1 dist/latest.yml dist/tiktok-shop-creator-scraper-setup-1.4.1.exe.blockmap
gh release upload v1.4.1 dist/tiktok-shop-creator-scraper-setup-1.4.1.exe
# Verify uploaded sizes, SHA-512 and latest.yml, then publish the draft
gh release edit v1.4.1 --draft=false --latest

# 6. Post-publication differential verification (network, isolated directory, NO installation)
node scripts/verify-incremental-update.js --live 1.4.0 1.4.1
# Existing users: in-app prompt → consent to incremental download → silent install / install on exit
```

> From 1.4.0, upload 3 update assets: ASCII installer, matching .blockmap and latest.yml. A duplicate Chinese-named installer is unnecessary.
> Keep historical **ASCII exe and .blockmap** assets for rollback and old-version blockmap lookup. Do not rename historical assets, overwrite published exe/blockmap/latest.yml files, or move published tags. Runtime changes require a new version. README/test-only changes do not require republishing an installer under the same version.
> `npm test` includes local differential/fallback regressions. `--live` explicitly downloads required public release assets and reconstructs in an isolated cache; reports remain in git-ignored `test-results/incremental-update-*`. This does not test installation.

## 📄 License

This project is licensed under the **GPL-3.0** License — see the [LICENSE](LICENSE) file.

---

*Keywords: TikTok Shop affiliate creator scraper TikTok Shop 达人抓取, TikTok creator data TikTok 达人数据采集, TikTok Shop seller tool TikTok 卖家工具, creator export CSV Excel 达人导出 CSV Excel, TikTok influencer analytics TikTok 网红数据分析, creator discovery 达人筛选, MCN lookup MCN 机构查询, contact email extractor 合作邮箱提取, TikTok Shop product research TikTok Shop 选品*
