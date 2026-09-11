<p align='center'>
<img src="https://raw.githubusercontent.com/1Milkdeliver/tiktok-shop-creator-scraper/main/icon-256.png" width="150" height="150" alt="TikTok Shop Creator Scraper icon" />
</p>

<h1 align="center">TikTok Shop Creator Scraper · TikTokShop达人抓取</h1>

<p align="center">TikTok Shop Creator Scraper for affiliate creator discovery, creator data and contact export. 面向 TikTok Shop 卖家的开源桌面工具：抓取联盟达人数据、分析带货表现并导出邮箱与 MCN 信息。</p>

<p align="center"><strong>TikTok Shop Affiliate Creator Data · TikTok Influencer Discovery · TikTok Creator Contact Export</strong></p>

<p align="center">
  <a href="https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/stargazers"><img src="https://img.shields.io/github/stars/1Milkdeliver/tiktok-shop-creator-scraper" alt="Stars"/></a>
  <a href="https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/network/members"><img src="https://img.shields.io/github/forks/1Milkdeliver/tiktok-shop-creator-scraper" alt="Forks"/></a>
  <a href="https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/blob/main/LICENSE"><img src="https://img.shields.io/github/license/1Milkdeliver/tiktok-shop-creator-scraper" alt="License"/></a>
  <a href="https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/releases/latest"><img src="https://img.shields.io/github/v/release/1Milkdeliver/tiktok-shop-creator-scraper" alt="最新版本"/></a>
</p>

<div align="center">
  <a href="./README.md">中文</a> / <a href="./README.en.md">English</a>
</div>

> English-first keywords: **TikTok Shop Creator Scraper · TikTok Shop Affiliate Creator Data · TikTok Influencer Discovery · TikTok Creator Contact Export**. See the full [English README](README.en.md).

---

## 📑 目录

- [🚀 项目介绍](#-项目介绍)
- [🎯 适合谁用](#-适合谁用)
- [✨ 功能特性](#-功能特性)
- [📊 可抓取的数据](#-可抓取的数据)
- [📦 安装](#-安装)
- [🚀 快速开始](#-快速开始)
- [❓ 常见问题](#-常见问题)
- [💻 开发](#-开发)
- [📤 发布新版](#-发布新版)
- [📄 许可证](#-许可证)

---

## 🚀 项目介绍

**TikTokShop达人抓取** 是专为 **TikTok Shop 卖家（Owner）** 打造的开源桌面应用：

- 抓取 TikTok Shop 联盟达人广场数据（按关键词搜索，或直接导入达人 ID / @账号 / 链接）
- **本地达人库（SQLite）**：抓取的达人自动入库、去重、浏览、排序、筛选，随抓随积累
- **活跃度判断**：自动标记达人 活跃 / 不活跃 / 未知，给出可解释信号（最近发布、增长、GMV 趋势）
- 分析达人带货表现（GMV、销量、互动、粉丝画像、PPS 评分）
- 提取简介、合作邮箱、MCN 机构；使用你授权的团长后台会话，为库内达人补全 WhatsApp、LINE 等平台已提供的联系方式
- 导出 **CSV / Excel**，字段可自定义，表头语言跟随界面一键切换中英文
- 历史输出支持**继续抓取 / 刷新重抓 / 打开 / 删除**，断点续抓，自动去重

> 开源 · GPL-3.0 · Windows 桌面应用 · 支持多账号并发 · 自动更新

## 🎯 适合谁用

- **TikTok Shop 卖家**：找达人带货、筛选合作对象
- **联盟运营 / 商务**：批量整理达人信息、联系洽谈
- **选品团队**：按类目分析达人带货数据

## ✨ 功能特性

| 功能 | 说明 |
|---|---|
| 🎨 工作区 UI | 侧边导航：**概览 / 任务中心 / 达人库 / 导出中心**，中英双语 |
| 💾 本地达人库 | SQLite 存储：自动去重入库，浏览 / 排序 / 筛选 / 刷新 |
| 🔍 达人抓取 | 关键词批量搜索，或导入 ID / @账号 / TikTok 链接直接抓取 |
| 🌍 多站点支持 | 可选美国/英国/东南亚/拉美等 Shop 地区 |
| 📧 联系方式 | 简介、合作邮箱、MCN；可另行授权团长后台，补全 WhatsApp、LINE、Zalo、Viber、Facebook 等已提供字段 |
| 📁 数据导出 | CSV / Excel，字段可自定义，表头语言跟随界面中英切换 |
| 🔁 历史续抓 | 历史输出可一键**继续抓取**（仅新增）或**刷新重抓**（全部覆盖） |
| 🧹 去重与断点 | 按地区和达人 ID 去重，支持暂停、继续和断点恢复 |
| ✅ 筛选与字段 | 支持类目、地区、邮箱、WhatsApp 等条件；字段可选择显示和导出 |
| 🛡️ 安全暂停 | 遇到验证、限流、登录或权限异常时暂停并保留进度 |
| 🌐 中英双语 | 界面、字段列表、表头一键切换中英文 |
| 🔄 自动更新 | 启动时检查新版本，一键更新（差分下载） |

## 📊 可抓取的数据

| 类别 | 字段 |
|---|---|
| 基础信息 | 达人主页、昵称、达人ID、地区、粉丝数 |
| 带货数据 | 总GMV、GMV区间、视频GMV、直播GMV、销量、销量区间、一级类目 |
| 内容表现 | 平均/中位视频观看、视频互动、电商视频互动、电商GPM、直播GPM、电商平均UV |
| 粉丝画像 | 年龄段、性别分布（百分比）、PPS评分、快速增长、已合作、达人类目权限、直播拍卖 |
| 详情（可选） | 简介、合作邮箱（自动提取）、MCN机构、**垂直类目（二级类目）** |
| 团长联系方式补全 | 合作邮箱、WhatsApp、LINE、Zalo、Viber、Facebook、其他联系方式、号码国家码、来源与检查状态/时间 |

字段是否有值取决于平台返回及当前账号权限；未提供的联系方式保持为空，不猜测号码或国家码。当前本地库不保存头像。团长“完整资料 + 联系方式”已完成马来西亚真实跨页小样本验证；这不代表每位达人都会提供每个字段，也不代表其他市场具有相同覆盖率。

## 📦 安装

⬇️ [**下载最新安装包（Windows）**](https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/releases/latest)

- 双击运行安装向导，同意许可协议后安装
- 自动创建桌面快捷方式
- 输出文件默认在安装目录 `output/` 文件夹，日志在 `logs/` 文件夹
- 已安装时自动检测，提示覆盖而非重复安装

> Windows SmartScreen 提示时点"更多信息 → 仍要运行"（开源未签名程序正常提示）。

## 🚀 快速开始

### 第一步：导出 Cookie（必做，约 2 分钟）

工具需要你的 TikTok Shop 联盟**登录 Cookie** 才能查看达人数据。导出步骤：

1. **打开 Chrome 浏览器**（Edge 也可以），访问 TikTok Shop 联盟后台：
   **`https://affiliate.tiktokshopglobalselling.com`**
2. **登录你的卖家账号**，进入**达人广场**页面
3. **安装 Cookie-Editor 扩展**：
   点这里 → [**Cookie-Editor**](https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm)
   → 点"添加至 Chrome"→ 弹窗确认
   > 已安装的跳过这步。（其他同类扩展：EditThisCookie 等也可用）
4. **打开扩展**：点 Chrome 右上角的拼图 🧩 图标（扩展程序）→ 点 **Cookie-Editor**
5. 点扩展面板里的 **Export（导出）** 按钮 —— Cookie 会以 JSON 文本复制到剪贴板
6. **粘贴或保存**：
   - **方式 A（粘贴）**：打开工具，点 Cookie 输入框，按 Ctrl+V 粘贴 —— 完成
   - **方式 B（文件）**：把内容粘贴到记事本，保存为 `cookies.json`，再拖进工具或点"📂 导入文件"

> 💡 **Cookie 是什么？** 它是浏览器的登录凭证。采集时会发送给对应 TikTok 平台进行授权请求，不会作为遥测上传给项目作者。卖家会话会保存在本机设置中；团长补全的导入会话仅保存在本次应用进程内，退出后需重新导入。不要把会话文件或本机数据备份提交到 GitHub。

### 第二步：配置并开始

1. **达人地区**：选择要抓取的 TikTok Shop 站点（如美国 US / 英国 UK / 东南亚等）
2. **抓取对象**：
   - **关键词搜索**：勾选要抓取的达人类目 / 输入关键词，抓达人广场搜索结果
   - **名单导入**：粘贴达人 ID、@账号 或 TikTok 链接（每行一条），只抓名单里的人
3. **抓取模式**：默认**完整模式**（卖家列表 + 详情：简介/邮箱/MCN）；不需要详情可切**快速模式**（仅列表，通常更快，实际速度依平台响应而定）
4. **抓取范围**：
   - **仅新增（默认）**：自动跳过已抓过的达人，只抓新面孔
   - **全部重抓**：重新抓取全部并覆盖，刷新数据
5. **导出设置**：选 CSV 或 Excel、选输出文件夹、勾选要导出的字段（表头语言跟随界面语言）
6. 点 **▶ 开始抓取** —— 下方日志区实时显示进度（可随时暂停 / 继续 / 一键结束，秒级收尾导出；运行中"暂停/结束"按钮为醒目橙红样式）
7. 完成后提示 **🆕 新增 N 位 · 🔄 更新 M 位**（抓取页不再自动导出文件，数据在达人库；需要文件时到达人库/历史输出手动导出）

> 🆕 **第一次用？** 先点 **🔍 测试连接** 验证环境（隔离环境抓 1 页试跑，不占正式流程）。

> 🔁 **想继续上次的抓取？** 在"历史输出"里找到之前的文件，点 **🔼 继续** 只抓新增的达人并写回原文件，或点 **🔄 重抓** 全部重新抓取覆盖。

### 第三步：达人库

- 侧边栏切到 **📚 达人库**：所有抓取过的达人自动存入本地 SQLite 数据库（自动去重）
- 支持按 昵称/粉丝数/GMV/销量/活跃度 等排序；**TikTok 后台式筛选栏**：地区、类目（一级 + 垂直类目两级菜单）、粉丝年龄段/性别、PPS 评分、销量、平均观看、粉丝数、总GMV、活跃状态，多选 + 可移除 chips
- 快捷勾选 **有邮箱 / 有 WhatsApp / 活跃达人**，一键过滤合作对象；显示字段抽屉提供 **全部显示 / 取消全选**（达人主页保留）
- **活跃度**：工具根据最近发布时间、增长趋势、GMV 变化自动判断达人当前是否活跃，帮你在谈合作前快速筛掉"僵尸达人"
- **➕ 继续抓取**：按上次的关键词继续抓新增达人，跳过达人库已有的，结果自动并入
- **更新达人数据**：对当前筛选范围重新抓取并刷新（带进度条 + 预计剩余时间 + 新增/更新统计）
- 达人库数据只存在你本机，不依赖任何外部服务

> 💡 **垂直类目说明**：二级类目（垂直类目）来自达人主页的 vertical_pro_category 标签，只有部分达人返回。想补充它，对达人跑一次"更新达人数据"（完整模式）即可。

### 第四步：补全 WhatsApp、LINE 等联系方式（可选）

从账号区导入卖家或团长会话并选择目标市场。新任务可在采集达人资料的同时读取平台向当前账号提供的联系方式，基本资料先入库；没有联系方式的达人也会保留。

```text
列表发现 → 基本资料入库 → 继续发现 / 读取详情 → 增量更新资料
                    └→ 联系方式队列 → 接口读取 → 合并保存邮箱、WhatsApp、LINE 等
```

- 支持合作邮箱、WhatsApp、LINE、Zalo、Viber、Facebook、其他联系方式及号码国家码；平台未提供的字段保持为空。
- 按达人 ID 查重并逐条入库；可停止并保留进度，重启后在达人库按相同市场与筛选继续。
- 不设软件固定条数上限，但只处理当前账号可见、平台实际返回的范围；限流、验证、登录失效或权限不足时会暂停并保留断点。
- 联系方式读取不发送消息或邀请。账号国家是便于管理的备注，启动任务时仍以目标市场和实际权限检查为准。
- Partner Center 真实浏览器会话默认最小化在后台运行；只有需要重新登录或人工验证时才显示窗口。联系方式通过授权接口读取，不逐个打开聊天页。

详细边界、故障恢复和版本变更见 [v1.5.0 更新说明](docs/release-notes-1.5.0.md)。

## ❓ 常见问题

**Q：提示"页面未正常加载"？**  
A：可能是会话失效、账号权限、网络或平台验证。先在对应后台确认可正常访问，需要时重新导出会话；有效期并非固定 3 天。

**Q：抓取速度慢？**  
A：请求间隔、详情请求数、账号权限和平台响应都会影响速度。完整模式逐个读取详情，通常比仅列表慢；团长联系方式补全默认串行并保留安全间隔，不承诺固定倍数或每小时产量。

**Q：多账号怎么用？**  
A：在 Cookie 区点"＋ 添加账号"，粘贴多个账号 Cookie，工具自动并发抓取（错峰启动）。

**Q：同账号的新 Cookie 会重复添加吗？**  
A：不会。导入与已有账号相同（sessionid / sid_guard 等）的 Cookie 会自动替换旧条目。抓取中确认失效（跳登录页/空白页）的 Cookie，结束后会自动从列表移除；仅按日期显示过期但实际还能用的会保留。

**Q：日志里出现"单条详情超时，跳过"？**  
A：v1.2.10 及之前版本存在误报：详情抓取成功后 90 秒仍会打一条"超时"日志（实际没超时、数据没丢）。v1.2.11 已修复，仅在真正超时时提示（且带达人 ID）。

**Q：中途断了怎么办？**  
A：使用历史继续或达人库的“继续抓取”，默认按地区和达人 ID 跳过已入库记录；刷新旧资料需主动选择更新。团长补全可跳过已检查达人继续未完成部分。会话失效或平台验证可能需要你手动处理，不保证所有中断都能无人值守恢复。

**Q：抓过的达人会重复抓吗？**  
A：默认不会。"仅新增"模式会自动跳过已抓过的达人（按达人 ID 去重）；想刷新数据可切"全部重抓"。

**Q：达人库（v1.2.0）是什么？**  
A：抓取的达人会自动存入本地 SQLite 数据库，自动去重、可排序筛选、标注活跃度。数据只在本机，不用重复抓同一批达人。

**Q：达人"活跃度"怎么判断的？**  
A：工具结合最近发布时间、增长趋势、GMV 变化等信号，把达人分为活跃 / 不活跃 / 未知。主要用于合作前快速筛掉可能已经停更或带货下滑的达人。

**Q：退出时数据会丢吗？**  
A：抓取中点退出会弹窗提示，可选"保存并导出"（结束抓取并导出已抓数据后退出）/"直接退出"/"取消"，不会无声丢数据。

**Q：没有抓到邮箱？**  
A：完整模式会从达人主页简介中自动提取邮箱。如果达人简介里没写邮箱，该格为空属正常。

**Q：粉丝性别分布显示的是人数吗？**  
A：不是，显示的是百分比（如 `Female: 79.47%`）。TikTok 接口返回的是"占比 × 100"的数值，工具已自动还原为百分比。

**Q：MCN 机构为空？**  
A：多数达人没有绑定 MCN，TikTok 返回"无授权"属正常现象，不是抓取失败。

## 💻 开发

开发环境、测试命令、打包要求和双语规范见 [开发文档](docs/development.md)。维护、贡献、安全和测试规范见 [CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md) 与 [测试规范](docs/testing.md)。

## 📤 发布新版

发布流程、增量更新、兼容性检查和 Release 资产要求见[发布清单](docs/release-checklist.md)。

<details><summary>查看完整发布命令</summary>

现有更新链路是：**检查版本 → 用户确认 → 差分下载并重建 → 校验 → 空闲时静默安装 / 退出时安装**。不是让每位旧用户重新下载安装向导。发布方仍须提供完整安装包：更新器从该文件分段下载，也用它做首次安装或差分失败回退。

参见 [1.4.0 依赖与兼容说明](docs/release-readiness-1.4.0.md)及[真实增量验证与回退测试](docs/incremental-update-verification-2026-09-09.md)。以下 **1.5.1 只是下一版示例**，不是已发布版本；发布时统一替换版本号并提前撰写对应的中英 Release notes 文件：

```bash
# 1. bump 版本号（本例 1.5.0 → 1.5.1）
npm version patch --no-git-tag-version

# 2. 打包
npm test
npm audit --audit-level=low
npm run build -- --publish never

# 3. 检查打包代码与运行时；builder 已生成 latest.yml、ASCII 安装包和 blockmap
node scripts/verify-release-package.js dist/win-unpacked
node scripts/verify-electron-startup.js dist/win-unpacked
node scripts/verify-update-artifacts.js dist
# 1.4.0 起不要再运行旧的 prepare-release.js（只适用于旧中文名构建产物）。

# 4. 提交并打 tag
# 先审查并仅暂存源码/文档变更，不暂存 Cookie、数据库或真实测试产物
git commit -m "release 1.5.1"
git push origin main
git tag v1.5.1
git push origin v1.5.1

# 5. 创建草稿 Release 并上传 3 个资产（先传小文件，避免超时）
#    ⚠️ Release notes 固定格式：英文在前（"What's new in vX.Y.Z"），中文在后（"更新内容"）。
#    更新弹窗会展示所有跳过的版本，每个版本都要双语。
gh release create v1.5.1 --draft --title "v1.5.1" --notes-file docs/release-notes-1.5.1.md
gh release upload v1.5.1 dist/latest.yml dist/tiktok-shop-creator-scraper-setup-1.5.1.exe.blockmap
gh release upload v1.5.1 dist/tiktok-shop-creator-scraper-setup-1.5.1.exe
# 核对资产大小、SHA-512 与 latest.yml 后发布草稿
gh release edit v1.5.1 --draft=false --latest

# 6. 公开发布后的差分下载验证（联网，隔离目录，不执行安装）
node scripts/verify-incremental-update.js --live 1.5.0 1.5.1
# 旧用户收到应用内提示 → 确认增量下载 → 静默安装 / 退出时安装
```

> 1.4.0 起上传 3 个更新资产：ASCII 名 exe、对应 .blockmap、latest.yml；不需要重复上传中文名安装包。
> 保留旧 Release 的 **ASCII exe 和 .blockmap**：既用于回退，也供旧版更新器取得基准块表。不要重命名历史资产，不覆盖已发布版本的 exe / blockmap / latest.yml，不移动已发布 tag；代码更新应使用新版本号。仅更新 README / 验证脚本时无需重发同版本安装包。
> `npm test` 包含本地差分/回退回归；`--live` 明确联网下载两个公开版本的必要资产，用独立测试缓存重建，结果保存在忽略提交的 `test-results/incremental-update-*`。不要把安装步骤也算作已测试。

</details>

## 📄 许可证

本项目采用 **GPL-3.0** 许可证，详见 [LICENSE](LICENSE) 文件。

---

*关键词 Keywords：TikTok Shop 达人抓取 TikTok Shop creator scraper、TikTok联盟达人 TikTok affiliate creator、达人数据采集 creator data collection、TikTok 卖家工具 TikTok seller tool、达人导出 CSV Excel creator export、TikTok 网红数据分析 TikTok influencer analytics、达人筛选 creator discovery、MCN 机构查询 MCN lookup、合作邮箱提取 contact email extractor、TikTok Shop 选品 TikTok Shop product research*
