# 增量更新验证 / Incremental update verification

验证日期：2026-09-09。补充此前仅覆盖更新资产元数据的检查。本次使用 GitHub 正式 Release 的真实安装包和 blockmap，实际执行差分下载与重建；**未执行安装包，也未修改生产达人库或更新缓存**。

> **后续发现的独立问题（同日）：** 用户运行的 `1.3.2-contacts.2` 在版本发现阶段报告 `No published versions on GitHub`。下述两条稳定版的差分测试没有覆盖这个入口。使用真实 GitHub 元数据已复现：更新器默认根据预发布后缀启用 `contacts` 自定义通道，找不到同通道版本时忽略正式版；显式设置 `allowPrerelease = false` 后可发现 `v1.4.0`。源码同时保持 `allowDowngrade = false`。新增 5 项通道/版本回归后完整套件为 **50 项通过**。旧预览版仍需一次人工确认的正式版覆盖升级，不能靠尚未下载的源码修复自身。本次没有自动执行该安装，也未替换原 Release 资产。

该通道修正另外通过独立 `win-unpacked` 构建、15 项打包模块核对和隐藏窗口的包内源码/preload/IPC 启动验证；测试使用临时数据目录。生成的是未发布检查产物，不是覆盖用户应用的安装包。

## 结论与原有设计

原有应用内增量更新没有被改成强制手动下载安装。`main.js` 保留 `autoDownload = false`（用户确认后下载）、`autoInstallOnAppQuit = true`，以及空闲时 `quitAndInstall(true, true)` 静默安装。新版另外避免在联系方式补全期间立即重启。

- 下载阶段：`electron-updater` 6.8.9 优先用旧安装包和 blockmap 计算可复用块，通过 HTTP Range 获取变化块并重建目标文件。
- 校验阶段：检查重建文件的 SHA-512。差分失败时自动回退完整下载，完整下载也必须校验。
- 安装阶段：静默安装或退出时安装。**发布一个完整 exe 是增量更新的数据来源，并不意味着用户每次都下载完整 exe。**
- 仅在应用内更新不可用时才提示手动下载。README 已将现有用户的主路径与首次安装/失败备用路径分开。

## 真实下载结果

两轮都使用同一个真实更新器和 Electron 网络传输，并强制差分失败时报错，禁止用整包回退冒充差分成功。

| 项目 | 1.3.0 → 1.3.1 | 1.3.1 → 1.4.0 |
| --- | ---: | ---: |
| 重建安装包大小（字节） | 101,847,736 | 122,735,678 |
| 从旧包复制（字节） | 99,887,914 | 1,877,320 |
| 实际 Range 响应体下载量（字节） | 1,959,822 | 120,858,358 |
| 复用比例 | 98.08% | 1.53% |
| HTTP Range 成功响应数 | 28 | 62 |
| 非 206 的 Range 响应 | 0 | 0 |
| 差分阶段完整 exe 下载次数 | 0 | 0 |
| 差分阶段耗时（含块表/重建，毫秒） | 2,257 | 14,314 |
| SHA-512 对照 Release latest.yml | 一致 | 一致 |
| SHA-256 对照 GitHub 资产摘要 | 一致 | 一致 |

1.3.0 → 1.3.1 于 02:51:35–02:52:01 UTC 执行；1.3.1 → 1.4.0 于 02:49:27–02:50:08 UTC 执行。总耗时还包括获取元数据、下载/校验旧基准包；表内耗时仅指差分阶段。这是本机网络下单轮观测，不是用户更新耗时承诺。

约 1.96 MB 与 120.86 MB 使用十进制 MB，不含块表、HTTP/TLS 开销和准备旧基准包的流量。两轮都主动从历史 Release 下载旧块表，验证没有旧块表缓存时的正常路径。

重建后 SHA-256：

```text
1.3.1  63d74fff5f8d7cab9b3e6dee397bcbf1734c876581c14fd5165dd0a43723d742
1.4.0  e318bc54e7ba2b16e4baf36c5488995fa7fe290e006a5678d2b62d53eab5f33f
```

**为何 1.4.0 仍然大？** 本次 Electron 从 33 系升至 43 系，构建工具和其他依赖也升级，大量二进制块发生变化。[依赖说明](release-readiness-1.4.0.md)及上表说明这次可复用块确实很少；这是低复用率，不是差分开关被关闭。后续复用率仍须针对每次构建测量。

## 补齐的回归测试

新增 `test/incremental-update.test.js` 共 11 项；与原有 34 项合计 **45 通过，0 失败**。使用 127.0.0.1 HTTP 服务、12 字节合成文件和独立临时缓存，不访问 GitHub或 TikTok，不执行安装。

1. 没有 `blockMapSize` 字段仍能分段下载变化块、复制旧块并精确重建。
2. 缓存块表损坏时重新读取旧 Release 块表。
3. 缓存块表有效时直接复用，不重复下载旧块表。
4. 旧安装包缓存缺失时回退完整下载。
5. 块表缺失时回退完整下载。
6. 新旧块表版本不兼容时回退完整下载。
7. 差分响应损坏、SHA-512 不匹配时回退完整下载。
8. 严格验证模式遇到损坏必须失败，不能用回退来通过差分测试。
9. 差分和完整下载都失败时报告失败。
10. 完整回退内容损坏时也必须校验失败。
11. 源码约束检查：用户确认下载、退出安装、静默安装参数及采集/补全忙碌保护保持存在。此项是静态检查，不是对话框端到端交互测试。

首次编写合成用例时遗漏 `fileInfo.info.url`，导致 NSIS 文件选择抛错；补齐符合实际元数据的测试夹具后重跑全部通过。没有为通过测试而修改生产更新器。

`blockMapSize`：旧版元数据有该字段，新版没有，但标准 NSIS 安装包差分入口不依赖它；带该条件的另一条路径用于 Web Installer 的包文件。本项目当前是普通 NSIS 安装包，两轮实测和合成用例均覆盖了实际路径，因此没有盲目补写该字段。

## 复现方法与安全边界

在安装了依赖与 stock Electron 的源码目录运行：

```powershell
npm ci
npm test
node scripts/verify-incremental-update.js --live 1.3.0 1.3.1
node scripts/verify-incremental-update.js --live 1.3.1 1.4.0
```

- `--live` 明确同意下载公开资产。脚本仅接受稳定版 `x.y.z`，从固定仓库获取正式 Release，核对基准包与目标包的元数据/哈希。
- 使用本地 **stock Electron 43.6.0** 与 **electron-updater 6.8.9**，不启动已安装的旧版或新版应用。虽然 1.3.1 与 1.4.0 使用相同更新器版本，本次不是旧 Electron 33 运行时的 UI 端到端测试。
- 调用实际 `AppUpdater.differentialDownloadInstaller`、GitHubProvider 的块表路径/Range 策略和 ElectronHttpExecutor；合成回退测试另外调用实际 NSIS 下载任务。验证适配器只提供隔离状态，不创建 autoUpdater 实例、不注册安装回调。
- 每轮新建 `test-results/incremental-update-*`，只在其中写基准包、块表、重建包、临时 Electron 配置与 `summary.json`。读取会话、真实库、生产更新缓存以及调用 `main.js` 均不在脚本中。生成目录被 Git 忽略，不随源码推送。
- 实际应用的版本检查/提示、旧缓存是否存在、Windows 文件锁、安装/重启、签名和生产数据升级仍是独立验收项目。脚本不把绕过签名验证的合成下载任务计为签名测试。
- 即使差分验证成功，也不能称作“已执行旧版到新版覆盖安装”。本次为保护现有应用和数据没有执行该步骤。

## 发布维护约束

- 保留普通 NSIS 三件套：规范 ASCII 名 exe、同名 `.blockmap`、匹配的 `latest.yml`。
- 保留历史 Release 资产和文件名；旧块表可能需要在线获取。不要为了减少 Release 文件数而删除历史基准。
- 不覆盖已经发布的 exe/块表，不移动旧 tag。若修改运行代码，另发新版本；这次只补测试和说明，**v1.4.0 的 tag、三个资产均保持不变**，安装包内附 README 仍是发布时版本，GitHub main 上为更新后的文档。
- 当前脚本依赖更新器内部 API。将来升级 `electron-updater` 时先跑这些回归，并重新做真实下载验证，不能只检查 `latest.yml`。

## English summary

Follow-up: the user's `1.3.2-contacts.2` preview failed earlier, during version discovery, because its inferred custom prerelease channel had no published match. This entry point was not covered by the stable-to-stable differential tests below. Real GitHub metadata reproduced the error; explicitly disabling prerelease selection discovers stable `v1.4.0`. Source also prohibits downgrades. Five additional channel/version regressions bring the suite to 50 passing tests. The installed preview still needs a one-time, user-approved official-installer upgrade; no installation or asset replacement was performed here.

The channel fix also passed an isolated unpacked build, 15 packaged-module checks and hidden packaged-source/preload/IPC startup verification with temporary user data. This unpublished check build was not installed over the user's application.

The original in-app incremental + silent-install workflow remains intact. Two real GitHub differential downloads were reconstructed with electron-updater 6.8.9 and stock Electron 43.6.0, using isolated caches. Both matched the published SHA-512 and SHA-256 and made no full-installer request during the differential phase.

- **1.3.0 → 1.3.1:** 1,959,822 downloaded bytes, 98.08% reused, 28 HTTP 206 responses; differential phase 2.257 seconds.
- **1.3.1 → 1.4.0:** 120,858,358 downloaded bytes, 1.53% reused, 62 HTTP 206 responses; differential phase 14.314 seconds. Major runtime/dependency changes explain the low reuse, not disabled differential updating.
- Figures exclude blockmap/HTTP overhead and the old-base download used to prepare each test. Timings are single-machine observations, not installation times or throughput guarantees.
- Eleven new loopback regressions cover cached/missing/corrupt blockmaps, missing old installers, differential and full-download corruption/failure, strict-test failure behavior, and static application configuration. The full suite passed **45/45**.
- No installer, installed application, production database/session or real updater cache was used. Old-runtime UI, consent dialogs, installation, restart and signing remain outside this test. v1.4.0 assets/tag were not overwritten; only source tests and repository documentation change.
