## What's new in v1.5.3

- Seller Cookie accounts are now encrypted at rest with Windows OS-backed secure storage. Existing local accounts are migrated on startup when secure storage is available; if it is unavailable, the app refuses to save new credentials rather than writing them in plaintext.
- The Creator Library reuses its established `creators.db` path, preserving the local database across upgrades. Do not uninstall the app or delete its application data during the update.
- The update channel, application identity and differential-update asset naming remain unchanged. Seller Cookie accounts persist locally in encrypted form; Partner Center authorization remains session-only and must be imported again after restarting/updating.
- This release does not change scraping limits or claim broader platform access. Platform login checks, verification, rate limits, contact availability and full-profile field coverage still require separate live validation.

### Verification and known limits

- 179 offline product tests pass. The production/runtime dependency audit (`npm audit --omit=dev --audit-level=low`) reports zero known vulnerabilities.
- The full dependency audit still reports advisories in transitive development/build tooling. Non-forced remediation did not clear them; `--force` proposes downgrading `electron-builder`, so it was not applied. See the release-readiness record for exact audit output and scope.
- Windows x64 only. No installation over the running app, long-running platform scrape, contact-field or cross-market live test is claimed by this release.

## 更新内容

- 卖家 Cookie 账号现在使用 Windows 系统安全存储加密后再落盘；安全存储可用时启动会迁移已有本地账号。若安全存储不可用，软件会拒绝保存新凭据，不会退回明文写入。
- 达人库恢复沿用 `creators.db` 路径，升级后可继续读取原有本地数据库。更新时不要卸载软件或删除应用数据目录。
- 保持原有更新通道、应用身份和差分更新资产命名。卖家 Cookie 以加密形式保存在本机；团长后台授权仍只在当前会话有效，软件重启或更新后需要重新导入。
- 本版本没有更改抓取条数限制，也不代表平台访问能力扩大。登录、验证、限流、联系方式可用性和完整资料字段覆盖仍需分别进行真实验证。

### 验证结果与已知限制

- 179 项离线产品测试通过。运行时依赖审计 `npm audit --omit=dev --audit-level=low` 为 0 项已知漏洞。
- 完整依赖审计仍报告传递性开发/打包依赖告警。非强制修复未能清除全部告警；`--force` 会建议降级 `electron-builder`，因此未执行。具体审计结果和范围见发布复核记录。
- 仅验证 Windows x64；本版本没有覆盖正在运行的软件安装、长时间平台抓取、联系方式字段或跨市场真实测试。
