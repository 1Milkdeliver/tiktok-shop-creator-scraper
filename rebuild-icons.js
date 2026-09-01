// rebuild-icons.js — 从用户原图精确重建应用图标（透明背景，等比缩放居中）
'use strict';
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SRC = path.join(__dirname, '_orig_logo.png'); // 从 git 恢复的原始 128x99 图标
const ORIGINAL = 'C:\\Users\\Huawei\\Desktop\\images.png';
const OUT = path.join(__dirname, 'icon-256.png');

function loadPng(p) {
  return PNG.sync.read(fs.readFileSync(p));
}

// 双线性缩放 src -> dst 尺寸，居中绘制到透明画布
function scaleCentered(src, size) {
  const dst = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) dst.data.fill(0, y * dst.width * 4, (y + 1) * dst.width * 4); // 全透明
  const ratio = Math.min(size / src.width, size / src.height);
  const nw = Math.round(src.width * ratio);
  const nh = Math.round(src.height * ratio);
  const ox = Math.round((size - nw) / 2);
  const oy = Math.round((size - nh) / 2);
  const bilinear = (sx, sy) => {
    const x0 = Math.floor(sx), y0 = Math.floor(sy);
    const x1 = Math.min(x0 + 1, src.width - 1), y1 = Math.min(y0 + 1, src.height - 1);
    const fx = sx - x0, fy = sy - y0;
    const i00 = (y0 * src.width + x0) * 4, i10 = (y0 * src.width + x1) * 4;
    const i01 = (y1 * src.width + x0) * 4, i11 = (y1 * src.width + x1) * 4;
    const out = [0, 0, 0, 0];
    for (let c = 0; c < 4; c++) {
      out[c] = Math.round(
        src.data[i00 + c] * (1 - fx) * (1 - fy) +
        src.data[i10 + c] * fx * (1 - fy) +
        src.data[i01 + c] * (1 - fx) * fy +
        src.data[i11 + c] * fx * fy
      );
    }
    return out;
  };
  for (let dy = 0; dy < nh; dy++) {
    for (let dx = 0; dx < nw; dx++) {
      const sx = dx / ratio, sy = dy / ratio;
      const [r, g, b, a] = bilinear(sx, sy);
      const di = ((oy + dy) * size + (ox + dx)) * 4;
      dst.data[di] = r; dst.data[di + 1] = g; dst.data[di + 2] = b; dst.data[di + 3] = a;
    }
  }
  return dst;
}

// 主入口
let srcImg;
const recovered = fs.existsSync(SRC);
if (recovered) {
  srcImg = loadPng(SRC);
  console.log('使用恢复的原始图标:', SRC, srcImg.width + 'x' + srcImg.height);
} else if (fs.existsSync(ORIGINAL)) {
  srcImg = loadPng(ORIGINAL);
  console.log('使用用户桌面原图:', ORIGINAL, srcImg.width + 'x' + srcImg.height);
} else {
  console.error('无可用原图源');
  process.exit(1);
}

const icon256 = scaleCentered(srcImg, 256);
fs.writeFileSync(OUT, PNG.sync.write(icon256));
// logo.png 也更新为同一版本
fs.copyFileSync(OUT, path.join(__dirname, 'logo.png'));
console.log('已生成 icon-256.png + logo.png (256x256, 透明背景, 内容居中)');

// 验证内容边界
{
  const v = loadPng(OUT);
  let minX = 999, maxX = -1, minY = 999, maxY = -1;
  for (let y = 0; y < v.height; y += 4) {
    for (let x = 0; x < v.width; x += 4) {
      const a = v.data[(y * v.width + x) * 4 + 3];
      if (a > 200) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  console.log('内容边界: X ' + minX + '-' + maxX + ', Y ' + minY + '-' + maxY + ' (画布 0-255)');
  const c0 = v.data[3];
  console.log('(0,0) alpha = ' + c0 + ' (0=透明)');
}
