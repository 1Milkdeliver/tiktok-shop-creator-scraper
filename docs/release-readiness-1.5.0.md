# v1.5.0 发布前复核

日期：2026-09-09。本机 Windows x64 验证，不是 GitHub Actions 或全平台兼容认证。

## 通过的检查

| 项目 | 结果 | 边界 |
| --- | --- | --- |
| 离线回归 | 79 / 79 通过，0 失败、0 跳过 | 合成响应与 SQLite 测试，不是真实达人成功率 |
| 依赖审计 | `npm audit --audit-level=low`：0 项已知漏洞 | 仅验证时的公告结果，不保证绝对安全 |
| JavaScript 语法 | 已跟踪 JS 文件及新增本地增量验证脚本检查通过 | 无独立 lint / TypeScript 配置，不宣称通过不存在的检查 |
| 浏览器兼容 | Chrome 153.0.8010.36，3 次本地请求，Cookie 上下文与 CDP 重连/断开通过 | 合成 Cookie、loopback 页面；不使用生产会话，不请求平台 |
| 旧库兼容 | 1.4.0 打包代码创建 2 条合成记录，1.5.0 更新联系方式，旧版驱动回读通过；完整性为 ok | 大 ID、号码前导零、中日文、跨地区保留及 CSV/XLSX 回读；未打开生产库 |
| 安装包源文件 | 17 个必需模块与待发布源码逐字节一致，SQLite 原生驱动及内存库迁移通过 | 检查打包内容，无真实数据、凭据或测试明细 |
| 主进程 / 界面 | 同版本 stock Electron 加载真实打包源码，隐藏窗口通过 preload、版本、空库、导航、联系筛选/状态及自动采集控件检查 | 外部网络和更新下载被阻断，临时 userData，不是运行生产安装程序 |
| NSIS 构建 | Windows x64 构建成功，Electron 43.6.0 | 沿用未签名发布方式，Windows 仍可能提示未知发布者；其他系统/架构未测试 |
| 更新资产 | 版本、文件名、大小、SHA-512、blockmap 覆盖均通过 | 完整 exe、匹配 blockmap、latest.yml 三件套 |
| 发布前真实安装包差分 | 1.4.0 → 1.5.0，以真实旧/新安装包在本地 HTTP 重建，105 次 HTTP 206，0 次完整下载，SHA-512 / SHA-256 一致 | 使用真实 electron-updater 差分代码；不是 GitHub 网络或安装向导测试 |

## 继续使用原更新方式

应用内检查 → 用户确认 → 优先差分下载并重建 → 校验 → 空闲时静默安装或退出时安装。保留旧版更新资产，不移动旧 tag，不改变应用 ID、图标与 `%APPDATA%\tiktok-shop-creator-scraper` 数据目录。不卸载、不清空达人库。

旧缓存缺失或损坏、块表不可用、差分校验失败等情况才回退完整下载；已有回归覆盖回退路径及完整下载校验失败。更新器下载并校验的仍是完整安装程序，发布方必须提供完整 exe。

本次依赖和数据库结构与 1.4.0 相同。本地验证复用 **111,101,029 字节（90.51%）**，新下载 **11,648,152 字节（约 11.65 MB）**，重建结果 **122,749,181 字节**。数字不含 blockmap、HTTP 开销及测试准备的旧安装包；真实 GitHub 传输需要发布后另行验证，不在此冒充已完成。未执行安装/重启，未覆盖当前软件。

## 待发布资产指纹

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `tiktok-shop-creator-scraper-setup-1.5.0.exe` | 122749181 | `a1cd3d1f6c821db46b7ca51bb4ee3bf554b7e40c9be59c767451b516bf096494` |
| `tiktok-shop-creator-scraper-setup-1.5.0.exe.blockmap` | 129892 | `8faabfb44dfab8abd993913edcb4a59423d62dbf54a0e539789ed7183955fc7d` |
| `latest.yml` | 383 | `4c491798dde182608d178ff13a0993e7fda71e5675e1bf393984d4fa9b6050fc` |

旧基准安装包与已公开 v1.4.0 资产的 SHA-256 一致：`e318bc54e7ba2b16e4baf36c5488995fa7fe290e006a5678d2b62d53eab5f33f`。旧块表也与公开资产一致。新 app.asar 的 SHA-256 为 `ceeaf231c81026fccf39c6c5b53ce6b538b3c3c3505540ab29387922eb0d1ec0`。

## 功能验证限制

真实联系方式小样本结果及未完成功能见 [更新说明](release-notes-1.5.0.md)。本次发布复核没有重新发起平台采集，也没有绕过验证、读取凭据或改变生产库。未宣称完整资料全字段已测通、采集前高级条件筛选已实现、100 位全部取得联系方式或不限流。

## 复现命令

```powershell
npm test
npm audit --audit-level=low
node scripts/verify-browser-compatibility.js
node scripts/verify-database-driver-upgrade.js OLD_WIN_UNPACKED
node scripts/verify-release-package.js dist/release-1.5.0/win-unpacked
node scripts/verify-electron-startup.js dist/release-1.5.0/win-unpacked
node scripts/verify-update-artifacts.js dist/release-1.5.0
node scripts/verify-local-release-update.js OLD_RELEASE_ASSETS dist/release-1.5.0
# 公开发布后才可执行；使用隔离缓存，不运行安装程序：
node scripts/verify-incremental-update.js --live 1.4.0 1.5.0
```
