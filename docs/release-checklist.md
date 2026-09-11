# 发布检查清单

- [ ] 更新 `package.json` 和 `package-lock.json` 版本号
- [ ] 更新中英文 README、CHANGELOG 和对应 Release notes
- [ ] `npm test` 通过
- [ ] `npm audit --audit-level=low` 通过或记录例外
- [ ] 构建 Windows 安装包并验证启动、文件和更新资产
- [ ] 检查提交内容不含 Cookie、数据库、日志和真实测试结果
- [ ] 推送 `main` 和版本 tag
- [ ] Release 上传 ASCII 文件名 exe、对应 blockmap、latest.yml
- [ ] 核对 SHA-512、文件大小和增量更新/完整回退
- [ ] 发布说明明确数据保留、Cookie 重新导入要求和已知限制
