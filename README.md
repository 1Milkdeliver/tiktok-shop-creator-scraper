<p align='center'>
<img src='./icon-256.png' width="150" height="150" alt="TikTokShop达人抓取 图标" />
</p>

<h1 align="center">TikTokShop达人抓取</h1>

<p align="center">专为 TikTok Shop 卖家打造的开源桌面工具：一键抓取联盟达人广场数据、分析带货表现、获取达人邮箱与 MCN 信息，导出 CSV / Excel。</p>

<p align="center">
  <a href="https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/stargazers"><img src="https://img.shields.io/github/stars/1Milkdeliver/tiktok-shop-creator-scraper" alt="Stars"/></a>
  <a href="https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/network/members"><img src="https://img.shields.io/github/forks/1Milkdeliver/tiktok-shop-creator-scraper" alt="Forks"/></a>
  <a href="https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/blob/main/LICENSE"><img src="https://img.shields.io/github/license/1Milkdeliver/tiktok-shop-creator-scraper" alt="License"/></a>
  <a href="https://github.com/1Milkdeliver/tiktok-shop-creator-scraper/releases/latest"><img src="https://img.shields.io/github/v/release/1Milkdeliver/tiktok-shop-creator-scraper" alt="最新版本"/></a>
</p>

<div align="center">
  <a href="./README.md">中文</a> / <a href="./README.en.md">English</a>
</div>

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
- 提取达人联系方式（简介、合作邮箱、MCN 机构）
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
| 🎨 三工作区 UI | 侧边导航：**抓取 / 达人库 / 历史输出**，青绿玻璃主题，中英双语 |
| 💾 本地达人库 | SQLite 存储：自动去重入库，浏览 / 排序 / 筛选 / 刷新 |
| 📊 活跃度判断 | 自动标记 活跃/不活跃/未知，附可解释信号（最近发布、增长、GMV 趋势） |
| ⏱️ 更新进度 | 达人库刷新时实时进度条 + 预计剩余时间 |
| 🔍 达人抓取 | 关键词批量搜索，或导入 ID / @账号 / TikTok 链接直接抓取 |
| 🌍 多站点支持 | 可选美国/英国/东南亚/拉美等 Shop 地区 |
| 📧 联系方式 | 简介、合作邮箱（自动提取）、MCN 机构 |
| 📁 数据导出 | CSV / Excel，字段可自定义，表头语言跟随界面中英切换 |
| 🚀 双速模式 | 快速模式（仅列表）与完整模式（列表 + 详情），默认完整模式 |
| 🔁 历史续抓 | 历史输出可一键**继续抓取**（仅新增）或**刷新重抓**（全部覆盖） |
| 🧹 自动去重 | 列表 + 详情双重去重，同一达人不重复入库 |
| 👥 多账号并发 | 关键词分片 / 同关键词分工，多 Cookie 并行加速，实测快 3 倍以上 |
| 🛡️ 风控自愈 | 触发风控自动换备用 Cookie 继续 + 冷却后自动恢复，无需人工值守 |
| 🔄 Cookie 自动替换 | 导入同账号新 Cookie 自动替换旧条目；确认失效的 Cookie 抓取后自动清理 |
| 🗂️ 类目二级筛选 | 达人库类目筛选为 TikTok 后台式两级菜单：一级类目 + 垂直类目 |
| ✅ 快捷筛选 | "仅有邮箱" / "活跃达人" 一键勾选过滤，多字段筛选 + 可移除 chips |
| ⏯️ 三态控制 | 抓取中可随时暂停 / 继续 / 一键结束（秒级收尾并导出） |
| 🛡️ 退出保护 | 抓取中退出会提示：保存并导出 / 直接退出 / 取消 |
| 🌐 中英双语 | 界面、字段列表、表头一键切换中英文 |
| 🔄 自动更新 | 启动时检查新版本，一键更新（差分下载） |
| 💾 数据记忆 | 记住 Cookie、历史输出、断点续抓 |
| 🖥️ 桌面集成 | 桌面快捷方式、自定义图标、自动创建输出/日志目录 |

## 📊 可抓取的数据

| 类别 | 字段 |
|---|---|
| 基础信息 | 达人主页、昵称、达人ID、头像、地区、粉丝数 |
| 带货数据 | 总GMV、GMV区间、视频GMV、直播GMV、销量、销量区间、一级类目 |
| 内容表现 | 平均/中位视频观看、视频互动、电商视频互动、电商GPM、直播GPM、电商平均UV |
| 粉丝画像 | 年龄段、性别分布（百分比）、PPS评分、快速增长、已合作、达人类目权限、直播拍卖 |
| 详情（可选） | 简介、合作邮箱（自动提取）、MCN机构、**垂直类目（二级类目）** |

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

> 💡 **Cookie 是什么？** 它是浏览器在登录后保存的一串"通行证"。工具只用它在你的账号下查看数据，**不会上传或分享**。

### 第二步：配置并开始

1. **达人地区**：选择要抓取的 TikTok Shop 站点（如美国 US / 英国 UK / 东南亚等）
2. **抓取对象**：
   - **关键词搜索**：勾选要抓取的达人类目 / 输入关键词，抓达人广场搜索结果
   - **名单导入**：粘贴达人 ID、@账号 或 TikTok 链接（每行一条），只抓名单里的人
3. **抓取模式**：默认**完整模式**（列表 + 详情：简介/邮箱/MCN，速度较慢）；不需要详情可切**快速模式**（仅列表，快 2-3 倍）
4. **抓取范围**：
   - **仅新增（默认）**：自动跳过已抓过的达人，只抓新面孔
   - **全部重抓**：重新抓取全部并覆盖，刷新数据
5. **导出设置**：选 CSV 或 Excel、选输出文件夹、勾选要导出的字段（表头语言跟随界面语言）
6. 点 **▶ 开始抓取** —— 下方日志区实时显示进度（可随时暂停 / 继续 / 一键结束，秒级收尾导出；运行中"暂停/结束"按钮为醒目橙红样式）
7. 完成后提示 **🆕 新增 N 位 · 🔄 更新 M 位**（抓取页不再自动导出文件，数据在达人库；需要文件时到达人库/历史输出手动导出）

> 🆕 **第一次用？** 先点 **🔍 测试连接** 验证环境（隔离环境抓 1 页试跑，不占正式流程）。

> 🔁 **想继续上次的抓取？** 在"历史输出"里找到之前的文件，点 **🔼 继续** 只抓新增的达人并写回原文件，或点 **🔄 重抓** 全部重新抓取覆盖。

### 第三步：达人库（v1.2.0 新增）

- 侧边栏切到 **📚 达人库**：所有抓取过的达人自动存入本地 SQLite 数据库（自动去重）
- 支持按 昵称/粉丝数/GMV/销量/活跃度 等排序；**TikTok 后台式筛选栏**：地区、类目（一级 + 垂直类目两级菜单）、粉丝年龄段/性别、PPS 评分、销量、平均观看、粉丝数、总GMV、活跃状态，多选 + 可移除 chips
- 快捷勾选 **仅有邮箱** / **活跃达人**，一键过滤合作对象
- **活跃度**：工具根据最近发布时间、增长趋势、GMV 变化自动判断达人当前是否活跃，帮你在谈合作前快速筛掉"僵尸达人"
- **➕ 继续抓取**：按上次的关键词继续抓新增达人，跳过达人库已有的，结果自动并入
- **更新达人数据**：对当前筛选范围重新抓取并刷新（带进度条 + 预计剩余时间 + 新增/更新统计）
- 达人库数据只存在你本机，不依赖任何外部服务

> 💡 **垂直类目说明**：二级类目（垂直类目）来自达人主页的 vertical_pro_category 标签，只有部分达人返回。想补充它，对达人跑一次"更新达人数据"（完整模式）即可。

## ❓ 常见问题

**Q：提示"页面未正常加载"？**  
A：Cookie 可能失效（TikTok 登录态约 3 天有效），重新导出 Cookie 即可。

**Q：抓取速度慢？**  
A：为保证稳定性，请求间隔会随机化（约 6-15 秒）。完整模式（详情）更慢（每个达人单独请求）；不需要邮箱/简介时切"快速模式"会快 2-3 倍。

**Q：多账号怎么用？**  
A：在 Cookie 区点"＋ 添加账号"，粘贴多个账号 Cookie，工具自动并发抓取（错峰启动）。

**Q：同账号的新 Cookie 会重复添加吗？**  
A：不会。导入与已有账号相同（sessionid / sid_guard 等）的 Cookie 会自动替换旧条目。抓取中确认失效（跳登录页/空白页）的 Cookie，结束后会自动从列表移除；仅按日期显示过期但实际还能用的会保留。

**Q：日志里出现"单条详情超时，跳过"？**  
A：v1.2.10 及之前版本存在误报：详情抓取成功后 90 秒仍会打一条"超时"日志（实际没超时、数据没丢）。v1.2.11 已修复，仅在真正超时时提示（且带达人 ID）。

**Q：中途断了怎么办？**  
A：再次启动并开始抓取，会自动从上次位置继续（断点续抓）；触发风控时会自动换备用 Cookie 继续，冷却后自动恢复，无需人工值守。

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

```bash
npm install
npm start          # 运行（开发模式，直接跑源码）
npm run build      # 打包安装程序 → dist/TikTokShop达人抓取安装程序-<版本>.exe
```

> - 需要本机已安装 Google Chrome（工具通过 puppeteer-core 连接）。
> - 打包时设置 `CSC_IDENTITY_AUTO_DISCOVERY=false` 跳过代码签名（Windows 符号链接权限的已知问题）。
> - 安装包图标通过 `afterPack.js` 钩子 + rcedit 注入，`rebuild-icons.js` 可重新生成图标资源。

> 🌐 **双语约定（必须遵守）**：所有新增的界面文案、按钮、弹窗、提示、字段名都必须同时提供中英两个版本（沿用 `I18N` 字典 + `uiLang` 判断的现有机制）。新增功能遗漏英文版视为未完成。发布时 Release notes 同样必须中英双语（英文在前 `What's new in vX.Y.Z`，中文在后 `更新内容`）。

## 📤 发布新版

应用内置自动检查更新（差分下载）。发布新版步骤：

```bash
# 1. bump 版本号（如 1.1.1 → 1.2.0）
npm version patch --no-git-tag-version

# 2. 打包
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
npm run build

# 3. 生成差分更新元数据（latest.yml + ASCII 名资产）
node prepare-release.js 1.2.0

# 4. 提交并打 tag
git add -A && git commit -m "release 1.2.0"
git push origin main
git tag v1.2.0 && git push origin v1.2.0

# 5. 创建 Release 并上传 4 个资产（先传小文件，避免超时）
#    ⚠️ Release notes 固定格式：英文在前（"What's new in vX.Y.Z"），中文在后（"更新内容"）。
#    更新弹窗会展示所有跳过的版本，每个版本都要双语。
gh release create v1.2.0 --title "v1.2.0" --notes "What's new in v1.2.0
- change 1
- change 2

更新内容
- 改动 1
- 改动 2"
gh release upload v1.2.0 dist/latest.yml dist/tiktok-shop-creator-scraper-setup-1.2.0.exe.blockmap
gh release upload v1.2.0 dist/tiktok-shop-creator-scraper-setup-1.2.0.exe
gh release upload v1.2.0 "dist/TikTokShop达人抓取安装程序-1.2.0.exe"

# 6. 旧版用户启动时自动提示更新 → 覆盖安装（数据保留）
```

> 必须上传全部 4 个资产（中文名安装包、ASCII 名 exe、.blockmap、latest.yml），缺一个更新就会失败。
> 版本比较规则：三位版本号，任一更高即提示更新。Release 只留最新版，下载链接自动指向最新。

## 📄 许可证

本项目采用 **GPL-3.0** 许可证，详见 [LICENSE](LICENSE) 文件。

---

*关键词 Keywords：TikTok Shop 达人抓取 TikTok Shop creator scraper、TikTok联盟达人 TikTok affiliate creator、达人数据采集 creator data collection、TikTok 卖家工具 TikTok seller tool、达人导出 CSV Excel creator export、TikTok 网红数据分析 TikTok influencer analytics、达人筛选 creator discovery、MCN 机构查询 MCN lookup、合作邮箱提取 contact email extractor、TikTok Shop 选品 TikTok Shop product research*
