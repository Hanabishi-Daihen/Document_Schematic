const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./gas-harness');

function setupWithSource() {
  const g = createGas();
  g.run('setup()');
  g.run(`adminAddSource('pw', 'https://company-my.sharepoint.com/:f:/g/personal/x/abc', 'QA')`);
  return g;
}

const docByTitle = (g, title) => g.run('getBootstrap()').documents.find((d) => d.title === title);

test('setup สร้าง sheet, ค่าตั้งค่า, โฟลเดอร์ และ trigger', () => {
  const g = createGas();
  g.run('setup()');
  assert.deepEqual(g.ss.sheets.map((s) => s.name).sort(),
    ['Documents', 'Files', 'Logs', 'ReviewQueue', 'Settings', 'Sources', 'Versions']);
  assert.equal(g.triggers.length, 1);
  assert.equal(g.triggers[0].m, 30);
  assert.ok(g.props.get('VERSIONS_FOLDER_ID'));
  g.run('setup()'); // รันซ้ำได้
  assert.equal(g.triggers.length, 1);
  assert.equal(g.ss.getSheetByName('Settings').getLastRow(), 7);
});

test('นำเข้าครั้งแรก: Rev.1 กับ Rev.2 เป็นเอกสารเดียวกัน', () => {
  const g = setupWithSource();
  g.onedrive.add({ id: 'a1', name: 'ขั้นตอนการตรวจรับวัตถุดิบ Rev.1.pdf', content: 'เนื้อหา rev1', modified: '2026-05-03T00:00:00Z' });
  g.onedrive.add({ id: 'a2', name: 'ขั้นตอนการตรวจรับวัตถุดิบ Rev.2.pdf', content: 'เนื้อหา rev2 มาตรฐานใหม่', modified: '2026-10-20T00:00:00Z' });
  g.onedrive.add({ id: 'b1', name: 'คู่มือพนักงาน.pdf', content: 'คู่มือ' });
  g.onedrive.add({ id: 'x1', name: 'ไม่ใช่ pdf.docx', content: 'x' });
  g.onedrive.add({ id: 'sub', name: 'Forms', folder: true });
  g.onedrive.add({ id: 'c1', name: 'แบบฟอร์มขอซื้อ_Rev.3.pdf', parent: 'sub', content: 'ฟอร์ม' });

  const r = g.run('syncNow()');
  assert.equal(r.newFiles, 4);
  assert.equal(r.processed, 4);

  const boot = g.run('getBootstrap()');
  assert.equal(boot.documents.length, 3);
  const doc = docByTitle(g, 'ขั้นตอนการตรวจรับวัตถุดิบ');
  assert.equal(doc.rev, '2');
  assert.equal(doc.versions, 2);
  const detail = g.run(`getDocumentDetail('${doc.id}')`);
  assert.deepEqual(detail.versions.map((v) => [v.versionNo, v.rev, v.changeType, v.isCurrent]),
    [[2, '2', 'revised', true], [1, '1', 'initial', false]]);

  const form = docByTitle(g, 'แบบฟอร์มขอซื้อ');
  assert.equal(form.category, 'QA / Forms');
  assert.equal(form.rev, '3');
});

test('แก้เนื้อหาโดยไม่เปลี่ยน Rev → Updated, ดาวน์โหลดเฉพาะไฟล์ที่เปลี่ยน', () => {
  const g = setupWithSource();
  g.onedrive.add({ id: 'a1', name: 'QC Checklist Rev.1.pdf', content: 'v1' });
  g.onedrive.add({ id: 'b1', name: 'Other.pdf', content: 'other' });
  g.run('syncNow()');
  const before = g.onedrive.downloads;

  g.onedrive.edit('a1', 'v1 แก้ไขแล้ว', new Date().toISOString());
  const r = g.run('syncNow()');
  assert.equal(r.changed, 1);
  assert.equal(r.processed, 1);
  assert.equal(g.onedrive.downloads - before, 1);

  const doc = docByTitle(g, 'QC Checklist');
  assert.equal(doc.badge, 'updated');
  assert.equal(doc.rev, '1');
  const detail = g.run(`getDocumentDetail('${doc.id}')`);
  assert.equal(detail.versions[0].changeType, 'updated');

  // รอบถัดไปไม่มีอะไรเปลี่ยน → ไม่ประมวลผลซ้ำ
  const r2 = g.run('syncNow()');
  assert.equal(r2.processed, 0);
});

test('เปลี่ยนชื่อไฟล์เดิมเป็น Rev ใหม่พร้อมแก้เนื้อหา → Revised', () => {
  const g = setupWithSource();
  g.onedrive.add({ id: 'a1', name: 'Machine Setup_Rev.1.pdf', content: 'v1' });
  g.run('syncNow()');
  g.onedrive.rename('a1', 'Machine Setup_Rev.2.pdf');
  g.onedrive.edit('a1', 'v2', new Date().toISOString());
  g.run('syncNow()');
  const doc = docByTitle(g, 'Machine Setup');
  assert.equal(doc.rev, '2');
  assert.equal(doc.badge, 'revised');
  assert.equal(doc.versions, 2);
});

test('เปลี่ยนชื่ออย่างเดียว (เนื้อหาเดิม) → ไม่สร้างเวอร์ชันใหม่ แต่อัปเดตเลข Rev', () => {
  const g = setupWithSource();
  g.onedrive.add({ id: 'a1', name: 'คู่มือ.pdf', content: 'same' });
  g.run('syncNow()');
  g.onedrive.rename('a1', 'คู่มือ Rev.1.pdf');
  g.run('syncNow()');
  const doc = docByTitle(g, 'คู่มือ');
  assert.equal(doc.versions, 1);
  assert.equal(doc.rev, '1');
});

test('ไฟล์ Rev เก่ากว่าที่เพิ่มทีหลัง → เก็บเป็นประวัติ ไม่แทนเวอร์ชันปัจจุบัน', () => {
  const g = setupWithSource();
  g.onedrive.add({ id: 'a2', name: 'Spec Rev.2.pdf', content: 'v2' });
  g.run('syncNow()');
  g.onedrive.add({ id: 'a1', name: 'Spec Rev.1.pdf', content: 'v1' });
  g.run('syncNow()');
  const doc = docByTitle(g, 'Spec');
  assert.equal(doc.rev, '2');
  const detail = g.run(`getDocumentDetail('${doc.id}')`);
  assert.deepEqual(detail.versions.map((v) => v.changeType), ['historical', 'initial']);
});

test('ชื่อคล้ายกัน → รอ Admin ยืนยัน แล้ว merge เป็น Revision', () => {
  const g = setupWithSource();
  g.onedrive.add({ id: 'a1', name: 'ขั้นตอนการตรวจรับวัตถุดิบ Rev.1.pdf', content: 'v1' });
  g.run('syncNow()');
  const docId = docByTitle(g, 'ขั้นตอนการตรวจรับวัตถุดิบ').id;
  g.onedrive.add({ id: 'a2', name: 'ขั้นตอนการตรวจรับวัตถุดิบฯ Rev.2.pdf', content: 'v2', modified: new Date().toISOString() });
  g.run('syncNow()');

  let state = g.run(`adminGetState('pw')`);
  assert.equal(state.review.length, 1);
  assert.equal(g.run('getBootstrap()').documents.length, 1);

  g.run(`adminResolveReview('pw', '${state.review[0].id}', 'merge')`);
  g.run('syncNow()');
  state = g.run(`adminGetState('pw')`);
  assert.equal(state.review.length, 0);
  const docs = g.run('getBootstrap()').documents;
  assert.equal(docs.length, 1);
  assert.equal(docs[0].id, docId);
  assert.equal(docs[0].rev, '2');
  assert.equal(docs[0].badge, 'revised');
  assert.equal(docs[0].title, 'ขั้นตอนการตรวจรับวัตถุดิบฯ'); // ชื่อเอกสารตามไฟล์ล่าสุด
});

test('ไฟล์ถูกลบจาก OneDrive → Missing และกลับมาได้', () => {
  const g = setupWithSource();
  g.onedrive.add({ id: 'a1', name: 'Doc.pdf', content: 'x' });
  g.run('syncNow()');
  const saved = g.onedrive.items.get('a1');
  g.onedrive.remove('a1');
  const r = g.run('syncNow()');
  assert.equal(r.missing, 1);
  assert.equal(docByTitle(g, 'Doc').badge, 'missing');
  g.onedrive.items.set('a1', saved);
  g.run('syncNow()');
  assert.notEqual(docByTitle(g, 'Doc').badge, 'missing');
});

test('search index มีเนื้อหาจาก OCR และ getVersionFile คืนไฟล์เดิม', () => {
  const g = setupWithSource();
  g.onedrive.add({ id: 'a1', name: 'Doc Rev.1.pdf', content: 'วิธีการ ตรวจสอบ  ชิ้นงาน' });
  g.run('syncNow()');
  const b64 = g.run('getContentIndex()');
  const index = JSON.parse(require('node:zlib').gunzipSync(Buffer.from(b64, 'base64')).toString('utf8'));
  const doc = docByTitle(g, 'Doc');
  assert.equal(index.docs[doc.id].c, 'ocr วิธีการ ตรวจสอบ ชิ้นงาน');
  const file = g.run(`getVersionFile('${doc.versionId}')`);
  assert.equal(Buffer.from(file.base64, 'base64').toString('utf8'), 'วิธีการ ตรวจสอบ  ชิ้นงาน');
  assert.equal(file.name, 'Doc Rev.1.pdf');
});

test('ฟังก์ชัน Admin ต้องใช้รหัสผ่าน และ editor-only ต้องเป็นเจ้าของ', () => {
  const g = setupWithSource();
  assert.throws(() => g.run(`adminGetState('wrong')`), /รหัสผ่านไม่ถูกต้อง/);
  g.ctx.Session.getActiveUser = () => ({ getEmail: () => '' });
  assert.throws(() => g.run('setup()'), /เจ้าของ script/);
  assert.throws(() => g.run('runScheduled({triggerUid: "fake"})'), /เจ้าของ script/);
  assert.doesNotThrow(() => g.run(`runScheduled({triggerUid: '${g.triggers[0].getUniqueId()}'})`));
});
