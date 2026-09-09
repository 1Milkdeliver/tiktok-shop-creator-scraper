## What's new in v1.4.0

- Add bounded Partner Center contact enrichment for WhatsApp, LINE, email, Zalo, Viber, Facebook and other available contact methods, including country codes and source/status fields.
- Add shared Has email / Has WhatsApp filters and Deselect all display fields; keep incremental saves, resume checkpoints and stop-on-verification/quota behavior.
- Upgrade Electron 43.6.0, electron-builder 26.15.3, puppeteer-core 25.10.0 and sqlite3 6.0.1. The release dependency audit reports zero known vulnerabilities; 34 offline regression tests passed.
- Verify synthetic SQLite driver round trips, CSV/XLSX exports, real Chrome loopback requests and isolated packaged-source startup/IPC. These are not a new live scraping or install-over-production test.
- Preserve the original icon, correct Windows executable version metadata and use one ASCII-named Windows x64 installer plus matching update files.

**Limitations:** Full-profile automatic enrichment is experimental, off by default and still pending live validation. Contact methods depend on creator/platform permissions. Rate limits and verification still apply. The installer is unsigned; stop tasks, close the app and back up local data before upgrading. No user credentials, creator records or database backups are included.

[Dependency changes, compatibility matrix and rollback notes](https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/blob/v1.4.0/docs/release-readiness-1.4.0.md)

**How to update:** Existing users should use **Check for Updates** in the app, confirm the differential download, then install silently when idle or on exit. Manual installation is for first installs or automatic-update failure. Preserve the local data folder and back it up after stopping tasks/closing the app, before reopening to update. Missing old-installer cache or differential failure triggers verified full-download fallback; it does not require uninstalling.

**Post-release verification, 2026-09-09:** Real differential reconstruction and both published hashes passed for 1.3.0 → 1.3.1 (about 1.96 MB downloaded, 98.08% reused) and 1.3.1 → 1.4.0 (about 120.86 MB, 1.53% reused). The latter remains large because of major runtime/dependency changes. Eleven additional updater tests bring the source suite to 45 passing tests. Installation/restart was not executed; this is not an old-runtime UI end-to-end test. Published installer assets and tag are unchanged. [Detailed verification and boundaries](https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/blob/main/docs/incremental-update-verification-2026-09-09.md).

## 更新内容

- 新增团长后台 WhatsApp、LINE、邮箱、Zalo、Viber、Facebook 及其他可用联系方式补全，分别保留国家码、来源和状态。
- 新增“有邮箱 / 有 WhatsApp”共用筛选及字段“取消全选”；支持逐步保存、断点续补，遇到验证或额度限制停止。
- 升级 Electron、打包工具、Puppeteer 与 SQLite 驱动；发布前依赖安全扫描为 **0 项已知漏洞**，**34 项离线测试通过**。
- 已验证合成数据库跨驱动读写、CSV/Excel 导出、真实 Chrome 本地请求、包内源码隔离启动与 IPC；不将这些检查描述为真实平台采集或覆盖安装测试。
- 沿用原 icon，修正 Windows 程序版本信息；提供统一 ASCII 文件名的 Windows x64 安装包及对应更新文件。

**已知限制：** 完整资料自动补全仍为默认关闭、待实测的可选功能；联系方式是否存在取决于达人和平台权限，平台验证/限流仍然生效。安装包未签名，安装前请停止任务、退出软件并备份本地数据。本次发布不包含 Cookie、真实达人记录或数据库备份。

[查看依赖升级、兼容测试范围和回退说明](https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/blob/v1.4.0/docs/release-readiness-1.4.0.md)

**升级方式：** 已安装用户优先在软件里点击 **检查更新**，确认增量下载后，空闲时静默安装或退出时安装；手动安装包仅用于首次安装或自动更新失败。保留原数据目录，重要升级前先停止任务、退出软件并备份，再重新打开软件更新。旧安装包缓存缺失或差分失败时会自动回退完整下载并校验，无需卸载。

**2026-09-09 发布后补验：** 1.3.0 → 1.3.1 实际差分下载约 1.96 MB、复用 98.08%；1.3.1 → 1.4.0 约 120.86 MB、复用 1.53%，因运行时/依赖大幅变化所以本次仍较大。两条路径均已重建并通过双哈希校验；新增 11 项更新回归，源码测试共 45 项通过。本次未执行安装/重启，也不是旧运行时界面的端到端测试；已发布安装包和 tag 保持不变。[详细验证记录与边界](https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/blob/main/docs/incremental-update-verification-2026-09-09.md)。
