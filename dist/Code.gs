/**
 * Document Schematic — ไฟล์นี้สร้างจาก gas/*.js ด้วย `npm run build` ห้ามแก้ไขโดยตรง
 */

// ==================== Config.js ====================

/**
 * ค่าคงที่ของระบบ, โครงสร้างตาราง (sheet) และการอ่านค่าตั้งค่า
 *
 * Script Properties ที่ใช้ (ตั้งผ่านเมนู "Document Schematic → ตั้งค่า" ใน Google Sheet):
 *   ADMIN_PASSWORD     รหัสผ่านหน้า Admin
 *   TENANT_ID, CLIENT_ID, CLIENT_SECRET   ข้อมูล App ใน Microsoft Entra ID
 *   SPREADSHEET_ID     setup() ตั้งให้เอง
 *   TEST_SOURCE, TEST_PDF_DRIVE_ID  (ไม่บังคับ) ค่าทดสอบเมื่อรันจาก editor
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

// ==================== Repo.js ====================

/**
 * ห่อการอ่าน/เขียน Google Sheets: โหลดทั้งตารางครั้งเดียว แก้ใน memory แล้วเขียนกลับเป็นก้อน
 * ทุก cell เก็บเป็นข้อความ (number format '@') เพื่อไม่ให้ Sheets แปลงวันที่/ตัวเลขเอง
 */

class Table {
  constructor(ss, name) {
    this.name = name;
    this.sheet = ss.getSheetByName(name);
    if (!this.sheet) throw new Error(`ไม่พบ sheet "${name}" — รัน setup() ก่อน`);
    this.headers = SCHEMA[name];
    const lastRow = this.sheet.getLastRow();
    const values = lastRow > 1 ? this.sheet.getRange(2, 1, lastRow - 1, this.headers.length).getValues() : [];
    this.rows = values
      .filter((r) => r.some((c) => c !== ''))
      .map((r) => {
        const o = {};
        this.headers.forEach((h, i) => (o[h] = cellToString_(r[i])));
        return o;
      });
    this.dirty = false;
    this.index_ = null;
  }

  get(id) {
    if (!this.index_) this.index_ = new Map(this.rows.map((r) => [r.id, r]));
    return this.index_.get(id) || null;
  }

  find(fn) {
    return this.rows.find(fn) || null;
  }

  filter(fn) {
    return this.rows.filter(fn);
  }

  insert(obj) {
    const row = {};
    this.headers.forEach((h) => (row[h] = obj[h] === undefined || obj[h] === null ? '' : String(obj[h])));
    if (!row.id && this.headers.includes('id')) row.id = Utilities.getUuid();
    this.rows.push(row);
    if (this.index_ && row.id) this.index_.set(row.id, row);
    this.dirty = true;
    return row;
  }

  update(row, patch) {
    Object.keys(patch).forEach((k) => {
      if (!this.headers.includes(k)) throw new Error(`${this.name}: ไม่มีคอลัมน์ ${k}`);
      row[k] = patch[k] === undefined || patch[k] === null ? '' : String(patch[k]);
    });
    this.dirty = true;
    return row;
  }

  save() {
    if (!this.dirty) return;
    const n = this.headers.length;
    const data = this.rows.map((r) => this.headers.map((h) => r[h]));
    const needed = data.length + 1;
    if (needed > this.sheet.getMaxRows()) this.sheet.insertRowsAfter(this.sheet.getMaxRows(), needed - this.sheet.getMaxRows());
    if (data.length) {
      const range = this.sheet.getRange(2, 1, data.length, n);
      range.setNumberFormat('@');
      range.setValues(data);
    }
    const lastRow = this.sheet.getLastRow();
    if (lastRow > needed) this.sheet.getRange(needed + 1, 1, lastRow - needed, n).clearContent();
    this.dirty = false;
  }
}

function cellToString_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** โหลดตารางที่ระบุ (ค่าเริ่มต้นคือทุกตารางหลัก) */
function openDb_(names) {
  const ss = getSpreadsheet_();
  const db = { ss };
  (names || ['Sources', 'Files', 'Documents', 'Versions', 'ReviewQueue']).forEach((n) => (db[n] = new Table(ss, n)));
  db.saveAll = () => Object.keys(db).forEach((k) => db[k] instanceof Table && db[k].save());
  return db;
}

// ---------- Logs ----------

const logBuffer_ = [];

function log_(level, message) {
  console.log(`[${level}] ${message}`);
  logBuffer_.push([nowIso_(), level, String(message).slice(0, 2000)]);
}

function flushLogs_() {
  if (!logBuffer_.length) return;
  const sheet = getSpreadsheet_().getSheetByName('Logs');
  if (!sheet) return;
  const rows = logBuffer_.splice(0);
  const range = sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 3);
  range.setNumberFormat('@');
  range.setValues(rows);
  const excess = sheet.getLastRow() - 1 - 2000; // เก็บแค่ 2,000 บรรทัดล่าสุด
  if (excess > 0) sheet.deleteRows(2, excess);
}

// ==================== RevParser.js ====================

/**
 * แยกเลข Rev ออกจากชื่อไฟล์ และฟังก์ชันช่วยจับคู่เอกสาร
 * ไฟล์นี้ไม่เรียก API ของ GAS เลย จึงทดสอบด้วย Node ได้ (tests/revParser.test.js)
 */

// จับ "Rev.2", "_Rev.1", "(Rev 3)", "-REV.10", "Revision 4", "Rev.A" — ไม่จับ "Review", "Revenue"
const REV_PATTERN =
  /[\s_\-.([]*(?<![A-Za-z])rev(?:ision)?\s*\.?\s*[-_:]?\s*(\d+|[A-Z])(?![A-Za-z0-9])[)\]]?/gi;

/**
 * @return {{docKey: string, rev: string|null, title: string, ext: string}}
 *   docKey ใช้จับคู่เอกสาร (ตัวเล็ก, ช่องว่างเดียว), title ใช้แสดงผล (คงตัวพิมพ์เดิม)
 */
function parseFileName_(fileName) {
  const extMatch = fileName.match(/\.([A-Za-z0-9]{2,5})$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : '';
  const stem = extMatch ? fileName.slice(0, -extMatch[0].length) : fileName;
  const matches = [...stem.matchAll(REV_PATTERN)];
  const m = matches[matches.length - 1]; // ถ้ามีหลายที่ ใช้ตัวสุดท้าย
  const base = m ? stem.slice(0, m.index) + stem.slice(m.index + m[0].length) : stem;
  const title = base.replace(/_+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s\-.]+|[\s\-.]+$/g, '') || stem;
  return {
    docKey: base.normalize('NFC').replace(/[\s_\-]+/g, ' ').trim().toLowerCase(),
    rev: m ? m[1].toUpperCase() : null,
    title,
    ext,
  };
}

/** เปรียบเทียบเลข Rev: >0 ถ้า a ใหม่กว่า b, 0 ถ้าเท่ากัน/เทียบไม่ได้, <0 ถ้าเก่ากว่า */
function compareRev_(a, b) {
  a = a || '';
  b = b || '';
  if (a === b) return 0;
  if (a && !b) return 1; // เพิ่งมีเลข Rev → นับเป็น Revised
  if (!a && b) return 0; // ไฟล์ไม่มีเลข Rev → นับเป็น Updated
  const na = /^\d+$/.test(a);
  const nb = /^\d+$/.test(b);
  if (na && nb) return Number(a) - Number(b);
  if (!na && !nb) return a < b ? -1 : 1;
  return 0; // ตัวเลขกับตัวอักษร เทียบลำดับไม่ได้
}

/** ความคล้ายของข้อความ 0–1 (Levenshtein) */
function similarity_(a, b) {
  const s = Array.from(a);
  const t = Array.from(b);
  if (!s.length && !t.length) return 1;
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[t.length] / Math.max(s.length, t.length);
}

/** normalize ข้อความก่อนค้นหา — ต้องตรงกับ normalize() ฝั่ง browser (ui/App.js.html) */
function normalizeForSearch_(text) {
  return String(text || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ==================== Graph.js ====================

/**
 * เชื่อมต่อ Microsoft Graph API (OneDrive องค์กร) ด้วย client credentials
 */

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const ITEM_SELECT = 'id,name,cTag,file,folder,fileSystemInfo,lastModifiedBy,webUrl,size,parentReference';

function graphToken_(forceRefresh) {
  const cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    const cached = cache.get('graph_token');
    if (cached) return cached;
  }
  const p = props_();
  const tenant = p.getProperty('TENANT_ID');
  const clientId = p.getProperty('CLIENT_ID');
  const secret = p.getProperty('CLIENT_SECRET');
  if (!tenant || !clientId || !secret) {
    throw new Error('ยังไม่ได้ตั้งค่า TENANT_ID / CLIENT_ID / CLIENT_SECRET ใน Script Properties');
  }
  const res = UrlFetchApp.fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'post',
    payload: {
      client_id: clientId,
      client_secret: secret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    },
    muteHttpExceptions: true,
  });
  const body = JSON.parse(res.getContentText());
  if (res.getResponseCode() !== 200) {
    throw new Error(`ขอ token ไม่สำเร็จ: ${body.error || res.getResponseCode()} — ${body.error_description || ''}`);
  }
  cache.put('graph_token', body.access_token, Math.max(60, Math.min(body.expires_in - 300, 21600)));
  return body.access_token;
}

/** เรียก Graph พร้อม retry เมื่อโดน throttle (429) หรือ server error */
function graphFetch_(pathOrUrl, options) {
  const url = /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : GRAPH_BASE + pathOrUrl;
  let refreshed = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = UrlFetchApp.fetch(url, Object.assign({
      method: 'get',
      headers: { Authorization: 'Bearer ' + graphToken_(refreshed) },
      muteHttpExceptions: true,
    }, options || {}));
    const code = res.getResponseCode();
    if (code === 401 && !refreshed) {
      refreshed = true;
      continue;
    }
    if (code === 429 || code >= 500) {
      const retryAfter = Number(res.getHeaders()['Retry-After']) || Math.pow(2, attempt);
      Utilities.sleep(Math.min(retryAfter, 30) * 1000);
      continue;
    }
    if (code >= 400) {
      let msg = res.getContentText();
      try { msg = JSON.parse(msg).error.message; } catch (e) { /* ใช้ข้อความดิบ */ }
      throw new Error(`Graph ${code}: ${String(msg).slice(0, 300)}`);
    }
    return res;
  }
  throw new Error(`Graph: ลองใหม่หลายครั้งแล้วไม่สำเร็จ (${url})`);
}

function graphJson_(pathOrUrl) {
  return JSON.parse(graphFetch_(pathOrUrl).getContentText());
}

/**
 * แปลงสิ่งที่ Admin ใส่ให้เป็น driveItem รองรับ 2 แบบ
 *   1) ลิงก์แชร์ OneDrive/SharePoint  https://xxx-my.sharepoint.com/:f:/g/personal/...
 *   2) "อีเมลเจ้าของ:/path/โฟลเดอร์"  เช่น somchai@company.com:/Documents/QA  (ใช้เมื่อ /shares ใช้ไม่ได้)
 */
function resolveSourceInput_(input) {
  input = String(input || '').trim();
  let item;
  if (/^https?:\/\//i.test(input)) {
    const encoded = 'u!' + Utilities.base64EncodeWebSafe(input, Utilities.Charset.UTF_8).replace(/=+$/, '');
    item = graphJson_(`/shares/${encoded}/driveItem?$select=${ITEM_SELECT}`);
  } else {
    const m = input.match(/^([^\s:/]+@[^\s:/]+):(.*)$/);
    if (!m) throw new Error('รูปแบบไม่ถูกต้อง: ใส่ลิงก์ OneDrive หรือ อีเมล:/path/โฟลเดอร์');
    const path = m[2].replace(/^\/+|\/+$/g, '');
    const upn = encodeURIComponent(m[1]);
    item = graphJson_(path
      ? `/users/${upn}/drive/root:/${path.split('/').map(encodeURIComponent).join('/')}?$select=${ITEM_SELECT}`
      : `/users/${upn}/drive/root?$select=${ITEM_SELECT}`);
  }
  return {
    driveId: item.parentReference && item.parentReference.driveId,
    itemId: item.id,
    name: item.name,
    kind: item.folder ? 'folder' : 'file',
  };
}

/** รายการไฟล์ทั้งหมดใต้ source (ไล่โฟลเดอร์ย่อย) → [{item, relPath}] */
function listSourceItems_(source) {
  if (source.kind === 'file') {
    return [{ item: graphJson_(`/drives/${source.drive_id}/items/${source.item_id}?$select=${ITEM_SELECT}`), relPath: '' }];
  }
  const out = [];
  const queue = [{ id: source.item_id, rel: '' }];
  let folders = 0;
  while (queue.length) {
    const { id, rel } = queue.shift();
    if (++folders > 2000) throw new Error('โฟลเดอร์ย่อยมากเกิน 2,000 โฟลเดอร์');
    let url = `/drives/${source.drive_id}/items/${id}/children?$select=${ITEM_SELECT}&$top=200`;
    while (url) {
      const page = graphJson_(url);
      page.value.forEach((child) => {
        if (child.folder) queue.push({ id: child.id, rel: rel ? `${rel}/${child.name}` : child.name });
        else if (child.file) out.push({ item: child, relPath: rel });
      });
      url = page['@odata.nextLink'] || null;
    }
  }
  return out;
}

function getItem_(driveId, itemId) {
  return graphJson_(`/drives/${driveId}/items/${itemId}?$select=${ITEM_SELECT}`);
}

/** ดาวน์โหลดไฟล์: Graph ตอบ 302 ไปยัง URL ที่ยืนยันตัวตนแล้ว จึงตามไปโดยไม่ส่ง token ต่อ */
function downloadItem_(driveId, itemId) {
  const res = graphFetch_(`/drives/${driveId}/items/${itemId}/content`, { followRedirects: false });
  if (res.getResponseCode() === 302) {
    const location = res.getHeaders().Location || res.getHeaders().location;
    return UrlFetchApp.fetch(location).getBlob();
  }
  return res.getBlob();
}

// ==================== Sync.js ====================

/**
 * งานตามรอบ: sync รายการไฟล์จาก OneDrive → ประมวลผลไฟล์ที่เปลี่ยน → อัปเดต search index
 */

/** Handler ของ time-driven trigger (ติดตั้งโดย setup()) */
function runScheduled(e) {
  const isTrigger = e && e.triggerUid &&
    ScriptApp.getProjectTriggers().some((t) => t.getUniqueId() === e.triggerUid);
  if (!isTrigger) requireOwner_();
  runJob_();
}

/** รันจาก editor เพื่อ sync ทันที */
function syncNow() {
  requireOwner_();
  return runJob_();
}

function runJob_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    log_('INFO', 'ข้ามรอบนี้: มีงาน sync อื่นกำลังทำงานอยู่');
    flushLogs_();
    return { skipped: true };
  }
  const started = Date.now();
  const summary = { sources: 0, newFiles: 0, changed: 0, missing: 0, processed: 0, failed: 0, remaining: 0 };
  try {
    const db = openDb_();
    db.Sources.filter((s) => s.status !== 'disabled').forEach((source) => {
      summary.sources++;
      try {
        Object.entries(syncSource_(db, source)).forEach(([k, v]) => (summary[k] += v));
        db.Sources.update(source, { status: 'ok', last_synced_at: nowIso_(), last_error: '' });
      } catch (err) {
        db.Sources.update(source, { status: 'error', last_error: err.message });
        log_('ERROR', `sync "${source.name}": ${err.message}`);
      }
    });
    db.saveAll(); // บันทึกผล sync ก่อน เผื่องานประมวลผลหมดเวลา

    const result = processPending_(db, started);
    summary.processed = result.processed;
    summary.failed = result.failed;
    summary.remaining = result.remaining;
    db.saveAll();

    if (result.processed || summary.missing || !props_().getProperty('INDEX_FILE_ID')) rebuildSearchIndex_(db);
    log_('INFO', `sync เสร็จ ${JSON.stringify(summary)} ใช้เวลา ${Math.round((Date.now() - started) / 1000)} วินาที`);
    return summary;
  } catch (err) {
    log_('ERROR', `runJob: ${err.stack || err.message}`);
    throw err;
  } finally {
    flushLogs_();
    lock.releaseLock();
  }
}

function syncSource_(db, source) {
  const settings = getSettings_();
  const stats = { newFiles: 0, changed: 0, missing: 0 };
  const items = listSourceItems_(source);
  const known = new Map(db.Files.filter((f) => f.source_id === source.id).map((f) => [f.drive_item_id, f]));
  const seen = new Set();

  items.forEach(({ item, relPath }) => {
    const parsed = parseFileName_(item.name);
    if (!settings.fileExtensions.includes(parsed.ext)) return;
    seen.add(item.id);
    const meta = {
      file_name: item.name,
      folder_path: relPath,
      doc_key: parsed.docKey,
      parsed_rev: parsed.rev || '',
      ctag: item.cTag || '',
      hash: (item.file && item.file.hashes && item.file.hashes.quickXorHash) || '',
      web_url: item.webUrl || '',
      modified_at: (item.fileSystemInfo && item.fileSystemInfo.lastModifiedDateTime) || '',
      modified_by: (item.lastModifiedBy && item.lastModifiedBy.user && item.lastModifiedBy.user.displayName) || '',
      size_bytes: item.size || '',
    };

    let file = known.get(item.id);
    if (!file) {
      file = db.Files.insert(Object.assign({
        source_id: source.id,
        drive_id: source.drive_id,
        drive_item_id: item.id,
        attempts: 0,
        first_seen_at: nowIso_(),
      }, meta));
      assignDocument_(db, source, file, parsed);
      stats.newFiles++;
      return;
    }
    if (file.ctag !== meta.ctag || file.parsed_rev !== meta.parsed_rev) stats.changed++;
    if (file.status === 'missing') {
      meta.status = file.document_id ? 'active' : 'pending_review';
      const doc = db.Documents.get(file.document_id);
      if (doc && doc.status === 'missing') db.Documents.update(doc, { status: 'active' });
    }
    db.Files.update(file, meta);
  });

  known.forEach((file, itemId) => {
    if (seen.has(itemId) || file.status === 'missing') return;
    db.Files.update(file, { status: 'missing' });
    stats.missing++;
    const doc = db.Documents.get(file.document_id);
    if (doc && doc.current_file_id === file.id) db.Documents.update(doc, { status: 'missing' });
    log_('WARN', `ไฟล์หายจาก OneDrive: ${file.file_name}`);
  });
  return stats;
}

/** จับคู่ไฟล์ใหม่เข้ากับเอกสาร: ชื่อ (ไม่รวม Rev) ตรงกันในโฟลเดอร์เดียวกัน → เอกสารเดิม */
function assignDocument_(db, source, file, parsed) {
  const sameFolder = db.Documents.filter((d) => d.source_id === source.id && d.folder_path === file.folder_path);
  const exact = sameFolder.find((d) => d.doc_key === file.doc_key);
  if (exact) {
    db.Files.update(file, { document_id: exact.id, status: 'active' });
    return;
  }
  let best = null;
  let bestScore = 0;
  sameFolder.forEach((d) => {
    const s = similarity_(d.doc_key, file.doc_key);
    if (s > bestScore) { best = d; bestScore = s; }
  });
  if (best && bestScore >= getSettings_().similarityThreshold) {
    db.Files.update(file, { status: 'pending_review' });
    db.ReviewQueue.insert({
      file_id: file.id,
      candidate_document_id: best.id,
      similarity: bestScore.toFixed(2),
      status: 'open',
      created_at: nowIso_(),
    });
    log_('INFO', `รอ Admin ยืนยัน: "${file.file_name}" คล้าย "${best.title}" (${Math.round(bestScore * 100)}%)`);
    return;
  }
  const doc = createDocumentForFile_(db, source, file, parsed);
  db.Files.update(file, { document_id: doc.id, status: 'active' });
}

function createDocumentForFile_(db, source, file, parsed) {
  return db.Documents.insert({
    source_id: source.id,
    folder_path: file.folder_path,
    doc_key: file.doc_key,
    title: parsed.title,
    category: file.folder_path ? `${source.name} / ${file.folder_path}` : source.name,
    tags: '',
    status: 'active',
    created_at: nowIso_(),
  });
}

// ==================== Processor.js ====================

/**
 * ประมวลผลไฟล์ที่ใหม่/เปลี่ยน: ดาวน์โหลด → เก็บสำเนาใน Drive → แตกข้อความ → สร้าง Version
 */

function processPending_(db, started) {
  const pending = db.Files.filter((f) =>
    f.status === 'active' &&
    f.document_id &&
    Number(f.attempts || 0) < MAX_ATTEMPTS &&
    (f.processed_ctag !== f.ctag || f.processed_rev !== f.parsed_rev));

  // ไฟล์ของเอกสารเดียวกันให้ทำจาก Rev น้อยไปมาก แล้วตามวันที่ → Rev.1 เป็น v1, Rev.2 เป็น v2
  pending.sort((a, b) =>
    a.document_id.localeCompare(b.document_id) ||
    compareRev_(a.parsed_rev, b.parsed_rev) ||
    a.modified_at.localeCompare(b.modified_at));

  let processed = 0;
  let failed = 0;
  for (const file of pending) {
    if (Date.now() - started > MAX_RUNTIME_MS) break;
    try {
      processFile_(db, file);
      processed++;
    } catch (err) {
      failed++;
      db.Files.update(file, { attempts: Number(file.attempts || 0) + 1, last_error: err.message });
      log_('ERROR', `ประมวลผล "${file.file_name}" ไม่สำเร็จ: ${err.message}`);
    }
  }
  return { processed, failed, remaining: pending.length - processed - failed };
}

function processFile_(db, file) {
  const doc = db.Documents.get(file.document_id);
  if (!doc) throw new Error('ไม่พบเอกสารที่ผูกไว้');
  const item = getItem_(file.drive_id, file.drive_item_id);
  const hash = (item.file && item.file.hashes && item.file.hashes.quickXorHash) || '';
  const fileDate = (item.fileSystemInfo && item.fileSystemInfo.lastModifiedDateTime) || item.lastModifiedDateTime || nowIso_();
  const docVersions = db.Versions.filter((v) => v.document_id === doc.id);

  // เนื้อหาเหมือนเวอร์ชันที่มีอยู่แล้ว (เช่น เปลี่ยนชื่อไฟล์อย่างเดียว) → ไม่สร้างเวอร์ชันใหม่
  const duplicate = hash && docVersions.find((v) => v.content_hash === hash);
  if (duplicate) {
    if (doc.current_file_id === file.id && file.parsed_rev !== doc.current_rev) {
      db.Documents.update(doc, { current_rev: file.parsed_rev });
    }
    markProcessed_(db, file, item);
    return;
  }

  const current = db.Versions.get(doc.current_version_id);
  let changeType = 'initial';
  if (current) {
    const cmp = compareRev_(file.parsed_rev, current.rev_label);
    changeType = cmp > 0 ? 'revised' : cmp < 0 ? 'historical' : 'updated';
  }

  const versionId = Utilities.getUuid();
  const parsed = parseFileName_(item.name);
  const blob = downloadItem_(file.drive_id, file.drive_item_id);
  blob.setName(`${versionId}.${parsed.ext || 'bin'}`);
  const stored = DriveApp.getFolderById(props_().getProperty('VERSIONS_FOLDER_ID')).createFile(blob);
  try {
    sharePreview_(stored); // ให้ Google Drive viewer ในหน้าเว็บเปิดได้ (ดู Setup.js)
  } catch (err) {
    log_('WARN', `เปิดสิทธิ์ดูไฟล์ "${item.name}" ไม่ได้: ${err.message}`);
  }

  let textDriveId = '';
  let textStatus = 'skipped';
  if (getSettings_().ocrEnabled && parsed.ext === 'pdf') {
    try {
      const text = extractPdfText_(blob, versionId);
      textDriveId = DriveApp.getFolderById(props_().getProperty('TEXT_FOLDER_ID'))
        .createFile(`${versionId}.txt`, text, MimeType.PLAIN_TEXT).getId();
      textStatus = text.trim() ? 'ok' : 'empty';
    } catch (err) {
      textStatus = 'failed: ' + err.message.slice(0, 200);
      log_('WARN', `แตกข้อความ "${item.name}" ไม่สำเร็จ: ${err.message}`);
    }
  }

  const version = db.Versions.insert({
    id: versionId,
    document_id: doc.id,
    file_id: file.id,
    version_no: docVersions.reduce((max, v) => Math.max(max, Number(v.version_no)), 0) + 1,
    rev_label: file.parsed_rev,
    change_type: changeType,
    content_hash: hash,
    file_name: item.name,
    file_modified_at: fileDate,
    modified_by: (item.lastModifiedBy && item.lastModifiedBy.user && item.lastModifiedBy.user.displayName) || '',
    size_bytes: item.size || '',
    pdf_drive_id: stored.getId(),
    text_drive_id: textDriveId,
    text_status: textStatus,
    created_at: nowIso_(),
  });

  if (changeType !== 'historical') {
    const patch = {
      current_version_id: version.id,
      current_file_id: file.id,
      current_rev: file.parsed_rev,
      title: parsed.title,
      last_updated_at: fileDate,
      status: 'active',
    };
    if (changeType === 'revised' || changeType === 'initial') patch.last_revised_at = fileDate;
    db.Documents.update(doc, patch);
  }
  markProcessed_(db, file, item);
  log_('INFO', `${changeType.toUpperCase()}: "${item.name}" → ${doc.title} v${version.version_no}`);
}

function markProcessed_(db, file, item) {
  db.Files.update(file, {
    ctag: item.cTag || file.ctag,
    processed_ctag: item.cTag || file.ctag,
    processed_rev: file.parsed_rev,
    attempts: 0,
    last_error: '',
  });
}

/**
 * แปลง PDF เป็น Google Docs พร้อม OCR ภาษาไทย แล้วอ่านข้อความ (ต้องเปิด Advanced Service: Drive API v3)
 * ข้อจำกัดของ Google: OCR อาจอ่านเฉพาะ ~10 หน้าแรก และไฟล์ไม่ควรเกิน ~2 MB — ทดสอบด้วย testOcr()
 */
function extractPdfText_(pdfBlob, name) {
  const doc = Drive.Files.create(
    { name: `_ocr_tmp_${name}`, mimeType: MimeType.GOOGLE_DOCS },
    pdfBlob.copyBlob().setContentType(MimeType.PDF),
    { ocrLanguage: 'th', fields: 'id' }
  );
  try {
    return DocumentApp.openById(doc.id).getBody().getText();
  } finally {
    DriveApp.getFileById(doc.id).setTrashed(true);
  }
}

// ==================== SearchIndex.js ====================

/**
 * สร้างไฟล์ search index (เนื้อหาของเวอร์ชันปัจจุบันแต่ละเอกสาร) เก็บเป็น JSON + gzip ใน Drive
 * browser โหลดไปครั้งเดียวแล้วค้นหาเองทั้งหมด
 */

function rebuildSearchIndex_(db) {
  const p = props_();
  const old = loadSearchIndex_();
  const maxChars = getSettings_().maxTextChars;
  const docs = {};
  let readCount = 0;

  db.Documents.filter((d) => d.current_version_id).forEach((d) => {
    const prev = old.docs[d.id];
    if (prev && prev.v === d.current_version_id) {
      docs[d.id] = prev;
      return;
    }
    const v = db.Versions.get(d.current_version_id);
    let content = '';
    if (v && v.text_drive_id) {
      try {
        content = DriveApp.getFileById(v.text_drive_id).getBlob().getDataAsString('UTF-8');
        readCount++;
      } catch (err) {
        log_('WARN', `อ่านข้อความของ "${d.title}" ไม่ได้: ${err.message}`);
      }
    }
    docs[d.id] = { v: d.current_version_id, c: normalizeForSearch_(content).slice(0, maxChars) };
  });

  const json = JSON.stringify({ generatedAt: nowIso_(), docs });
  const gz = Utilities.gzip(Utilities.newBlob(json, 'application/json'), 'search-index.json.gz');
  const folder = DriveApp.getFolderById(p.getProperty('INDEX_FOLDER_ID'));
  const newFile = folder.createFile(gz);
  const oldId = p.getProperty('INDEX_FILE_ID');
  p.setProperty('INDEX_FILE_ID', newFile.getId());
  if (oldId) {
    try { DriveApp.getFileById(oldId).setTrashed(true); } catch (e) { /* ไฟล์เก่าอาจถูกลบไปแล้ว */ }
  }
  log_('INFO', `สร้าง search index ใหม่: ${Object.keys(docs).length} เอกสาร (อ่านข้อความใหม่ ${readCount} ไฟล์)`);
}

function loadSearchIndex_() {
  const id = props_().getProperty('INDEX_FILE_ID');
  if (!id) return { docs: {} };
  try {
    const blob = DriveApp.getFileById(id).getBlob().setContentType('application/x-gzip');
    return JSON.parse(Utilities.ungzip(blob).getDataAsString('UTF-8'));
  } catch (err) {
    log_('WARN', `โหลด search index เดิมไม่ได้ จะสร้างใหม่ทั้งหมด: ${err.message}`);
    return { docs: {} };
  }
}

// ==================== Api.js ====================

/**
 * ฟังก์ชันที่หน้าเว็บเรียกผ่าน google.script.run
 * ฟังก์ชันที่ชื่อไม่ลงท้ายด้วย _ ถูกเรียกจาก browser ได้ — ฟังก์ชัน admin ต้องตรวจรหัสผ่านทุกครั้ง
 */

// ---------- สำหรับผู้ใช้ทั่วไป ----------

function getBootstrap() {
  const db = openDb_(['Sources', 'Files', 'Documents', 'Versions']);
  const { badgeDays } = getSettings_();
  const cutoff = Date.now() - badgeDays * 86400000;
  const badgeOf = { initial: 'new', revised: 'revised', updated: 'updated' };
  const versionCount = {};
  db.Versions.rows.forEach((v) => (versionCount[v.document_id] = (versionCount[v.document_id] || 0) + 1));

  const documents = db.Documents
    .filter((d) => d.current_version_id)
    .map((d) => {
      const v = db.Versions.get(d.current_version_id) || {};
      const f = db.Files.get(d.current_file_id) || {};
      let badge = '';
      if (d.status === 'missing') badge = 'missing';
      else if (v.file_modified_at && Date.parse(v.file_modified_at) >= cutoff) badge = badgeOf[v.change_type] || '';
      return {
        id: d.id,
        title: d.title,
        category: d.category,
        tags: d.tags,
        rev: d.current_rev,
        versionId: d.current_version_id,
        fileName: v.file_name || f.file_name || '',
        updatedAt: v.file_modified_at || '',
        modifiedBy: v.modified_by || '',
        webUrl: f.web_url || '',
        badge,
        versions: versionCount[d.id] || 0,
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return {
    documents,
    categories: [...new Set(documents.map((d) => d.category))].sort(),
    badgeDays,
    indexFileId: props_().getProperty('INDEX_FILE_ID') || '',
    pending: db.Files.filter((f) => f.status === 'active' && f.processed_ctag !== f.ctag).length,
  };
}

function getDocumentDetail(docId) {
  const db = openDb_(['Files', 'Documents', 'Versions']);
  const d = db.Documents.get(docId);
  if (!d) throw new Error('ไม่พบเอกสาร');
  const versions = db.Versions
    .filter((v) => v.document_id === docId)
    .sort((a, b) => Number(b.version_no) - Number(a.version_no))
    .map((v) => {
      const f = db.Files.get(v.file_id) || {};
      return {
        id: v.id,
        versionNo: Number(v.version_no),
        rev: v.rev_label,
        changeType: v.change_type,
        fileName: v.file_name,
        fileModifiedAt: v.file_modified_at,
        modifiedBy: v.modified_by,
        sizeBytes: Number(v.size_bytes) || 0,
        textStatus: v.text_status,
        note: v.note,
        isCurrent: v.id === d.current_version_id,
        previewUrl: v.pdf_drive_id ? `https://drive.google.com/file/d/${v.pdf_drive_id}/preview` : '',
        webUrl: f.web_url || '',
        fileStatus: f.status || '',
      };
    });
  return { id: d.id, title: d.title, category: d.category, tags: d.tags, rev: d.current_rev, status: d.status, versions };
}

/** ส่ง PDF ของเวอร์ชันนั้นเป็น base64 ให้ PDF.js แสดงผล */
function getVersionFile(versionId) {
  const db = openDb_(['Versions']);
  const v = db.Versions.get(versionId);
  if (!v || !v.pdf_drive_id) throw new Error('ไม่พบไฟล์ของเวอร์ชันนี้');
  const blob = DriveApp.getFileById(v.pdf_drive_id).getBlob();
  return { name: v.file_name, mimeType: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}

/** search index (gzip) เป็น base64 — browser แตกไฟล์เองด้วย DecompressionStream */
function getContentIndex() {
  const id = props_().getProperty('INDEX_FILE_ID');
  if (!id) return '';
  return Utilities.base64Encode(DriveApp.getFileById(id).getBlob().getBytes());
}

// ---------- Admin ----------

function checkAdmin_(password) {
  const expected = props_().getProperty('ADMIN_PASSWORD');
  if (!expected) throw new Error('ยังไม่ได้ตั้งค่า ADMIN_PASSWORD ใน Script Properties');
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('admin_fails') || 0);
  if (fails >= 10) throw new Error('ใส่รหัสผิดหลายครั้งเกินไป กรุณารอ 10 นาที');
  if (password !== expected) {
    cache.put('admin_fails', String(fails + 1), 600);
    throw new Error('รหัสผ่านไม่ถูกต้อง');
  }
}

function withAdminLock_(password, fn) {
  checkAdmin_(password);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('ระบบกำลัง sync อยู่ กรุณาลองใหม่ในอีกสักครู่');
  try {
    return fn();
  } finally {
    flushLogs_();
    lock.releaseLock();
  }
}

function adminLogin(password) {
  checkAdmin_(password);
  return true;
}

function adminGetState(password) {
  checkAdmin_(password);
  const db = openDb_(['Sources', 'Files', 'Documents', 'ReviewQueue']);
  const logSheet = db.ss.getSheetByName('Logs');
  const lastRow = logSheet.getLastRow();
  const logs = lastRow > 1
    ? logSheet.getRange(Math.max(2, lastRow - 49), 1, Math.min(50, lastRow - 1), 3).getValues().reverse()
      .map(([time, level, message]) => ({ time: cellToString_(time), level, message }))
    : [];
  return {
    sources: db.Sources.rows.map((s) => ({
      id: s.id, name: s.name, input: s.input, kind: s.kind, status: s.status,
      lastSyncedAt: s.last_synced_at, lastError: s.last_error,
      fileCount: db.Files.filter((f) => f.source_id === s.id && f.status !== 'missing').length,
    })),
    review: db.ReviewQueue.filter((r) => r.status === 'open').map((r) => {
      const f = db.Files.get(r.file_id) || {};
      const d = db.Documents.get(r.candidate_document_id) || {};
      return { id: r.id, fileName: f.file_name, folder: f.folder_path, candidateTitle: d.title, similarity: r.similarity };
    }),
    stats: {
      documents: db.Documents.filter((d) => d.current_version_id).length,
      files: db.Files.rows.length,
      pending: db.Files.filter((f) => f.status === 'active' && f.processed_ctag !== f.ctag).length,
      failed: db.Files.filter((f) => Number(f.attempts || 0) >= MAX_ATTEMPTS).length,
    },
    logs,
  };
}

function adminAddSource(password, input, name) {
  return withAdminLock_(password, () => {
    const resolved = resolveSourceInput_(input);
    const db = openDb_(['Sources']);
    if (db.Sources.find((s) => s.drive_id === resolved.driveId && s.item_id === resolved.itemId)) {
      throw new Error('ลิงก์นี้ถูกเพิ่มไว้แล้ว');
    }
    const source = db.Sources.insert({
      name: String(name || '').trim() || resolved.name,
      input: String(input).trim(),
      drive_id: resolved.driveId,
      item_id: resolved.itemId,
      kind: resolved.kind,
      status: 'new',
      created_at: nowIso_(),
    });
    db.saveAll();
    log_('INFO', `เพิ่มแหล่งเอกสาร "${source.name}" (${resolved.kind})`);
    return { id: source.id, name: source.name, kind: source.kind };
  });
}

function adminSetSourceStatus(password, sourceId, status) {
  if (!['disabled', 'ok'].includes(status)) throw new Error('สถานะไม่ถูกต้อง');
  return withAdminLock_(password, () => {
    const db = openDb_(['Sources']);
    const s = db.Sources.get(sourceId);
    if (!s) throw new Error('ไม่พบแหล่งเอกสาร');
    db.Sources.update(s, { status });
    db.saveAll();
    log_('INFO', `${status === 'disabled' ? 'ปิด' : 'เปิด'}การ sync "${s.name}"`);
    return true;
  });
}

function adminSyncNow(password) {
  checkAdmin_(password);
  return runJob_();
}

/** action: 'merge' = เป็นเอกสารเดียวกับที่ระบบเสนอ, 'new' = แยกเป็นเอกสารใหม่, 'ignore' = ไม่นำเข้าระบบ */
function adminResolveReview(password, reviewId, action) {
  if (!['merge', 'new', 'ignore'].includes(action)) throw new Error('action ไม่ถูกต้อง');
  return withAdminLock_(password, () => {
    const db = openDb_();
    const r = db.ReviewQueue.get(reviewId);
    if (!r || r.status !== 'open') throw new Error('รายการนี้ถูกจัดการไปแล้ว');
    const file = db.Files.get(r.file_id);
    if (!file) throw new Error('ไม่พบไฟล์');
    if (action === 'merge') {
      db.Files.update(file, { document_id: r.candidate_document_id, status: 'active' });
    } else if (action === 'new') {
      const source = db.Sources.get(file.source_id);
      const doc = createDocumentForFile_(db, source, file, parseFileName_(file.file_name));
      db.Files.update(file, { document_id: doc.id, status: 'active' });
    } else {
      db.Files.update(file, { status: 'ignored' });
    }
    db.ReviewQueue.update(r, { status: action });
    db.saveAll();
    log_('INFO', `Admin ${action}: "${file.file_name}"`);
    return true;
  });
}

// ==================== WebApp.js ====================

function doGet() {
  // Index.html สร้างโดย npm run build (ฝัง CSS, ฟอนต์ และ JavaScript ไว้ครบในไฟล์เดียว)
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ==================== Menu.js ====================

/**
 * เมนู "Document Schematic" ใน Google Sheet — ติดตั้ง ตั้งค่า sync และทดสอบ โดยไม่ต้องเข้า Apps Script editor
 */

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('📄 Document Schematic')
    .addItem('1. ติดตั้ง / อัปเดตระบบ', 'menuInstall')
    .addItem('2. ตั้งค่า (รหัสผ่าน Admin, OneDrive)', 'menuSettings')
    .addItem('3. เปิดหน้าเว็บ', 'menuOpenWebApp')
    .addSeparator()
    .addItem('Sync ตอนนี้', 'menuSync')
    .addSubMenu(ui.createMenu('ทดสอบ')
      .addItem('เชื่อมต่อ OneDrive', 'menuTestGraph')
      .addItem('อ่านข้อความจาก PDF (OCR)', 'menuTestOcr')
      .addItem('แยกเลข Rev จากชื่อไฟล์', 'menuTestRevParser'))
    .addToUi();
}

function runMenu_(title, fn) {
  const ui = SpreadsheetApp.getUi();
  try {
    const message = fn(ui);
    if (message) ui.alert(title, message, ui.ButtonSet.OK);
  } catch (err) {
    ui.alert(`${title}: ไม่สำเร็จ`, err.message, ui.ButtonSet.OK);
  }
}

function menuInstall() {
  runMenu_('ติดตั้งระบบ', () => setup());
}

function menuSync() {
  runMenu_('Sync', () => {
    const r = syncNow();
    if (r.skipped) return 'มีงาน sync อื่นกำลังทำงานอยู่ ลองใหม่ในอีกสักครู่';
    return `แหล่งเอกสาร ${r.sources} แห่ง\nไฟล์ใหม่ ${r.newFiles} · เปลี่ยนแปลง ${r.changed} · หายไป ${r.missing}\n` +
      `ประมวลผลแล้ว ${r.processed} · ล้มเหลว ${r.failed}` +
      (r.remaining ? `\nเหลืออีก ${r.remaining} ไฟล์ — ระบบจะทำต่อในรอบถัดไป` : '');
  });
}

function menuTestGraph() {
  runMenu_('ทดสอบเชื่อมต่อ OneDrive', () => {
    const ui = SpreadsheetApp.getUi();
    const res = ui.prompt('ทดสอบเชื่อมต่อ OneDrive', 'วางลิงก์โฟลเดอร์ OneDrive (เว้นว่าง = ทดสอบแค่การขอ token)', ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return '';
    return testGraphConnection(res.getResponseText().trim());
  });
}

function menuTestOcr() {
  runMenu_('ทดสอบ OCR', () => {
    const ui = SpreadsheetApp.getUi();
    const res = ui.prompt('ทดสอบอ่านข้อความจาก PDF', 'อัปโหลด PDF ขึ้น Google Drive แล้ววางลิงก์ของไฟล์ที่นี่', ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return '';
    const m = res.getResponseText().match(/[-\w]{25,}/);
    if (!m) throw new Error('ไม่พบ ID ของไฟล์ในลิงก์');
    return testOcr(m[0]);
  });
}

function menuTestRevParser() {
  runMenu_('ทดสอบแยกเลข Rev', () => {
    const ui = SpreadsheetApp.getUi();
    const res = ui.prompt('ทดสอบแยกเลข Rev', 'พิมพ์ชื่อไฟล์ (หลายชื่อคั่นด้วย | ) — เว้นว่างเพื่อดูตัวอย่าง', ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return '';
    const names = res.getResponseText().split('|').map((s) => s.trim()).filter(Boolean);
    return testRevParser(names.length ? names : null);
  });
}

function menuOpenWebApp() {
  runMenu_('หน้าเว็บ', () => {
    const url = ScriptApp.getService().getUrl();
    if (!url) {
      return 'ยังไม่ได้ Deploy หน้าเว็บ\n\nที่ Apps Script: Deploy → New deployment → ⚙️ Web app\n' +
        'Execute as: Me · Who has access: Anyone → Deploy';
    }
    const html = HtmlService.createHtmlOutput(
      `<div style="font-family:sans-serif;font-size:14px;line-height:1.6">
        <p>ลิงก์หน้าเว็บ (ส่งให้ผู้ใช้ได้เลย):</p>
        <p><a href="${url}" target="_blank" style="color:#cc785c;word-break:break-all">${url}</a></p>
      </div>`).setWidth(460).setHeight(150);
    SpreadsheetApp.getUi().showModalDialog(html, 'เปิดหน้าเว็บ');
    return '';
  });
}

// ---------- หน้าต่างตั้งค่า ----------

const CONFIG_FIELDS = [
  { key: 'ADMIN_PASSWORD', label: 'รหัสผ่านหน้า Admin', secret: true },
  { key: 'TENANT_ID', label: 'Directory (tenant) ID', secret: false },
  { key: 'CLIENT_ID', label: 'Application (client) ID', secret: false },
  { key: 'CLIENT_SECRET', label: 'Client secret (Value)', secret: true },
];

function menuSettings() {
  runMenu_('ตั้งค่า', () => {
    requireOwner_();
    const p = props_();
    const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const fields = CONFIG_FIELDS.map((f) => {
      const current = p.getProperty(f.key);
      return `<label>${esc(f.label)}
        <input name="${f.key}" type="${f.secret ? 'password' : 'text'}" autocomplete="off"
          value="${f.secret ? '' : esc(current)}" placeholder="${f.secret && current ? 'ตั้งไว้แล้ว — เว้นว่างเพื่อใช้ค่าเดิม' : ''}">
      </label>`;
    }).join('');
    const html = HtmlService.createHtmlOutput(`
      <style>
        body { font-family: sans-serif; font-size: 14px; color: #141413; margin: 0; padding: 4px 2px; }
        label { display: block; margin-bottom: 12px; color: #6c6a64; }
        input { display: block; width: 100%; box-sizing: border-box; height: 36px; margin-top: 4px; padding: 0 10px;
          border: 1px solid #e6dfd8; border-radius: 8px; font-size: 14px; color: #141413; }
        p { color: #6c6a64; font-size: 13px; margin: 0 0 14px; }
        button { height: 36px; padding: 0 18px; border: 0; border-radius: 8px; background: #cc785c; color: #fff; font-size: 14px; cursor: pointer; }
        #msg { margin-left: 10px; font-size: 13px; }
      </style>
      <p>ค่า OneDrive ได้จาก IT (ดูขั้นตอนใน docs/SETUP.md) — ใส่ภายหลังได้</p>
      <form id="f">${fields}<button type="submit">บันทึก</button><span id="msg"></span></form>
      <script>
        document.getElementById('f').onsubmit = (e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.target));
          document.getElementById('msg').textContent = 'กำลังบันทึก…';
          google.script.run
            .withSuccessHandler(() => google.script.host.close())
            .withFailureHandler((err) => { document.getElementById('msg').textContent = err.message; })
            .saveSettingsFromDialog(data);
        };
      </script>`).setWidth(420).setHeight(420);
    SpreadsheetApp.getUi().showModalDialog(html, 'ตั้งค่า Document Schematic');
    return '';
  });
}

/** เรียกจากหน้าต่างตั้งค่า — ช่องที่เว้นว่างจะไม่เปลี่ยนค่าเดิม */
function saveSettingsFromDialog(values) {
  requireOwner_();
  const p = props_();
  CONFIG_FIELDS.forEach(({ key }) => {
    const v = String((values && values[key]) || '').trim();
    if (v) p.setProperty(key, v);
  });
  CacheService.getScriptCache().remove('graph_token');
  return true;
}

// ==================== Setup.js ====================

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
