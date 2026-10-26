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
