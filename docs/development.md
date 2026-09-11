# 开发文档

## 环境

- Node.js 22.12+
- 本机 Google Chrome（采集通过 `puppeteer-core` 连接）

## 常用命令

```bash
npm ci
npm start
npm test
npm run build -- --publish never
```

Electron 二进制缺失时运行 `node node_modules/electron/install.js`。

## 打包约定

- 未签名发布使用 `win.signExecutable: false`。
- 安装包图标由 `afterPack.js` 注入；需要时使用 `rebuild-icons.js` 重新生成资源。
- 新增界面文案、按钮、弹窗、提示和字段必须同时加入中英文 `I18N` 字典。
- Release notes 必须英文在前、中文在后。

发布步骤和增量更新规范见 README 的“发布新版”。
