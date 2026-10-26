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
