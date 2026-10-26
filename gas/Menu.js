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
