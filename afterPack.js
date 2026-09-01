// afterPack.js — electron-builder afterPack hook: inject custom icon into the packaged exe
// Runs after win-unpacked is created, before NSIS compresses it
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

module.exports = async function (context) {
  const { appOutDir, packager } = context;
  const productName = packager.appInfo.productName;
  const exeName = `${productName}.exe`;
  const exePath = path.join(appOutDir, exeName);
  const icoPath = path.join(packager.projectDir, 'build', 'icon.ico');

  if (!fs.existsSync(exePath) || !fs.existsSync(icoPath)) {
    console.log('[afterPack] exe or ico not found, skip icon injection');
    return;
  }

  // find rcedit in electron-builder cache
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign'),
  ];
  let rcedit = null;
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    for (const sub of fs.readdirSync(dir)) {
      const p = path.join(dir, sub, 'rcedit-x64.exe');
      if (fs.existsSync(p)) { rcedit = p; break; }
    }
    if (rcedit) break;
  }
  // also check node_modules of electron-builder deps
  if (!rcedit) {
    const alt = path.join(packager.projectDir, 'node_modules', 'app-builder-lib');
    // fallback: use 7za to extract rcedit? For now search cache more broadly
    for (const sub of ['349079783', '484181475']) {
      const p = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign', sub, 'rcedit-x64.exe');
      if (fs.existsSync(p)) { rcedit = p; break; }
    }
  }

  if (!rcedit) {
    console.log('[afterPack] rcedit not found, skip icon injection');
    return;
  }

  try {
    execFileSync(rcedit, [exePath, '--set-icon', icoPath], { stdio: 'pipe' });
    console.log('[afterPack] icon injected into', exePath);
  } catch (e) {
    console.log('[afterPack] icon injection failed:', e.message);
  }
};
