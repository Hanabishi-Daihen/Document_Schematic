const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'RevParser.js'), 'utf8'), ctx);
const { parseFileName_, compareRev_, similarity_ } = ctx;

test('parseFileName_ แยกเลข Rev และชื่อเอกสาร', () => {
  const cases = [
    ['ขั้นตอนการตรวจรับวัตถุดิบ Rev.2.pdf', 'ขั้นตอนการตรวจรับวัตถุดิบ', '2', 'ขั้นตอนการตรวจรับวัตถุดิบ'],
    ['Machine Setup_Rev.1.pdf', 'machine setup', '1', 'Machine Setup'],
    ['QC Checklist (Rev 3).pdf', 'qc checklist', '3', 'QC Checklist'],
    ['แบบฟอร์มขอซื้อ-REV.10.pdf', 'แบบฟอร์มขอซื้อ', '10', 'แบบฟอร์มขอซื้อ'],
    ['ขั้นตอนRev.5.pdf', 'ขั้นตอน', '5', 'ขั้นตอน'],
    ['Drawing [Rev A].pdf', 'drawing', 'A', 'Drawing'],
    ['Spec Revision 4.pdf', 'spec', '4', 'Spec'],
    ['Review Report.pdf', 'review report', null, 'Review Report'],
    ['Revenue Plan Rev.4.pdf', 'revenue plan', '4', 'Revenue Plan'],
    ['คู่มือพนักงานใหม่.pdf', 'คู่มือพนักงานใหม่', null, 'คู่มือพนักงานใหม่'],
    ['Rev.1 Rev.2 Final Rev.3.pdf', 'rev.1 rev.2 final', '3', 'Rev.1 Rev.2 Final'],
  ];
  for (const [name, docKey, rev, title] of cases) {
    const r = parseFileName_(name);
    assert.equal(r.docKey, docKey, name);
    assert.equal(r.rev, rev, name);
    assert.equal(r.title, title, name);
    assert.equal(r.ext, 'pdf', name);
  }
});

test('ไฟล์ Rev ต่างกันได้ docKey เดียวกัน', () => {
  assert.equal(parseFileName_('ABC Rev.1.pdf').docKey, parseFileName_('ABC_Rev.2.pdf').docKey);
  assert.equal(parseFileName_('abc rev1.pdf').docKey, parseFileName_('ABC (Rev 2).PDF').docKey);
});

test('compareRev_', () => {
  assert.ok(compareRev_('2', '1') > 0);
  assert.ok(compareRev_('10', '9') > 0);
  assert.ok(compareRev_('1', '2') < 0);
  assert.equal(compareRev_('2', '2'), 0);
  assert.ok(compareRev_('B', 'A') > 0);
  assert.ok(compareRev_('1', '') > 0); // เพิ่งมีเลข Rev
  assert.equal(compareRev_('', '1'), 0); // ไม่มีเลข Rev → updated
  assert.equal(compareRev_('', ''), 0);
  assert.equal(compareRev_('A', '1'), 0);
});

test('similarity_', () => {
  assert.equal(similarity_('abc', 'abc'), 1);
  assert.ok(similarity_('ขั้นตอนการตรวจรับวัตถุดิบ', 'ขั้นตอนการตรวจรับวัตถุดิบ1') >= 0.9);
  assert.ok(similarity_('qc checklist', 'machine setup') < 0.5);
});
