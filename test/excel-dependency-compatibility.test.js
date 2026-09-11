'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const CfRuleExtXform = require('exceljs/lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform');

test('ExcelJS UUID security override preserves extended formatting and text exports', async () => {
  const rule = { type: 'iconSet', iconSet: '3Stars', priority: 1,
    cfvo: [{ type: 'percent', value: 0 }, { type: 'percent', value: 33 },
      { type: 'percent', value: 67 }] };
  new CfRuleExtXform().prepare(rule);
  assert.match(rule.x14Id, /^\{[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\}$/);
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('兼容テスト');
  sheet.addRow(['7490000000000000123', '00123456789', 25]);
  sheet.addConditionalFormatting({ ref: 'C1', rules: [rule] });
  const bytes = await book.xlsx.writeBuffer();
  const readback = new ExcelJS.Workbook();
  await readback.xlsx.load(bytes);
  const restored = readback.getWorksheet('兼容テスト');
  assert.equal(restored.getCell('A1').value, '7490000000000000123');
  assert.equal(restored.getCell('B1').value, '00123456789');
  assert.equal(restored.conditionalFormattings[0].rules[0].iconSet, '3Stars');
});
