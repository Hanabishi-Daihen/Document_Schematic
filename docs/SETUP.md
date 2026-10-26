# คู่มือติดตั้ง Document Schematic (Google Apps Script)

ใช้เวลาประมาณ 30–45 นาที ไม่มีค่าใช้จ่าย

**ภาพรวม:** [1. สร้าง Script](#1-สร้าง-apps-script-จาก-google-sheet) → [2. ตั้งค่า](#2-ตั้งค่า-script-properties) → [3. รัน setup](#3-รัน-setup) → [4. ทดสอบ Phase 0](#4-ทดสอบ-phase-0) → [5. Microsoft Entra App](#5-ลงทะเบียน-app-ใน-microsoft-entra-id-ให้-it-admin-ทำ) → [6. Deploy เว็บ](#6-deploy-เป็น-web-app) → [7. เพิ่มลิงก์ OneDrive](#7-เพิ่มลิงก์-onedrive-และเริ่มใช้งาน)

---

## 1. สร้าง Apps Script จาก Google Sheet

1. เปิด Google Sheet ที่จะใช้เป็นฐานข้อมูล → เมนู **ส่วนขยาย (Extensions) → Apps Script**
2. ที่หน้า Apps Script → ⚙️ **Project Settings** → ติ๊ก **Show "appsscript.json" manifest file in editor**
3. กลับไปที่ **Editor** แล้วสร้างไฟล์ตามตารางนี้ (กด **+** ข้าง Files) และคัดลอกเนื้อหาจากโฟลเดอร์ `gas/` ใน repo นี้ไปวาง

| ไฟล์ใน repo | ชนิดใน Apps Script | ชื่อไฟล์ที่ต้องตั้ง |
|---|---|---|
| `gas/appsscript.json` | (มีอยู่แล้ว — แทนที่เนื้อหาทั้งหมด) | `appsscript.json` |
| `gas/Config.js` | Script | `Config` |
| `gas/Repo.js` | Script | `Repo` |
| `gas/RevParser.js` | Script | `RevParser` |
| `gas/Graph.js` | Script | `Graph` |
| `gas/Sync.js` | Script | `Sync` |
| `gas/Processor.js` | Script | `Processor` |
| `gas/SearchIndex.js` | Script | `SearchIndex` |
| `gas/Api.js` | Script | `Api` |
| `gas/WebApp.js` | Script | `WebApp` |
| `gas/Setup.js` | Script | `Setup` |
| `gas/ui/Index.html` | HTML | `ui/Index` |
| `gas/ui/Styles.html` | HTML | `ui/Styles` |
| `gas/ui/App.js.html` | HTML | `ui/App.js` |

- ลบไฟล์ `Code.gs` ที่มีมาตั้งแต่แรกทิ้งได้
- ชื่อไฟล์ HTML ต้องมี `ui/` นำหน้า (Apps Script จะแสดงเป็นโฟลเดอร์)
- กด 💾 Save

> **ทางเลือกสำหรับนักพัฒนา — ใช้ clasp แทนการคัดลอก:**
> ```bash
> npm install -g @google/clasp && clasp login
> cp .clasp.json.example .clasp.json   # ใส่ scriptId จาก Project Settings
> clasp push
> ```

---

## 2. ตั้งค่า Script Properties

⚙️ **Project Settings → Script Properties → Add script property**

| Property | ค่า | จำเป็น |
|---|---|---|
| `ADMIN_PASSWORD` | รหัสผ่านหน้า Admin (ตั้งให้เดายาก) | ✅ |
| `TENANT_ID` | Directory (tenant) ID จากข้อ 5 | ✅ (ใส่ทีหลังได้) |
| `CLIENT_ID` | Application (client) ID จากข้อ 5 | ✅ (ใส่ทีหลังได้) |
| `CLIENT_SECRET` | Client secret **Value** จากข้อ 5 | ✅ (ใส่ทีหลังได้) |
| `SPREADSHEET_ID` | ID ของ Google Sheet — **ไม่ต้องใส่** ถ้าสร้าง Script จากเมนูของ Sheet ตามข้อ 1 | — |
| `TEST_PDF_DRIVE_ID` | ID ของ PDF ทดสอบใน Google Drive (ข้อ 4) | ทดสอบ |
| `TEST_SOURCE` | ลิงก์โฟลเดอร์ OneDrive สำหรับทดสอบ (ข้อ 4) | ทดสอบ |

> 🔒 ค่าเหล่านี้เป็นความลับ — ห้ามเขียนลงในโค้ด และห้าม commit ขึ้น GitHub

---

## 3. รัน setup

1. ที่ Editor เลือกไฟล์ `Setup` → เลือกฟังก์ชัน **`setup`** ในแถบด้านบน → กด **▶ Run**
2. ครั้งแรก Google จะขอสิทธิ์ → **Review permissions** → เลือกบัญชี → ถ้าขึ้น *"Google hasn't verified this app"* ให้กด **Advanced → Go to … (unsafe)** → **Allow** (เป็นเรื่องปกติของ Script ที่เราเขียนเอง)
3. เมื่อเสร็จ Execution log จะแสดง `✅ setup เสร็จ`

setup จะสร้างให้อัตโนมัติ:
- sheet **Sources, Files, Documents, Versions, ReviewQueue, Settings, Logs** ใน Google Sheet
- โฟลเดอร์ **Document Schematic/** ใน Google Drive (`versions/`, `text/`, `index/`)
- trigger ให้ sync ทุก 30 นาที

รัน `setup` ซ้ำได้เสมอ (ไม่ลบข้อมูลเดิม) — เช่น หลังแก้ `sync_interval_minutes` ใน sheet Settings

> ⚠️ **อย่าแก้ข้อมูลใน sheet อื่นนอกจาก `Settings` ด้วยมือ** ระบบเขียนทับทั้งตารางทุกรอบ sync
> 🔒 แนะนำให้ตั้งการแชร์ Google Sheet เป็น **Restricted** (เฉพาะเจ้าของ) เพราะมีรายชื่อเอกสารภายในองค์กร — ผู้ใช้เว็บไม่ต้องมีสิทธิ์เข้า Sheet

---

## 4. ทดสอบ Phase 0

ทดสอบ 3 เรื่องที่มีความเสี่ยงที่สุดก่อนใช้งานจริง (เลือกชื่อฟังก์ชัน → ▶ Run → ดูผลใน Execution log)

### 4.1 `testRevParser` — แยกเลข Rev จากชื่อไฟล์
ดูว่าผลออกมาถูกต้อง ถ้าองค์กรมีรูปแบบชื่อไฟล์แปลกๆ ส่งตัวอย่างมาให้ปรับ regex ได้

### 4.2 `testOcr` — อ่านข้อความไทยจาก PDF (ทดสอบได้ทันที ไม่ต้องรอ IT)
1. อัปโหลด PDF ภาษาไทยจริง 1 ไฟล์ขึ้น Google Drive
2. เปิดไฟล์ → คัดลอก ID จาก URL `https://drive.google.com/file/d/`**`<ID>`**`/view`
3. ใส่ใน Script Property `TEST_PDF_DRIVE_ID` → รัน `testOcr`

สิ่งที่ต้องตรวจ:
- ข้อความไทยอ่านออก สระ/วรรณยุกต์ไม่เพี้ยน
- **ข้อความท้ายไฟล์** (500 ตัวอักษรสุดท้าย) ตรงกับหน้าสุดท้ายของ PDF หรือไม่ — ถ้าไม่ตรง แปลว่า Google OCR อ่านไม่ครบทุกหน้า (ข้อจำกัด ~10 หน้า) จะเพิ่มการตัด PDF เป็นชุดใน Phase 2
- ทดสอบทั้ง PDF แบบพิมพ์ และแบบสแกน และไฟล์ที่ยาวเกิน 10 หน้า

### 4.3 `testGraphConnection` — เชื่อม OneDrive (หลังได้ค่าจากข้อ 5)
ใส่ `TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET` และ `TEST_SOURCE` (ลิงก์โฟลเดอร์ OneDrive) → รัน `testGraphConnection`
ผลที่ถูกต้อง: แสดงรายชื่อไฟล์พร้อมเลข Rev ที่แยกได้

---

## 5. ลงทะเบียน App ใน Microsoft Entra ID (ให้ IT Admin ทำ)

ไม่มีค่าใช้จ่าย ใช้เวลา ~10 นาที

1. เข้า <https://entra.microsoft.com> → **Applications → App registrations → New registration**
   - Name: `Document Schematic`
   - Supported account types: **Accounts in this organizational directory only**
   - Redirect URI: เว้นว่าง → **Register**
2. หน้า **Overview** → คัดลอก **Application (client) ID** และ **Directory (tenant) ID**
3. **API permissions → Add a permission → Microsoft Graph → Application permissions**
   → เลือก **`Files.Read.All`** (ถ้าเอกสารอยู่ใน SharePoint site ให้เพิ่ม **`Sites.Read.All`**) → **Add permissions**
   → กด **Grant admin consent for <องค์กร>** (ต้องเป็น Admin)
4. **Certificates & secrets → New client secret** → ตั้งอายุ (สูงสุด 24 เดือน) → คัดลอกช่อง **Value** ทันที (จะดูได้ครั้งเดียว)
5. ส่งค่า 3 ค่าให้ผู้ดูแลระบบใส่ใน Script Properties (ส่งผ่านช่องทางที่ปลอดภัย)

> 📅 ตั้งเตือนในปฏิทินก่อน client secret หมดอายุ — ต้องสร้างใหม่และอัปเดต `CLIENT_SECRET`

**ถ้าเพิ่มลิงก์แชร์แล้วขึ้น `Graph 403`:** ใส่แหล่งเอกสารในรูปแบบ `อีเมลเจ้าของ:/path/โฟลเดอร์` แทน เช่น `somchai@company.com:/Documents/QA Procedures`

---

## 6. Deploy เป็น Web App

1. **Deploy → New deployment** → ⚙️ เลือก **Web app**
2. Execute as: **Me** · Who has access: **Anyone**
3. **Deploy** → คัดลอก **Web app URL** ไปแชร์ให้ผู้ใช้

เมื่อแก้โค้ดภายหลัง: **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy** (URL เดิม)

> ผู้ใช้ไม่ต้องมีบัญชี Google — เว็บเปิดได้ทุกคนที่มีลิงก์ ส่วนหน้า Admin ป้องกันด้วย `ADMIN_PASSWORD`

---

## 7. เพิ่มลิงก์ OneDrive และเริ่มใช้งาน

1. เปิด Web app → **Admin** → ใส่รหัสผ่าน
2. วางลิงก์โฟลเดอร์ OneDrive → **เพิ่ม**
3. กด **Sync ตอนนี้** — ครั้งแรกอาจต้องรอหลายรอบ (รอบละ ~4.5 นาที) ถ้ามีไฟล์มาก ระบบจะทำต่อเองทุก 30 นาที
4. กลับหน้า **เอกสาร** เพื่อค้นหาและดูเอกสาร

---

## การตั้งค่า (sheet `Settings`)

| key | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `badge_days` | 14 | แสดงป้าย New / Revised / Updated กี่วัน (นับจากวันที่ของไฟล์) |
| `file_extensions` | pdf | นามสกุลไฟล์ที่ดึงเข้าระบบ เช่น `pdf,docx` |
| `ocr_enabled` | TRUE | แตกข้อความจาก PDF เพื่อค้นหาเนื้อหา |
| `sync_interval_minutes` | 30 | รอบ sync (1/5/10/15/30) — รัน `setup` ใหม่หลังแก้ |
| `similarity_threshold` | 0.9 | ชื่อคล้ายกันเกินค่านี้ → ให้ Admin ยืนยันการจับคู่ |
| `max_text_chars` | 20000 | ความยาวเนื้อหาต่อเอกสารที่ใช้ค้นหา |

---

## แก้ปัญหา

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `ขอ token ไม่สำเร็จ: invalid_client` | `CLIENT_SECRET` ผิด หรือใส่ Secret **ID** แทน **Value** หรือ secret หมดอายุ |
| `Graph 403` | ยังไม่ได้ Grant admin consent หรือใช้รูปแบบ `อีเมล:/path` แทนลิงก์ |
| `Graph 404` ตอนเพิ่มลิงก์ | ลิงก์ถูกยกเลิก หรือคัดลอกไม่ครบ |
| ไฟล์ค้างสถานะ "ล้มเหลว" | ดูสาเหตุในคอลัมน์ `last_error` ของ sheet Files — ระบบลองซ้ำ 3 ครั้ง; แก้แล้วลบค่า `attempts` ในแถวนั้นเพื่อให้ลองใหม่ |
| ค้นหาในเนื้อหาไม่เจอ | ดูคอลัมน์ `text_status` ใน sheet Versions (ok / empty / failed) |
| แสดง PDF ไม่ได้ / ช้ามาก | PDF ใหญ่เกิน ~20 MB — ใช้ปุ่ม "เปิดใน OneDrive" แทน |
| `Exceeded maximum execution time` | ปกติสำหรับรอบแรกที่มีไฟล์มาก ระบบทำต่อในรอบถัดไปเอง |
