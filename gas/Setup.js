/**
 * ติดตั้งระบบและฟังก์ชันทดสอบ — เรียกได้จากเมนู "Document Schematic" ใน Google Sheet (Menu.js)
 * หรือจาก Apps Script editor (เลือกชื่อฟังก์ชันแล้วกด Run)
 *   setup()               สร้าง sheet, โฟลเดอร์ใน Drive และ trigger — รันซ้ำได้ ไม่ลบข้อมูลเดิม
 *   testRevParser()       ทดสอบการแยกเลข Rev จากชื่อไฟล์
 *   testOcr(fileId)       ทดสอบแตกข้อความไทยจาก PDF ใน Google Drive
 *   testGraphConnection(link)  ทดสอบเชื่อม OneDrive
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
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#efe9de');
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
  const sharingNote = shareVersionsForPreview_();

  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'runScheduled')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  settingsCache_ = null;
  const minutes = getSettings_().syncIntervalMinutes;
  ScriptApp.newTrigger('runScheduled').timeBased().everyMinutes(minutes).create();

  const missingProps = ['ADMIN_PASSWORD', 'TENANT_ID', 'CLIENT_ID', 'CLIENT_SECRET'].filter((k) => !p.getProperty(k));
  log_('INFO', `setup เสร็จ: sync ทุก ${minutes} นาที, โฟลเดอร์ Drive: ${root.getUrl()}`);
  flushLogs_();

  const lines = [
    '✅ ติดตั้งเสร็จแล้ว',
    `• สร้าง/ตรวจ sheet ${Object.keys(SCHEMA).length} ตาราง`,
    `• โฟลเดอร์เก็บไฟล์: ${root.getUrl()}`,
    `• Sync อัตโนมัติทุก ${minutes} นาที`,
  ];
  if (sharingNote) lines.push(`⚠️ ${sharingNote}`);
  if (missingProps.length) lines.push('', `ขั้นต่อไป: เมนู "2. ตั้งค่า" — ยังไม่ได้ใส่ ${missingProps.join(', ')}`);
  const message = lines.join('\n');
  console.log(message);
  return message;
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

/**
 * หน้าเว็บแสดง PDF ด้วย Google Drive viewer (drive.google.com/file/d/<id>/preview) แทนการโหลด PDF.js จาก CDN
 * จึงต้องเปิดสิทธิ์ "ทุกคนที่มีลิงก์ดูได้" ให้สำเนา PDF — ID ของไฟล์เดาไม่ได้ และหน้าเว็บก็เปิดให้ทุกคนที่มีลิงก์อยู่แล้ว
 */
function shareVersionsForPreview_() {
  try {
    const folder = DriveApp.getFolderById(props_().getProperty('VERSIONS_FOLDER_ID'));
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const files = folder.getFiles();
    while (files.hasNext()) sharePreview_(files.next());
    return '';
  } catch (err) {
    log_('WARN', `เปิดสิทธิ์ดูไฟล์ PDF ไม่ได้: ${err.message}`);
    return `เปิดสิทธิ์ "ทุกคนที่มีลิงก์ดูได้" ให้โฟลเดอร์ versions ไม่ได้ (${err.message}) — ผู้ใช้จะดูตัวอย่าง PDF ไม่ได้ แต่ยังดาวน์โหลดได้`;
  }
}

function sharePreview_(file) {
  if (file.getSharingAccess() !== DriveApp.Access.ANYONE_WITH_LINK) {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }
}

const SAMPLE_FILE_NAMES = [
  'ขั้นตอนการตรวจรับวัตถุดิบ Rev.2.pdf',
  'Machine Setup_Rev.1.pdf',
  'QC Checklist (Rev 3).pdf',
  'แบบฟอร์มขอซื้อ-REV.10.pdf',
  'ขั้นตอนRev.5.pdf',
  'Review Report.pdf',
  'คู่มือพนักงานใหม่.pdf',
];

function testRevParser(names) {
  requireOwner_();
  const message = (Array.isArray(names) && names.length ? names : SAMPLE_FILE_NAMES).map((name) => {
    const p = parseFileName_(name);
    return `${name}\n   → ชื่อเอกสาร "${p.title}" · Rev ${p.rev || '(ไม่มี)'}`;
  }).join('\n');
  console.log(message);
  return message;
}

/** fileId: ID ของ PDF ใน Google Drive (หรือใช้ Script Property TEST_PDF_DRIVE_ID เมื่อรันจาก editor) */
function testOcr(fileId) {
  requireOwner_();
  const id = (typeof fileId === 'string' && fileId) || props_().getProperty('TEST_PDF_DRIVE_ID');
  if (!id) throw new Error('ระบุไฟล์ PDF: ใช้เมนู ทดสอบ → อ่านข้อความจาก PDF หรือตั้ง Script Property TEST_PDF_DRIVE_ID');
  const file = DriveApp.getFileById(id);
  const started = Date.now();
  const text = extractPdfText_(file.getBlob(), 'test');
  const chars = Array.from(text.replace(/\s/g, ''));
  const thai = chars.filter((c) => /[฀-๿]/.test(c)).length;
  const message = [
    `ไฟล์: ${file.getName()} (${(file.getSize() / 1024 / 1024).toFixed(2)} MB)`,
    `ใช้เวลา ${((Date.now() - started) / 1000).toFixed(1)} วินาที · ได้ ${text.length.toLocaleString()} ตัวอักษร (ภาษาไทย ${chars.length ? Math.round(thai / chars.length * 100) : 0}%)`,
    '',
    '— ข้อความช่วงต้น —',
    text.slice(0, 600),
    '',
    '— ข้อความช่วงท้าย (ตรวจว่าตรงกับหน้าสุดท้ายของ PDF หรือไม่) —',
    text.slice(-300),
  ].join('\n');
  console.log(message);
  return message;
}

/** link: ลิงก์โฟลเดอร์ OneDrive (หรือใช้ Script Property TEST_SOURCE เมื่อรันจาก editor) */
function testGraphConnection(link) {
  requireOwner_();
  graphToken_(true);
  const lines = ['✅ ขอ token จาก Microsoft Entra ID สำเร็จ'];
  const input = (typeof link === 'string' && link) || props_().getProperty('TEST_SOURCE');
  if (input) {
    const r = resolveSourceInput_(input);
    lines.push(`✅ เปิดลิงก์ได้: "${r.name}" (${r.kind === 'folder' ? 'โฟลเดอร์' : 'ไฟล์'})`);
    const items = listSourceItems_({ kind: r.kind, drive_id: r.driveId, item_id: r.itemId });
    lines.push(`พบไฟล์ ${items.length} ไฟล์${items.length > 15 ? ' — แสดง 15 ไฟล์แรก' : ''}:`, '');
    items.slice(0, 15).forEach(({ item, relPath }) => {
      const p = parseFileName_(item.name);
      lines.push(`${relPath ? relPath + '/' : ''}${item.name}\n   → "${p.title}" · Rev ${p.rev || '-'}`);
    });
  }
  const message = lines.join('\n');
  console.log(message);
  return message;
}
