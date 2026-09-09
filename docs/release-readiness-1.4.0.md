# 1.4.0 依赖升级与兼容验证说明

验证日期：2026-09-09。结果来自本机检查，不是 GitHub Actions 或全平台兼容认证。正式安装包以 GitHub `v1.4.0` Release 的资产为准；不要分发旧的安全检查失败候选包。

**发布后补验（同日）：** 已补齐 1.3.0 → 1.3.1、1.3.1 → 1.4.0 的真实差分下载、重建及 SHA-512 / SHA-256 验证；新增 11 项更新回归后总计 45 项通过。[完整记录、实际下载量与边界](incremental-update-verification-2026-09-09.md)。下文“34 项”是发布前检查的历史记录，不应理解为覆盖了这次补验；安装/重启仍未执行。

## 升级了什么，为什么升级

| 组件 | 上一候选包实际版本 | 1.4.0 版本 | 原因与应用侧适配 |
| --- | --- | --- | --- |
| Electron（桌面运行时） | 33.4.11 | 43.6.0 | 更新 Chromium/Node 安全修复；复核主进程、预加载、窗口和 IPC 调用。安装版自带运行时。 |
| electron-builder（安装包工具） | 25.1.8 | 26.15.3 | 更新构建/归档依赖；验证 NSIS 构建、原图标、程序版本信息和更新资产。 |
| puppeteer-core（Chrome 控制） | 24.43.1 | 25.10.0 | 更新浏览器控制依赖；使用 BrowserContext.setCookie 与布尔 headless 参数，检查 CommonJS 项目加载新 ESM 包的兼容性。 |
| sqlite3（数据库驱动） | 5.1.7 | 6.0.1 | 更新原生驱动及其依赖；合成数据库验证旧驱动创建→新驱动修改→旧驱动回读。 |
| ExcelJS 的 uuid 间接依赖 | 8.3.2 | 11.1.1 | 仅对 ExcelJS 指定覆盖版本，测试其 UUIDv4 条件格式扩展及 Excel 写入/回读。ExcelJS 本身仍为 4.4.0。 |
| 其他间接依赖 | 旧 lockfile | 新 lockfile | 包括 tar 7.5.22、js-yaml 4.3.2、@xmldom/xmldom 0.8.15 等；具体版本以已提交的 package-lock.json 为准。 |

采用逐项升级和兼容修正，没有使用 `npm audit fix --force`。升级前审计列出 23 个受影响依赖包（1 critical、18 high、2 moderate、2 low）；升级后 `npm audit --audit-level=low` 为 **0 项已知漏洞**。这只是查询时的依赖公告结果，不表示软件绝对安全，也不解决平台验证或限流。

源码开发要求 **Node.js ≥22.12.0**；本次实际验证为 Node.js 24.18.0 / npm 11.16.0。普通安装用户不需要另装 Node.js，浏览器采集仍需要本机 Google Chrome。

## 测试环境和通过项目

本机为 Windows 11 Pro x64，系统版本 10.0.26200；实际 Chrome 为 153.0.8010.36，安装包运行时 Electron 43.6.0。

| 检查 | 实际验证内容 | 结果与边界 |
| --- | --- | --- |
| 离线回归 | 34 项：字段目录、号码前导零/国家码、去重、筛选、导出、限流/验证停止、断点、部分保存、其他地区数据保留 | 34 通过，0 失败；均为合成数据/响应，不是 34 位真实达人。 |
| Chrome/CDP | 启动真实无头 Chrome，导入合成 Cookie，完成 3 次 loopback 请求，重连/断开控制连接 | 通过；测试页面仅访问 127.0.0.1，不使用真实登录会话，不请求平台。其他 Chrome 版本未覆盖。 |
| 数据库跨驱动 | 旧 sqlite3 5.1.7 创建 2 条合成记录；新 6.0.1 更新；旧驱动只读回查 | 通过；19 位 ID、号码前导零、中日文、不同地区隔离保留，完整性检查为 ok。不是全量生产库迁移测试。 |
| CSV / Excel | SQLite 合成记录导出、XLSX 再读入；单独测试 UUID 条件格式扩展 | 通过；ID/号码按文本保留。未验证所有第三方办公软件版本。 |
| 打包模块与原生驱动 | 15 个应用模块及中英文 README 与源码一致；核对驱动/浏览器控制版本和打包范围；打包运行时加载构造函数和原生 SQLite，迁移内存库 | 通过；Cookie、数据库、真实测试产物不进入发布包。 |
| 主进程 / preload / 界面 IPC | 同版本 stock Electron 读取安装包中的真实源码；隐藏窗口、临时 userData；版本、空库、达人库导航、联系信息筛选/状态 IPC | 通过；屏蔽外部页面/下载，更新器使用桩。不是执行安装向导，也不是生产登录端到端采集。 |
| Windows 构建 | x64 NSIS 构建；原图标保留；程序 FileVersion 为 1.4.0，ProductVersion 为 1.4.0.0 | 通过；未配置签名证书，安装包未签名。 |
| 更新资产 | 版本、ASCII 安装包名、.blockmap、latest.yml 中的大小和 SHA-512 一致性 | 发布前核对；不能替代旧版实际下载并覆盖安装的端到端测试。 |

### 失败检查如何处理

首次启动测试把脚本参数传给了已打包的 exe；该 exe 会直接启动自身应用，未进入测试隔离入口，30 秒后超时结束。这次检查判定为**无效，不计入通过**，不能据此声称未访问生产 userData。没有发起真实采集或执行安装向导。随后改为同版本 stock Electron，先设置临时 userData、拦截外部操作，再加载包内源码；加入入口断言，修正后的隔离检查通过。

## 未验证范围

- 未在 Windows 10、ARM64、32 位 Windows、macOS/Linux 上执行安装/运行矩阵；本次只发布 Windows x64 安装包。
- 未运行 NSIS 安装/卸载、覆盖正在运行的旧版本或实际自动更新安装/重启。发布后补验已实际下载并重建更新包，但没有运行旧版 UI 流程或执行安装，仍不等同于安装端到端验证。
- 正式计入结果的兼容脚本不读取真实 Cookie 或发起平台采集；Chrome 验证使用合成 Cookie。首次无效启动的边界见上文。
- 此前联系方式接口仅通过小样本真实验证，不代表每位达人都有 WhatsApp、LINE 或邮箱。没有提供的字段保持为空。
- **完整资料自动补全仍是默认关闭、待实测的可选功能**。此前接口遇到平台验证；正常打开详情网页不等于完整自动采集已经可用。
- sqlite3 上游仓库已归档；驱动通过本次验证不等于长期维护承诺。后续单独评估替换驱动，不在本次未经验证地迁移数据层。

## 安装、数据与回退

1. 安装前停止采集并退出应用，再备份原 userData 目录（含数据库及可能存在的 WAL/SHM 文件）。备份只保存在本机，不上传 GitHub。
2. 保留原 appId、产品名和数据目录；依赖升级本身没有新增数据库 schema 变更。不删除、重建用户达人库。
3. 已安装用户优先重新打开软件，通过“检查更新”确认增量下载，空闲时静默安装或退出时安装；仅首次安装/应用内更新失败时手动使用 Release 的 exe。现有 NSIS 脚本会结束旧应用进程，不要在任务运行中手动覆盖安装。
4. 安装包未签名，Windows 可能显示 SmartScreen 提示；先确认官方仓库和校验值，不要关闭系统防护。
5. 回退前退出应用并另存当前数据，使用保留的历史安装包。跨驱动合成读写测试不保证所有历史应用 schema 均可逆；不要覆盖唯一备份或让不同版本同时写同一数据库。

## 复现检查

在项目目录执行；NEW_APP_DIR 指向本次构建的 win-unpacked，OLD_APP_DIR 指向使用 sqlite3 5.1.7 的旧候选包目录。跨驱动脚本只创建临时合成库；不把真实库路径传入。

```powershell
npm ci
node node_modules/electron/install.js
npm test
npm audit --audit-level=low
node scripts/verify-browser-compatibility.js
node scripts/verify-database-driver-upgrade.js OLD_APP_DIR
npm run build -- --publish never
node scripts/verify-release-package.js NEW_APP_DIR
node scripts/verify-electron-startup.js NEW_APP_DIR
node scripts/verify-update-artifacts.js dist
```

正式更新资产为 ASCII 安装包、同名 .blockmap、latest.yml 三个文件；不要用旧中文资产转换脚本覆盖新 builder 的元数据。源码、tag、main 和 Release 应指向同一发布提交。构建输出、真实测试探针和用户数据不加入源码提交。

## 上游依据

- [Electron breaking changes](https://www.electronjs.org/docs/latest/breaking-changes)：跨主版本 API / 安装方式检查。本次不引入 Electron 44 的额外 API 迁移。
- [Puppeteer 25.0.0 release](https://github.com/puppeteer/puppeteer/releases/tag/puppeteer-core-v25.0.0)：ESM、Node 要求及 API 变更；本项目实际锁定 25.10.0。
- [node-sqlite3 releases](https://github.com/TryGhost/node-sqlite3/releases)：6.x 原生构建及驱动更新；维护状态亦需持续评估。

## English summary

Electron, builder, Puppeteer and SQLite were upgraded with pinned versions and reviewed compatibility changes. The local audit reports zero known vulnerabilities. All 34 offline tests, synthetic cross-driver database/export checks, loopback-only real Chrome checks, packaged-module checks and isolated packaged-source IPC startup checks passed. No install-over-production or new live platform scraping was performed in these compatibility checks. The first startup harness attempt was invalid and excluded; its corrected isolated replacement passed. The Windows x64 installer is unsigned. Experimental full-profile collection remains off by default and pending live validation. Back up local data after stopping tasks and closing the app before upgrading.

Post-release addendum: two real differential downloads/reconstructions passed published SHA-512/SHA-256 verification, and 11 new updater regressions bring the suite to 45 passing tests. Existing users should use in-app incremental updates and silent/on-exit installation; manual installation is a fallback. Installation/restart and the old runtime UI were not exercised. See the linked incremental verification record above.
