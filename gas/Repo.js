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
