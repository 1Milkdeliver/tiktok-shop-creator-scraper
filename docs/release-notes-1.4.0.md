## What's new in v1.4.0

- Add bounded Partner Center contact enrichment for WhatsApp, LINE, email, Zalo, Viber, Facebook and other available contact methods, including country codes and source/status fields.
- Add shared Has email / Has WhatsApp filters and Deselect all display fields; keep incremental saves, resume checkpoints and stop-on-verification/quota behavior.
- Upgrade Electron 43.6.0, electron-builder 26.15.3, puppeteer-core 25.10.0 and sqlite3 6.0.1. The release dependency audit reports zero known vulnerabilities; 34 offline regression tests passed.
- Verify synthetic SQLite driver round trips, CSV/XLSX exports, real Chrome loopback requests and isolated packaged-source startup/IPC. These are not a new live scraping or install-over-production test.
- Preserve the original icon, correct Windows executable version metadata and use one ASCII-named Windows x64 installer plus matching update files.

**Limitations:** Full-profile automatic enrichment is experimental, off by default and still pending live validation. Contact methods depend on creator/platform permissions. Rate limits and verification still apply. The installer is unsigned; stop tasks, close the app and back up local data before upgrading. No user credentials, creator records or database backups are included.

[Dependency changes, compatibility matrix and rollback notes](https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/blob/v1.4.0/docs/release-readiness-1.4.0.md)

## 更新内容

- 新增团长后台 WhatsApp、LINE、邮箱、Zalo、Viber、Facebook 及其他可用联系方式补全，分别保留国家码、来源和状态。
- 新增“有邮箱 / 有 WhatsApp”共用筛选及字段“取消全选”；支持逐步保存、断点续补，遇到验证或额度限制停止。
- 升级 Electron、打包工具、Puppeteer 与 SQLite 驱动；发布前依赖安全扫描为 **0 项已知漏洞**，**34 项离线测试通过**。
- 已验证合成数据库跨驱动读写、CSV/Excel 导出、真实 Chrome 本地请求、包内源码隔离启动与 IPC；不将这些检查描述为真实平台采集或覆盖安装测试。
- 沿用原 icon，修正 Windows 程序版本信息；提供统一 ASCII 文件名的 Windows x64 安装包及对应更新文件。

**已知限制：** 完整资料自动补全仍为默认关闭、待实测的可选功能；联系方式是否存在取决于达人和平台权限，平台验证/限流仍然生效。安装包未签名，安装前请停止任务、退出软件并备份本地数据。本次发布不包含 Cookie、真实达人记录或数据库备份。

[查看依赖升级、兼容测试范围和回退说明](https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/blob/v1.4.0/docs/release-readiness-1.4.0.md)
