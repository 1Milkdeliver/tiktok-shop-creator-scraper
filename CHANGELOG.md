# Changelog

## [Unreleased]

### Changed / 更新内容

- Contact-only enrichment explicitly processes the full starting filter/market scope without a software-imposed creator limit. Deduplicate and snapshot IDs so table pagination, changing results and caller mutations do not truncate or duplicate work.
- Retry transient contact reads after 30 / 60 / 120 seconds, then every 5 minutes until recovery or user cancellation. Actual throttling, verification, authentication/access failures, invalid responses and failed database writes still pause safely; full-profile retry policy and seller browser/authentication/pacing settings are unchanged.
- Display completed, paused, stopped and recovering states, with remaining counts and a retry countdown. Saved creators, including confirmed empty contact responses, remain resumable checkpoints after restart.
- 不设软件固定条数上限，按启动时筛选与地区的交集去重、逐位入库并持续处理。短暂网络异常自动退避重试，实际限流/验证/登录异常不重试；写库失败或返回结构异常也保留进度暂停。卖家登录、浏览器与请求间隔设置保留。
- Stream each committed discovery page into a job/market-scoped contact queue alongside seller list/profile collection, rather than starting contacts after the whole run. One paced contact consumer persists checks incrementally, deduplicates late/repeated pages, waits for new creators when empty, and drains on normal producer completion. New task UI enables the option by default; old configurations remain disabled.
- Missing contacts do not gate library admission. Preserve creators with found, absent or failed contact reads; failed refreshes retain existing values and remain pending. Email/WhatsApp availability filters affect viewing/export, not contacts-only enrichment. Serialize concurrent seller writes and keep final new-creator counts accurate after early saves.
- Remove the 500-input truncation and sparse-page termination heuristic. Unchanged pagination or failed persistence reports an incomplete run and retains checkpoints; no claim of entire-platform coverage. Keep the seller detail callback's runner context so progress/resume recording can complete.
- Share a write gate across seller/import transactions and contact patches, preserving verified contacts against late, stale or blank seller flushes. Task Stop/close stops both stages; contact-only Stop or errors never silently restart on later pages. Pause holds new contact reads; completed responses still save. UI distinguishes waiting, draining and contacts pending from full completion.
- 新增“边采集边补全联系方式（并行）”：每页达人入库即加入联系方式队列，与列表/详情同时读取，不等整轮结束。联系方式继续单队列、安全间隔请求；网络并行、入库排队，防止相互覆盖。有无联系方式都保留；未提供与读取失败分开标记。空队列等待新达人不假报完成，资料结束后继续处理剩余联系方式。任务结束/退出停止两条流程，单独停止联系方式不会停止资料采集，也不会被新页面自动重启。保留查重、逐位入库和手动断点续抓，不删除用户数据库、不发送消息。
- Verification: 76 offline tests pass, including 1,005 synthetic creators saved across a 503 / 502 Stop-and-reopen continuation, page-before-detail persistence, 501-ID input, sparse pagination, failed-save handling, streaming overlap through real main-process hooks, queue pacing/late arrivals, pause/stop races, region/job isolation, concurrent SQLite patches and truthful task UI states. These are fixture/SQLite tests, not live accuracy or speed measurements. No production library, credentials or live platform requests were used; no new installer release or in-place installation has been performed.

## [1.4.0] - 2026-09-09

Dependency upgrade and compatibility details: [release verification](docs/release-readiness-1.4.0.md).

### Security and compatibility

- Upgrade Electron 33.4.11 → 43.6.0, electron-builder 25.1.8 → 26.15.3, puppeteer-core 24.43.1 → 25.10.0 and sqlite3 5.1.7 → 6.0.1; update vulnerable transitive dependencies. The release audit reports no known vulnerabilities at verification time, not a guarantee of vulnerability-free software.
- Adopt BrowserContext cookie import and boolean headless options; require Node.js 22.12+ for source development. End users receive the bundled runtime.
- Keep Windows executable version/icon metadata while explicitly disabling unsigned-release code signing; use one canonical ASCII installer filename for updates.
- Pass 34 offline regression tests, loopback-only Chrome/CDP checks, synthetic cross-driver SQLite read/write/readback, CSV/XLSX round trips and isolated packaged-source startup/IPC checks. Platform collection and installation over a running production app are not part of these checks.

### Added

- Enrich existing library records with available Partner Center WhatsApp, LINE, email, Zalo, Viber, Facebook and other contact fields. Country codes, provenance and collection status are kept separately.
- Shared “Has email” and “Has WhatsApp” filters for library results, exports and enrichment scope; a “Deselect all” field action keeps the Creator Page column visible.
- Serial enrichment with incremental saves, redacted progress logs, resume support and immediate stopping on verification, authentication, quota or rate-limit errors.
- Experimental full-profile enrichment with module-level checkpoints and field-availability status. This remains opt-in and explicitly marked **pending live validation**.
- Offline storage and readback verification for reviewed visible-page observations, preserving reporting periods, original displayed units and separate all-content/product-content metrics.

### Privacy and validation

- Partner credentials stay in main-process memory for the current run and are not added to logs or exports. Local credentials, databases and live-test artifacts are excluded from Git.
- Contact API reads have passed bounded live tests; full-profile API requests still require platform verification. Reading a normal detail page is not proof that automatic full-profile collection works.
- The installer includes contact enrichment and the opt-in experimental profile mode. Existing seller discovery remains unchanged; automatic full-profile collection is not claimed to be live-validated.

### 更新内容

- 新增团长后台联系方式补全，分别保存 WhatsApp、LINE、邮箱和其他联系方式、国家码、来源与检查状态。
- 达人库新增“有邮箱 / 有 WhatsApp”筛选和“取消全选”字段操作；列表、导出、补全使用相同筛选范围。
- 逐位或逐模块保存，遇到验证、会话异常或额度限制立即停止；完整资料模式仍为待实测的可选功能。
- 正常网页可见数据支持分口径存储与回读核验，不将页面观察误记为完整自动采集成功。
- 升级桌面运行时、打包工具、浏览器控制与数据库驱动，发布前安全扫描为 0 项已知漏洞；详见依赖升级与兼容说明。
- 主分支与 Windows 安装包使用同一版本代码；完整资料自动采集仍保留“待实测”提示且默认不启用。不上传 Cookie、达人数据或数据库备份。

## [1.3.1] - 2026-08-25

### Changed

- Arranged the six Creator Library summary cards into a clearer two-row, three-column desktop layout, with responsive fallbacks for narrower windows.

### Fixed

- Kept the product-category dropdown open while selecting parent or child categories, so multiple categories can be chosen without reopening the menu.

### 更新内容

- 达人库六张统计卡调整为更清晰的桌面端两行三列布局，并为较窄窗口提供响应式排列。
- 修复勾选一级或二级商品类目后下拉框立即关闭的问题，支持连续选择多个类目。

## [1.3.0] - 2026-08-25

### Added

- Added polished, bilingual creator filter groups for creator attributes, audience profiles, and commerce performance.
- Added a searchable two-level product category picker backed by observed creator data.
- Added the same creator filters to Export Center, with shared applied state and filtered database export.
- Added pending, apply, discard, reset, removable-chip, keyboard-navigation, and accessible status interactions.

### Changed

- Filter selections now remain pending until **Apply filters** is clicked, avoiding repeated database queries while editing.
- Applying filters in Export Center no longer loads the hidden Creator Library table.
- Replaced the ambiguous continue-scraping plus icon with a clear loop/continue icon.

### Fixed

- Fixed vertical categories appearing under unrelated top-level categories.
- Fixed vertical-category matching when the selected value was not the first stored category.
- Fixed concurrent filter rendering that could duplicate filter fields.

### 更新内容

- 新增精细化的中英文达人筛选分组，覆盖达人属性、粉丝画像和带货表现。
- 新增基于达人库真实数据的可搜索两级商品类目选择器。
- 导出中心新增同一套达人筛选条件，共享已应用状态并支持筛选后导出。
- 新增待应用、应用、撤销、重置、标签移除、键盘导航和无障碍状态提示。
- 勾选筛选条件时不再反复查询数据库，只有点击“应用筛选”后才更新结果。
- 在导出中心应用条件时不再加载隐藏的达人表格。
- 将含义不清的继续抓取加号替换为循环继续图标。
- 修复二级类目归属、垂直类目匹配和并发渲染导致的重复筛选项问题。
