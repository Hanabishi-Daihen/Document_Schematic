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
