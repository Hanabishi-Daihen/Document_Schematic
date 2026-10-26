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
