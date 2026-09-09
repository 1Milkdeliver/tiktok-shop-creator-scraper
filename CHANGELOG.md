# Changelog

## [Unreleased] - Partner contacts preview

### Added

- Enrich existing library records with available Partner Center WhatsApp, LINE, email, Zalo, Viber, Facebook and other contact fields. Country codes, provenance and collection status are kept separately.
- Shared “Has email” and “Has WhatsApp” filters for library results, exports and enrichment scope; a “Deselect all” field action keeps the Creator Page column visible.
- Serial enrichment with incremental saves, redacted progress logs, resume support and immediate stopping on verification, authentication, quota or rate-limit errors.
- Experimental full-profile enrichment with module-level checkpoints and field-availability status. This remains opt-in and explicitly marked **pending live validation**.
- Offline storage and readback verification for reviewed visible-page observations, preserving reporting periods, original displayed units and separate all-content/product-content metrics.

### Privacy and validation

- Partner credentials stay in main-process memory for the current run and are not added to logs or exports. Local credentials, databases and live-test artifacts are excluded from Git.
- Contact API reads have passed bounded live tests; full-profile API requests still require platform verification. Reading a normal detail page is not proof that automatic full-profile collection works.
- This is a source-code preview, not a new stable installer release. Existing seller discovery remains unchanged.

### 更新内容

- 新增团长后台联系方式补全，分别保存 WhatsApp、LINE、邮箱和其他联系方式、国家码、来源与检查状态。
- 达人库新增“有邮箱 / 有 WhatsApp”筛选和“取消全选”字段操作；列表、导出、补全使用相同筛选范围。
- 逐位或逐模块保存，遇到验证、会话异常或额度限制立即停止；完整资料模式仍为待实测的可选功能。
- 正常网页可见数据支持分口径存储与回读核验，不将页面观察误记为完整自动采集成功。
- 本次仅更新开发分支代码，不替换正式安装包，不上传 Cookie、达人数据或数据库备份。

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
