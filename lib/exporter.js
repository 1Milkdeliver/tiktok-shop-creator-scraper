// TikTok Shop Creator Scraper — 专为 TikTok Shop 卖家打造
'use strict';

const fs = require('fs');
const path = require('path');

// default keyword list used when user doesn't provide one
const DEFAULT_KEYWORDS = [
  'beauty','makeup','skincare','cosmetics','haircare','nails','lashes','perfume','spa','tanning',
  'fashion','outfit','clothing','shoes','boots','sneakers','handbag','jewelry','accessories','sunglasses',
  'lingerie','thrift','haul','pet','dog','cat','puppy','kitten','pet supplies','dog mom','cat mom',
  'aquarium','bird','home','kitchen','decor','cleaning','organization','furniture','bedding','garden',
  'diy','renovation','tech','gadget','phone','iphone','tablet','laptop','smart home','camera','gaming',
  'gamer','unboxing','review','mom','baby','kids','parenting','toddler','newborn','fitness','workout',
  'gym','health','wellness','yoga','weight loss','food','cooking','recipe','baking','snacks','coffee',
  'tea','car','auto','truck','motorcycle','sports','outdoor','camping','hiking','fishing','cycling',
  'lifestyle','vlog','travel','book','reading','art','craft','budget','deal','coupon','shopping',
  'target','walmart','amazon','belleza','moda','mascotas','cocina','maquillaje','cuidado','hogar',
  'tecnologia','ropa','skincare routine','self care','grwm','get ready with me','amazon finds',
  'tiktok made me buy','meal prep','cleaning hacks','organization hacks','home finds','clothing haul',
  'makeup tutorial','tech review','gadget review','phone case','cute','aesthetic','viral','fyp',
  'product review'
];

// escape a single CSV cell
function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// Normalize any API field value into a plain displayable string:
//   money { value, symbol, format }        -> "$3.7K"
//   range { minimal, maximum, ...format }  -> "$0.00 - $5.00"
//   auth  { is_authorized, value }         -> value
//   label { name } / { starling_key, name }-> "Pet Supplies"
//   dist  { key, value }                   -> "Female: 6113"
//   arrays                                 -> joined with ", "
//   fallback                               -> JSON (never "[object Object]")
function normalizeValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'object') return v; // string / number / boolean
  if (Array.isArray(v)) {
    return v.map(normalizeValue).filter(x => x !== '' && x !== null && x !== undefined).join(', ');
  }
  // label object with a display name (e.g. category entries)
  if (v.name !== undefined && v.name !== null) return String(v.name);
  // distribution entry e.g. { key: "Female", value: "6113" }
  if (v.key !== undefined && v.key !== null) {
    let val = v.value;
    // TikTok 达人广场的 top_follower_gender 把百分比乘了 100 返回
    // （如 "7947" 实际是 79.47%），直接显示会被误读成绝对人数，
    // 这里还原为百分比。
    if (val !== undefined && val !== null &&
        /^(Female|Male|Other|female|male|other)$/.test(String(v.key)) &&
        /^\d{2,4}$/.test(String(val))) {
      const pct = (Number(val) / 100).toFixed(2).replace(/\.?0+$/, '') + '%';
      return String(v.key) + ': ' + pct;
    }
    return String(v.key) + (val === undefined || val === null ? '' : ': ' + val);
  }
  // money object with pre-formatted string
  if (v.format !== undefined && v.format !== null) return String(v.format);
  // auth object
  if (v.is_authorized !== undefined) {
    return v.value === undefined || v.value === null ? '' : String(v.value);
  }
  // numeric range object
  if (v.minimal !== undefined || v.maximum !== undefined) {
    const sym = v.symbol === undefined || v.symbol === null ? '' : String(v.symbol);
    const loFmt = v.minimal_format !== undefined ? String(v.minimal_format) : '';
    const hiFmt = v.maximum_format !== undefined ? String(v.maximum_format) : '';
    const lo = loFmt || (v.minimal === undefined ? '' : String(v.minimal));
    const hi = hiFmt || (v.maximum === undefined ? '' : String(v.maximum));
    // formats usually already include the symbol (e.g. "$0.00"); avoid "$$"
    const prep = (s) => (sym && !s.startsWith(sym)) ? sym + s : s;
    const loS = prep(lo), hiS = prep(hi);
    if (loS === hiS || !hiS) return loS;
    return loS + ' - ' + hiS;
  }
  // plain value field e.g. { value: "169" }
  if (v.value !== undefined && v.value !== null) return String(v.value);
  // anything else: JSON stringify as a last resort
  try {
    const s = JSON.stringify(v);
    return s && s !== '{}' && s !== '[]' ? s : '';
  } catch (e) { return ''; }
}

function toCsv(rows, headers) {
  const lines = [headers.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push(headers.map(h => csvCell(normalizeValue(r[h]))).join(','));
  }
  return lines.join('\r\n');
}

async function exportCsv(filePath, rows, headers) {
  fs.writeFileSync(filePath, '\uFEFF' + toCsv(rows, headers), 'utf8');
}

// Streaming CSV export: writes batches as they arrive, keeping memory flat
// even for hundreds of thousands of rows.
function createCsvStream(filePath, headers) {
  ensureDir(filePath);
  const stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
  stream.write('\uFEFF' + headers.map(csvCell).join(',') + '\r\n');
  return {
    writeBatch(rows) {
      let buf = '';
      for (const r of rows) {
        buf += headers.map(h => csvCell(normalizeValue(r[h]))).join(',') + '\r\n';
      }
      stream.write(buf);
    },
    end() { stream.end(); },
  };
}

async function exportXlsx(filePath, rows, headers) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('达人数据');
  // header row
  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true, name: 'Arial' };
  // data rows — plain values, no per-row style objects (huge memory savings)
  const font = { name: 'Arial' };
  const pick = headers.map(h => r => { const v = normalizeValue(r[h]); return v === '' ? '' : v; });
  for (const r of rows) {
    const row = ws.addRow(pick.map(fn => fn(r)));
    row.font = font;
  }
  // column widths (shared object, applied once per column)
  headers.forEach((h, i) => { const col = ws.getColumn(i + 1); col.width = 20; });
  await wb.xlsx.writeFile(filePath);
}

// merge list rows with detail rows (detail wins for overlapping keys)
function mergeRows(listRows, detailRows) {
  if (!detailRows || !detailRows.length) return listRows;
  const detailByOid = new Map();
  for (const d of detailRows) detailByOid.set(String(d.creator_oecuid), d);
  return listRows.map(r => {
    const d = detailByOid.get(String(r.creator_oecuid));
    return d ? { ...r, ...d } : r;
  });
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

module.exports = { exportCsv, exportXlsx, createCsvStream, mergeRows, ensureDir, normalizeValue, DEFAULT_KEYWORDS };
