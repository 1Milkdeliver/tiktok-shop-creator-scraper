<p align='center'>
<img src='./build/icon.ico' width="150" height="150" alt="TikTokShop Creator Scraper Icon" />
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
- Extract creator contact info (bio, collaboration email, MCN agency)
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
| 🎨 3-workspace UI | Sidebar navigation: **Scrape / Creator Library / History**, teal-glass theme, bilingual |
| 💾 Creator library | SQLite storage: auto-dedupe, browse / sort / filter / refresh |
| 📊 Activity status | Auto-tags creators active / inactive / unknown with explainable signals |
| ⏱️ Refresh progress | Live progress bar + estimated remaining time while updating the library |
| 🔍 Creator scraping | Batch keyword search, or import ID / @handle / TikTok links directly |
| 🌍 Multi-region | Choose US / UK / Southeast Asia / LATAM shop regions |
| 📧 Contact info | Bio, collaboration email (auto-extracted), MCN agency |
| 📁 Export | CSV / Excel with customizable fields; headers follow UI language |
| 🚀 Dual speed modes | Fast mode (list only) vs Full mode (list + details), Full by default |
| 🔁 Resume history | One-click **Continue** (new creators only) or **Refresh** (re-scrape all, overwrite) |
| 🧹 Deduplication | List + detail double dedupe — the same creator is never collected twice |
| 👥 Multi-account | Keyword sharding / same-keyword split — several cookies in parallel, 3×+ faster in tests |
| 🛡️ Risk-control self-heal | Auto-switches to backup cookies + auto-resumes after cool-down — no babysitting |
| 🔄 Cookie auto-replace | Same-account cookies auto-replace old entries; confirmed-invalid cookies are cleaned up after a run |
| 🗂️ Two-level category filter | TikTok-backend-style category picker: top-level category + vertical (2nd-level) category |
| ✅ Quick filters | One-click "Email only" / "Active only" checkboxes, multi-field filters with removable chips |
| ⏯️ Tri-state control | Pause / Resume / one-click **Finish & Export** (seconds-fast wind-down) |
| 🛡️ Quit protection | Exiting during a scrape asks: Save & Export / Discard / Cancel |
| 🌐 Bilingual UI | Chinese / English interface, field list and headers with one-click switch |
| 🔄 Auto-update | Checks for new versions on startup, one-click update (differential download) |
| 💾 Data memory | Remembers cookies, output history, resumes from breakpoints |
| 🖥️ Desktop integration | Desktop shortcut, custom icon, auto output/log folders |

## 📊 Data You Can Collect

| Category | Fields |
|---|---|
| Basic Info | creator page, nickname, creator ID, avatar, region, follower count |
| Sales Data | total GMV, GMV range, video GMV, live GMV, units sold, units sold range, category |
| Content Performance | avg/median video views, engagement, e-comm engagement, e-comm GPM, live GPM, e-comm avg UV |
| Follower Profile | age distribution, gender split (%), PPS score, fast growing, collaborated, category permission, live auction |
| Details (optional) | bio, collaboration email (auto-extracted), MCN agency, **vertical (2nd-level) category** |

## 📦 Install

⬇️ [**Download Latest Installer (Windows)**](https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/releases/latest)

- Run the installer wizard, accept the license agreement
- Desktop shortcut created automatically
- Output files go to `output/` folder, logs to `logs/` folder in the install directory

> If Windows SmartScreen warns, click "More info → Run anyway" (normal for unsigned open-source apps).

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

> 💡 **What is a cookie?** It's a small token your browser stores after login. The app uses it only to view data under your own account — it never uploads or shares it.

### Step 2 — Configure & Start

1. **Creator region**: choose the TikTok Shop site to scrape (e.g. US / UK / Southeast Asia)
2. **Scrape target**:
   - **Keyword search**: check creator categories / enter keywords to scrape marketplace results
   - **Import list**: paste creator IDs, @handles or TikTok links (one per line) to scrape only those
3. **Scrape mode**: **Full mode** is default (list + details: bio/email/MCN, slower); switch to **Fast mode** (list only, 2-3× faster) if you don't need details
4. **Scrape scope**:
   - **New only (default)**: automatically skips already-scraped creators
   - **Re-scrape all**: re-scrapes everything and overwrites to refresh data
5. **Export settings**: choose CSV or Excel, pick an output folder, check the fields to export (headers follow UI language)
6. Click **▶ Start Scraping** — progress shows in the log below (Pause / Resume / one-click **Finish & Export** with seconds-fast wind-down; running-state Pause/Stop buttons are highlighted amber/red)
7. When done, the app shows **🆕 N new · 🔄 M updated**. The scrape page no longer writes a file automatically — data lives in the Creator Library; export a file from the Library / History when you need one

> 🆕 **First time?** Click **🔍 Test** first to verify everything works with a 1-page trial scrape (isolated environment, no full run).

> 🔁 **Want to continue a previous scrape?** In "History", find the file and click **🔼 Continue** to scrape only new creators and write back to the same file, or **🔄 Refresh** to re-scrape all and overwrite.

### Step 3 — Creator Library (new in v1.2.0)

- Switch to **📚 Creator Library** in the sidebar: every scraped creator is automatically stored in a local SQLite database (deduplicated)
- Sort / filter by nickname, followers, GMV, sales, activity status; **TikTok-backend-style filter bar**: region, category (two-level: top + vertical), audience ages/gender, PPS score, units sold, avg views, followers, GMV, activity — multi-select with removable chips
- One-click **Email only** / **Active only** checkboxes to shortlist partners
- **➕ Continue scraping**: reuses the last keywords to collect NEW creators, skipping ones already in the library, merging results in
- **Update creators**: re-scrapes the current filtered scope and refreshes the library (progress bar + remaining time + new/updated counts)
- **Activity**: the app uses last-publish time, growth trend and GMV changes to flag creators that may have stopped or slowed down — quickly screen out "zombie creators" before outreach
- Library data lives only on your machine — no external service involved

> 💡 **Vertical category**: the 2nd-level category comes from each creator's `vertical_pro_category` tag and is only returned for some creators. Run "Update creators" (Full mode) to backfill it.

## ❓ FAQ

**Q: "Page did not load properly"?**  
A: Your cookie may have expired (TikTok sessions last ~3 days). Re-export a fresh cookie.

**Q: Scraping is slow?**  
A: Request intervals are randomized (~6-15s) for stability. Full mode (details) is slower as each creator is queried individually; switch to **Fast mode** if you don't need email/bio (2-3× faster).

**Q: How do I use multiple accounts?**  
A: Click "＋ Add Account" in the cookie area and paste multiple account cookies. The app scrapes concurrently with staggered starts.

**Q: Will a new cookie for the same account be duplicated?**  
A: No. Pasting a cookie that matches an existing account (same sessionid / sid_guard etc.) automatically replaces the old entry. Cookies confirmed invalid during a run (redirected to login/blank page) are auto-removed afterwards; cookies merely expired-by-date but still working are kept.

**Q: "Detail timeout, skipped" in the log?**  
A: v1.2.10 and earlier had a false-alarm bug: a "timeout" line was printed 90s after every successful detail fetch (nothing was actually lost). Fixed in v1.2.11 — the log only fires on a real timeout (and includes the creator ID).

**Q: Interrupted mid-scrape?**  
A: Restart the app and scrape again — it resumes automatically from the last checkpoint. If risk-control triggers, the app auto-switches to a backup cookie and auto-resumes after the cool-down — no babysitting.

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
npm install
npm start          # run in dev mode (runs source directly)
npm run build      # build installer → dist/TikTokShop达人抓取安装程序-<version>.exe
```

> - Requires Google Chrome installed locally (the app connects via puppeteer-core).
> - Set `CSC_IDENTITY_AUTO_DISCOVERY=false` when packaging to skip code signing (known Windows symlink permission issue).
> - The installer icon is injected via the `afterPack.js` hook + rcedit; `rebuild-icons.js` regenerates the icon assets.

> 🌐 **Bilingual convention (mandatory)**: every new UI label, button, dialog, tooltip, field name and prompt must ship in BOTH Chinese and English (use the existing `I18N` dictionary + `uiLang` mechanism). A feature that lacks an English version is not done. Release notes must also be bilingual (English first — `What's new in vX.Y.Z` — then Chinese — `更新内容`).

## 📤 Release / Update

The app checks GitHub for new versions on startup (differential download). To publish a new version:

```bash
# 1. Bump version (e.g. 1.1.1 → 1.2.0)
npm version patch --no-git-tag-version

# 2. Build installer
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
npm run build

# 3. Generate differential-update metadata (latest.yml + ASCII-named assets)
node prepare-release.js 1.2.0

# 4. Commit and tag
git add -A && git commit -m "release 1.2.0"
git push origin main
git tag v1.2.0 && git push origin v1.2.0

# 5. Create the Release and upload all 4 assets (small files first to avoid timeouts)
#    ⚠️ Release notes use a FIXED format: English first ("What's new in vX.Y.Z"),
#    then Chinese ("更新内容"). The update dialog lists every skipped version,
#    so each version needs both languages.
gh release create v1.2.0 --title "v1.2.0" --notes "What's new in v1.2.0
- change 1
- change 2

更新内容
- 改动 1
- 改动 2"
gh release upload v1.2.0 dist/latest.yml dist/tiktok-shop-creator-scraper-setup-1.2.0.exe.blockmap
gh release upload v1.2.0 dist/tiktok-shop-creator-scraper-setup-1.2.0.exe
gh release upload v1.2.0 "dist/TikTokShop达人抓取安装程序-1.2.0.exe"

# 6. Old-version users get an update prompt on startup → install over same directory (data preserved)
```

> All 4 assets are required (Chinese-named installer, ASCII-named exe, .blockmap, latest.yml) — missing any one breaks the update.
> Version comparison: three-part version (major.minor.patch), any part higher triggers the update prompt. Keep only the latest release — the README download link auto-points to `/releases/latest`.

## 📄 License

This project is licensed under the **GPL-3.0** License — see the [LICENSE](LICENSE) file.

---

*Keywords: TikTok Shop affiliate creator scraper TikTok Shop 达人抓取, TikTok creator data TikTok 达人数据采集, TikTok Shop seller tool TikTok 卖家工具, creator export CSV Excel 达人导出 CSV Excel, TikTok influencer analytics TikTok 网红数据分析, creator discovery 达人筛选, MCN lookup MCN 机构查询, contact email extractor 合作邮箱提取, TikTok Shop product research TikTok Shop 选品*
