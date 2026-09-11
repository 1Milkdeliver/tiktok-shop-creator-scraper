# 测试规范

## 提交前必测

```bash
npm test
npm audit --audit-level=low
```

打包变更还需运行 `npm run build -- --publish never` 及 README 发布流程中的打包校验脚本。

## 测试边界

- 离线单元测试验证逻辑、数据库读写、断点、查重和导入导出。
- 打包测试验证 Electron 启动、IPC、图标和更新资产。
- 真实平台测试必须单独记录市场、会话状态、验证/限流情况和时间；不得把离线测试当作真实抓取能力证明。
- 真实测试数据放在被 Git 忽略的 `test-results/`，完成后不得提交。
