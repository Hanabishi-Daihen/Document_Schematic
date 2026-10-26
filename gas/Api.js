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
