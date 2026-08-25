# Changelog

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
