/**
 * ฟังก์ชันสำหรับรันจาก Apps Script editor (เลือกชื่อฟังก์ชันแล้วกด Run)
 *   setup()               สร้าง sheet, โฟลเดอร์ใน Drive และ trigger — รันซ้ำได้ ไม่ลบข้อมูลเดิม
 *   testRevParser()       ทดสอบการแยกเลข Rev จากชื่อไฟล์
 *   testOcr()             ทดสอบแตกข้อความไทยจาก PDF (ตั้ง TEST_PDF_DRIVE_ID ก่อน)
 *   testGraphConnection() ทดสอบเชื่อม OneDrive (ตั้ง TENANT_ID, CLIENT_ID, CLIENT_SECRET, TEST_SOURCE ก่อน)
 *   syncNow()             (ใน Sync.js) sync ทันที
 */

function setup() {
  requireOwner_();
  const ss = getSpreadsheet_();
  // บันทึก ID ไว้ให้ web app และ trigger ใช้ ไม่ต้องพึ่ง getActiveSpreadsheet()
  if (!props_().getProperty('SPREADSHEET_ID')) props_().setProperty('SPREADSHEET_ID', ss.getId());

  Object.entries(SCHEMA).forEach(([name, headers]) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    const existing = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String) : [];
    if (existing.filter(Boolean).length && existing.slice(0, headers.length).join() !== headers.join()) {
      throw new Error(`sheet "${name}" มีหัวคอลัมน์ไม่ตรงกับระบบ — เปลี่ยนชื่อ sheet เดิมก่อนแล้วรันใหม่`);
    }
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e8eaed');
    sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@');
    sheet.setFrozenRows(1);
  });

  const settings = ss.getSheetByName('Settings');
  const keys = settings.getLastRow() > 1 ? settings.getRange(2, 1, settings.getLastRow() - 1, 1).getValues().map((r) => String(r[0])) : [];
  const missing = DEFAULT_SETTINGS.filter(([k]) => !keys.includes(k));
  if (missing.length) settings.getRange(settings.getLastRow() + 1, 1, missing.length, 3).setValues(missing);
  settings.setColumnWidth(3, 420);

  // ลบ sheet ว่างเริ่มต้น (Sheet1 / แผ่น1)
  ss.getSheets().forEach((s) => {
    if (!SCHEMA[s.getName()] && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });

  const p = props_();
  const root = ensureFolder_(p.getProperty('ROOT_FOLDER_ID'), null, APP_NAME);
  p.setProperty('ROOT_FOLDER_ID', root.getId());
  ['versions', 'text', 'index'].forEach((name) => {
    const key = `${name.toUpperCase()}_FOLDER_ID`;
    p.setProperty(key, ensureFolder_(p.getProperty(key), root, name).getId());
  });

  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'runScheduled')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  settingsCache_ = null;
  const minutes = getSettings_().syncIntervalMinutes;
  ScriptApp.newTrigger('runScheduled').timeBased().everyMinutes(minutes).create();

  const warnings = [];
  ['ADMIN_PASSWORD', 'TENANT_ID', 'CLIENT_ID', 'CLIENT_SECRET'].forEach((k) => {
    if (!p.getProperty(k)) warnings.push(k);
  });
  log_('INFO', `setup เสร็จ: sync ทุก ${minutes} นาที, โฟลเดอร์ Drive: ${root.getUrl()}`);
  flushLogs_();
  console.log(`✅ setup เสร็จ\nSheet: ${ss.getUrl()}\nโฟลเดอร์ Drive: ${root.getUrl()}\nTrigger: ทุก ${minutes} นาที`);
  if (warnings.length) console.warn(`⚠️ ยังไม่ได้ตั้ง Script Properties: ${warnings.join(', ')}`);
}

function ensureFolder_(id, parent, name) {
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (e) { /* ถูกลบไปแล้ว สร้างใหม่ */ }
  }
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}

function testRevParser() {
  requireOwner_();
  [
    'ขั้นตอนการตรวจรับวัตถุดิบ Rev.2.pdf',
    'Machine Setup_Rev.1.pdf',
    'QC Checklist (Rev 3).pdf',
    'แบบฟอร์มขอซื้อ-REV.10.pdf',
    'ขั้นตอนRev.5.pdf',
    'Review Report.pdf',
    'คู่มือพนักงานใหม่.pdf',
  ].forEach((name) => console.log(`${name}  →  ${JSON.stringify(parseFileName_(name))}`));
}

/** Phase 0: วาง PDF ภาษาไทยไว้ใน Google Drive แล้วใส่ ID ของไฟล์ใน Script Property TEST_PDF_DRIVE_ID */
function testOcr() {
  requireOwner_();
  const id = props_().getProperty('TEST_PDF_DRIVE_ID');
  if (!id) throw new Error('ตั้ง Script Property TEST_PDF_DRIVE_ID เป็น ID ของ PDF ใน Google Drive ก่อน');
  const file = DriveApp.getFileById(id);
  const started = Date.now();
  const text = extractPdfText_(file.getBlob(), 'test');
  const chars = Array.from(text.replace(/\s/g, ''));
  const thai = chars.filter((c) => /[฀-๿]/.test(c)).length;
  console.log(`ไฟล์: ${file.getName()} (${(file.getSize() / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`ใช้เวลา ${((Date.now() - started) / 1000).toFixed(1)} วินาที, ได้ ${text.length} ตัวอักษร (ภาษาไทย ${chars.length ? Math.round(thai / chars.length * 100) : 0}%)`);
  console.log('--- ข้อความ 1,500 ตัวอักษรแรก ---\n' + text.slice(0, 1500));
  console.log('--- ข้อความ 500 ตัวอักษรสุดท้าย (ใช้ตรวจว่าอ่านครบทุกหน้าหรือไม่) ---\n' + text.slice(-500));
}

/** Phase 0: ทดสอบ token + อ่านลิงก์ OneDrive ใน TEST_SOURCE แล้วแสดงไฟล์พร้อมเลข Rev ที่แยกได้ */
function testGraphConnection() {
  requireOwner_();
  graphToken_(true);
  console.log('✅ ขอ token จาก Microsoft Entra ID สำเร็จ');
  const input = props_().getProperty('TEST_SOURCE');
  if (!input) {
    console.log('ตั้ง Script Property TEST_SOURCE เป็นลิงก์โฟลเดอร์ OneDrive เพื่อทดสอบต่อ');
    return;
  }
  const r = resolveSourceInput_(input);
  console.log(`✅ เปิดลิงก์ได้: "${r.name}" (${r.kind}) driveId=${r.driveId}`);
  const items = listSourceItems_({ kind: r.kind, drive_id: r.driveId, item_id: r.itemId });
  console.log(`พบไฟล์ ${items.length} ไฟล์ — แสดง 30 ไฟล์แรก:`);
  items.slice(0, 30).forEach(({ item, relPath }) => {
    const p = parseFileName_(item.name);
    console.log(`${relPath ? relPath + '/' : ''}${item.name}  →  Rev=${p.rev || '-'}  ชื่อเอกสาร="${p.title}"  แก้ไข=${item.fileSystemInfo && item.fileSystemInfo.lastModifiedDateTime}`);
  });
}
