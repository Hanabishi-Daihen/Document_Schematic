/**
 * ค่าคงที่ของระบบ, โครงสร้างตาราง (sheet) และการอ่านค่าตั้งค่า
 *
 * Script Properties ที่ใช้ (Project Settings → Script Properties):
 *   SPREADSHEET_ID     ไม่บังคับถ้า script ผูกกับ Google Sheet (Extensions → Apps Script)
 *   ADMIN_PASSWORD     รหัสผ่านหน้า Admin
 *   TENANT_ID, CLIENT_ID, CLIENT_SECRET   ข้อมูล App ใน Microsoft Entra ID
 *   TEST_SOURCE        (ทดสอบ) ลิงก์ OneDrive สำหรับ testGraphConnection
 *   TEST_PDF_DRIVE_ID  (ทดสอบ) ID ของ PDF ใน Google Drive สำหรับ testOcr
 *   ROOT_FOLDER_ID, VERSIONS_FOLDER_ID, TEXT_FOLDER_ID, INDEX_FOLDER_ID, INDEX_FILE_ID  — setup() สร้างให้เอง
 */

const APP_NAME = 'Document Schematic';
const MAX_RUNTIME_MS = 4.5 * 60 * 1000; // GAS ตัดที่ 6 นาที เผื่อเวลาบันทึกข้อมูล
const MAX_ATTEMPTS = 3;

const SCHEMA = {
  Sources: ['id', 'name', 'input', 'drive_id', 'item_id', 'kind', 'status', 'last_synced_at', 'last_error', 'created_at'],
  Files: ['id', 'source_id', 'document_id', 'drive_id', 'drive_item_id', 'file_name', 'folder_path', 'doc_key', 'parsed_rev',
    'ctag', 'hash', 'web_url', 'modified_at', 'modified_by', 'size_bytes', 'status', 'processed_ctag', 'processed_rev',
    'attempts', 'last_error', 'first_seen_at'],
  Documents: ['id', 'source_id', 'folder_path', 'doc_key', 'title', 'category', 'tags', 'current_rev', 'current_version_id',
    'current_file_id', 'last_revised_at', 'last_updated_at', 'status', 'created_at'],
  Versions: ['id', 'document_id', 'file_id', 'version_no', 'rev_label', 'change_type', 'content_hash', 'file_name',
    'file_modified_at', 'modified_by', 'size_bytes', 'pdf_drive_id', 'text_drive_id', 'text_status', 'note', 'created_at'],
  ReviewQueue: ['id', 'file_id', 'candidate_document_id', 'similarity', 'status', 'created_at'],
  Settings: ['key', 'value', 'description'],
  Logs: ['time', 'level', 'message'],
};

const DEFAULT_SETTINGS = [
  ['badge_days', '14', 'จำนวนวันที่แสดงป้าย New / Revised / Updated'],
  ['file_extensions', 'pdf', 'นามสกุลไฟล์ที่ดึงเข้าระบบ คั่นด้วยจุลภาค เช่น pdf,docx'],
  ['ocr_enabled', 'TRUE', 'แตกข้อความ/OCR จาก PDF ด้วย Google Drive (TRUE/FALSE)'],
  ['sync_interval_minutes', '30', 'รอบการ sync (1, 5, 10, 15 หรือ 30) — รัน setup() ใหม่หลังแก้'],
  ['similarity_threshold', '0.9', 'ชื่อคล้ายกันเกินค่านี้ (0–1) จะส่งให้ Admin ยืนยันการจับคู่'],
  ['max_text_chars', '20000', 'จำนวนตัวอักษรสูงสุดของเนื้อหาต่อเอกสารใน search index'],
];

function props_() {
  return PropertiesService.getScriptProperties();
}

function getSpreadsheet_() {
  const id = props_().getProperty('SPREADSHEET_ID');
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('ไม่พบ Google Sheet: ตั้งค่า Script Property SPREADSHEET_ID หรือสร้าง script จากเมนู Extensions → Apps Script ของ Sheet');
  return ss;
}

let settingsCache_ = null;

function getSettings_() {
  if (settingsCache_) return settingsCache_;
  const raw = {};
  DEFAULT_SETTINGS.forEach(([k, v]) => (raw[k] = v));
  const sheet = getSpreadsheet_().getSheetByName('Settings');
  if (sheet && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues()
      .forEach(([k, v]) => { if (k) raw[String(k).trim()] = String(v).trim(); });
  }
  settingsCache_ = {
    badgeDays: Number(raw.badge_days) || 14,
    fileExtensions: raw.file_extensions.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    ocrEnabled: raw.ocr_enabled.toUpperCase() === 'TRUE',
    syncIntervalMinutes: [1, 5, 10, 15, 30].includes(Number(raw.sync_interval_minutes)) ? Number(raw.sync_interval_minutes) : 30,
    similarityThreshold: Number(raw.similarity_threshold) || 0.9,
    maxTextChars: Number(raw.max_text_chars) || 20000,
  };
  return settingsCache_;
}

function nowIso_() {
  return new Date().toISOString();
}

/** ใช้กับฟังก์ชันที่ตั้งใจให้รันจาก editor เท่านั้น — กันผู้ใช้เว็บ (anonymous) เรียกผ่าน google.script.run */
function requireOwner_() {
  const active = Session.getActiveUser().getEmail();
  if (!active || active !== Session.getEffectiveUser().getEmail()) {
    throw new Error('ฟังก์ชันนี้รันได้จาก Apps Script editor โดยเจ้าของ script เท่านั้น');
  }
}
