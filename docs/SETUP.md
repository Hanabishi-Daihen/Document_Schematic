# คู่มือติดตั้ง Document Schematic (Google Apps Script)

ระบบทั้งหมดอยู่ใน Google Apps Script + Google Sheet + Google Drive — หน้าเว็บไม่โหลดอะไรจาก CDN ภายนอก
ใช้เวลาติดตั้งประมาณ 15 นาที (ไม่นับเวลารอ IT) ไม่มีค่าใช้จ่าย

**ภาพรวม:** [1. วางโค้ด 3 ไฟล์](#1-วางโค้ด-3-ไฟล์) → [2. ติดตั้งจากเมนู](#2-ติดตั้งจากเมนูใน-google-sheet) → [3. ตั้งค่า](#3-ตั้งค่า) → [4. Deploy หน้าเว็บ](#4-deploy-หน้าเว็บ) → [5. ทดสอบ](#5-ทดสอบ) → [6. เพิ่มลิงก์ OneDrive](#6-เพิ่มลิงก์-onedrive-และเริ่มใช้งาน)

---

## 1. วางโค้ด 3 ไฟล์

ไฟล์ที่ต้องใช้อยู่ในโฟลเดอร์ **`dist/`** ของ repo นี้ (เปิดไฟล์บน GitHub → ปุ่ม **Copy raw file**)

1. เปิด Google Sheet ที่จะใช้เป็นฐานข้อมูล → เมนู **ส่วนขยาย (Extensions) → Apps Script**
2. ⚙️ **Project Settings** → ติ๊ก **Show "appsscript.json" manifest file in editor**
3. กลับไปที่ **Editor** แล้ววางเนื้อหาตามตาราง

| ไฟล์ใน repo | ใน Apps Script | ทำอย่างไร |
|---|---|---|
| `dist/Code.gs` | `Code.gs` | เปิดไฟล์ `Code.gs` ที่มีอยู่แล้ว → ลบของเดิมทั้งหมด → วาง |
| `dist/Index.html` | `Index` | กด **+ → HTML** ตั้งชื่อ `Index` → ลบของเดิม → วาง |
| `dist/appsscript.json` | `appsscript.json` | เปิดไฟล์ → ลบของเดิมทั้งหมด → วาง |

4. กด 💾 **Save** แล้ว **ปิดแท็บ Apps Script และรีเฟรชหน้า Google Sheet**

> `Index.html` มีขนาด ~150 KB เพราะฝังฟอนต์และ CSS ไว้ในไฟล์ — วางทีเดียวได้ตามปกติ

---

## 2. ติดตั้งจากเมนูใน Google Sheet

หลังรีเฟรช จะมีเมนู **📄 Document Schematic** ที่แถบเมนูด้านบน (อาจใช้เวลา 2–3 วินาที)

1. **📄 Document Schematic → 1. ติดตั้ง / อัปเดตระบบ**
2. ครั้งแรก Google จะขอสิทธิ์ → **Continue** → เลือกบัญชี → ถ้าขึ้น *"Google hasn't verified this app"* ให้กด **Advanced → Go to … (unsafe)** → **Allow** (เป็นเรื่องปกติของ Script ที่เขียนเอง)
3. ถ้าหลังอนุญาตแล้วไม่มีอะไรเกิดขึ้น ให้กดเมนูเดิมอีกครั้ง → จะขึ้น **✅ ติดตั้งเสร็จแล้ว**

ระบบสร้างให้อัตโนมัติ:
- sheet **Sources, Files, Documents, Versions, ReviewQueue, Settings, Logs**
- โฟลเดอร์ **Document Schematic/** ใน Google Drive (`versions/`, `text/`, `index/`)
- การ sync อัตโนมัติทุก 30 นาที

> ⚠️ **อย่าแก้ข้อมูลใน sheet อื่นนอกจาก `Settings` ด้วยมือ** ระบบเขียนทับทั้งตารางทุกรอบ sync
> 🔒 แนะนำให้ตั้งการแชร์ Google Sheet เป็น **Restricted** (เฉพาะเจ้าของ) — ผู้ใช้เว็บไม่ต้องมีสิทธิ์เข้า Sheet

---

## 3. ตั้งค่า

**📄 Document Schematic → 2. ตั้งค่า** แล้วกรอก

| ช่อง | ค่า |
|---|---|
| รหัสผ่านหน้า Admin | ตั้งเองให้เดายาก (จำเป็น) |
| Directory (tenant) ID | จาก IT — [ข้อ 7](#7-ลงทะเบียน-app-ใน-microsoft-entra-id-ให้-it-admin-ทำ) |
| Application (client) ID | จาก IT |
| Client secret (Value) | จาก IT |

- ใส่ค่า OneDrive ทีหลังได้ — กลับมาที่เมนูนี้เมื่อได้รับจาก IT
- ช่องที่เว้นว่างจะใช้ค่าเดิม (รหัสผ่านและ secret จะไม่แสดงในหน้าต่าง)

---

## 4. Deploy หน้าเว็บ

ขั้นนี้ต้องทำใน Apps Script (Google ไม่อนุญาตให้ Script deploy ตัวเอง)

1. **ส่วนขยาย → Apps Script → Deploy → New deployment** → ⚙️ เลือก **Web app**
2. Execute as: **Me** · Who has access: **Anyone**
3. **Deploy** → คัดลอก **Web app URL** ไปแชร์ให้ผู้ใช้

ดูลิงก์ภายหลังได้จาก **📄 Document Schematic → 3. เปิดหน้าเว็บ**

> ผู้ใช้ไม่ต้องมีบัญชี Google — เว็บเปิดได้ทุกคนที่มีลิงก์ ส่วนหน้า Admin ป้องกันด้วยรหัสผ่าน

---

## 5. ทดสอบ

เมนู **📄 Document Schematic → ทดสอบ**

| เมนู | ใช้เมื่อ | ผลที่ถูกต้อง |
|---|---|---|
| **อ่านข้อความจาก PDF (OCR)** | ทำได้ทันที ไม่ต้องรอ IT — อัปโหลด PDF ภาษาไทยขึ้น Google Drive แล้ววางลิงก์ | ข้อความไทยอ่านออก สระ/วรรณยุกต์ไม่เพี้ยน และ **ข้อความช่วงท้าย** ตรงกับหน้าสุดท้ายของ PDF (ถ้าไม่ตรง = Google อ่านไม่ครบทุกหน้า) |
| **เชื่อมต่อ OneDrive** | หลังได้ค่าจาก IT — วางลิงก์โฟลเดอร์ OneDrive | ✅ ขอ token สำเร็จ + รายชื่อไฟล์พร้อมเลข Rev |
| **แยกเลข Rev จากชื่อไฟล์** | ตรวจรูปแบบชื่อไฟล์ขององค์กร (คั่นหลายชื่อด้วย `\|`) | ชื่อเอกสารและเลข Rev ถูกต้อง |

แนะนำทดสอบ OCR กับ PDF 3 แบบ: แบบพิมพ์, แบบสแกน, และไฟล์ที่ยาวเกิน 10 หน้า

---

## 6. เพิ่มลิงก์ OneDrive และเริ่มใช้งาน

1. เปิดหน้าเว็บ → **Admin** → ใส่รหัสผ่าน
2. วางลิงก์โฟลเดอร์ OneDrive → **เพิ่ม**
3. กด **Sync ตอนนี้** (หรือเมนู **Sync ตอนนี้** ใน Sheet) — ถ้ามีไฟล์มาก ระบบทำรอบละ ~4.5 นาที แล้วทำต่อเองทุก 30 นาที
4. กลับหน้า **เอกสาร** เพื่อค้นหาและดูเอกสาร

---

## 7. ลงทะเบียน App ใน Microsoft Entra ID (ให้ IT Admin ทำ)

ไม่มีค่าใช้จ่าย ใช้เวลา ~10 นาที

1. เข้า <https://entra.microsoft.com> → **Applications → App registrations → New registration**
   - Name: `Document Schematic`
   - Supported account types: **Accounts in this organizational directory only**
   - Redirect URI: เว้นว่าง → **Register**
2. หน้า **Overview** → คัดลอก **Application (client) ID** และ **Directory (tenant) ID**
3. **API permissions → Add a permission → Microsoft Graph → Application permissions**
   → เลือก **`Files.Read.All`** (ถ้าเอกสารอยู่ใน SharePoint site ให้เพิ่ม **`Sites.Read.All`**) → **Add permissions**
   → กด **Grant admin consent for <องค์กร>**
4. **Certificates & secrets → New client secret** → ตั้งอายุ (สูงสุด 24 เดือน) → คัดลอกช่อง **Value** ทันที (ดูได้ครั้งเดียว)
5. ส่งค่า 3 ค่าให้ผู้ดูแลระบบกรอกในเมนู **2. ตั้งค่า** (ส่งผ่านช่องทางที่ปลอดภัย)

> 📅 ตั้งเตือนในปฏิทินก่อน client secret หมดอายุ — ต้องสร้างใหม่และกรอกในเมนูตั้งค่าอีกครั้ง

**ถ้าเพิ่มลิงก์แชร์แล้วขึ้น `Graph 403`:** ใส่แหล่งเอกสารในรูปแบบ `อีเมลเจ้าของ:/path/โฟลเดอร์` แทน เช่น `somchai@company.com:/Documents/QA Procedures`

---

## อัปเดตเป็นเวอร์ชันใหม่

1. วาง `dist/Code.gs` และ `dist/Index.html` ใหม่ทับของเดิม → Save
2. **📄 Document Schematic → 1. ติดตั้ง / อัปเดตระบบ** (ไม่ลบข้อมูลเดิม)
3. Apps Script → **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy** (URL เดิม)

---

## การแสดง PDF และความเป็นส่วนตัว

หน้าเว็บแสดง PDF ด้วย **Google Drive viewer** (ไม่ต้องโหลดโปรแกรมอ่าน PDF จากภายนอก) จึงต้องตั้งสำเนา PDF ในโฟลเดอร์ `Document Schematic/versions` เป็น **"ทุกคนที่มีลิงก์ดูได้"** — ระบบตั้งให้เองตอนติดตั้ง

- ID ของไฟล์เป็นรหัสสุ่มยาว เดาไม่ได้ และหน้าเว็บเองก็เปิดได้ทุกคนที่มีลิงก์อยู่แล้ว
- ถ้าเอกสารเป็นความลับสูง: อย่าแชร์ลิงก์หน้าเว็บออกนอกองค์กร

---

## การตั้งค่าเพิ่มเติม (sheet `Settings`)

| key | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `badge_days` | 14 | แสดงป้าย New / Revised / Updated กี่วัน (นับจากวันที่ของไฟล์) |
| `file_extensions` | pdf | นามสกุลไฟล์ที่ดึงเข้าระบบ เช่น `pdf,docx` |
| `ocr_enabled` | TRUE | แตกข้อความจาก PDF เพื่อค้นหาเนื้อหา |
| `sync_interval_minutes` | 30 | รอบ sync (1/5/10/15/30) — กดเมนู **1. ติดตั้ง / อัปเดตระบบ** หลังแก้ |
| `similarity_threshold` | 0.9 | ชื่อคล้ายกันเกินค่านี้ → ให้ Admin ยืนยันการจับคู่ |
| `max_text_chars` | 20000 | ความยาวเนื้อหาต่อเอกสารที่ใช้ค้นหา |

---

## แก้ปัญหา

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| ไม่มีเมนู 📄 Document Schematic | รีเฟรชหน้า Sheet และรอ 2–3 วินาที; ตรวจว่าวาง `Code.gs` แล้วกด Save |
| `ขอ token ไม่สำเร็จ: invalid_client` | Client secret ผิด หรือใส่ Secret **ID** แทน **Value** หรือ secret หมดอายุ |
| `Graph 403` | ยังไม่ได้ Grant admin consent หรือใช้รูปแบบ `อีเมล:/path` แทนลิงก์ |
| `Graph 404` ตอนเพิ่มลิงก์ | ลิงก์ถูกยกเลิก หรือคัดลอกไม่ครบ |
| ไฟล์ค้างสถานะ "ล้มเหลว" | ดูคอลัมน์ `last_error` ใน sheet Files — ระบบลองซ้ำ 3 ครั้ง; แก้แล้วลบค่า `attempts` ในแถวนั้นเพื่อให้ลองใหม่ |
| ค้นหาในเนื้อหาไม่เจอ | ดูคอลัมน์ `text_status` ใน sheet Versions (ok / empty / failed) |
| ช่องแสดง PDF ว่าง / ขอให้ล็อกอิน | ข้อความเตือนตอนติดตั้งเรื่องสิทธิ์โฟลเดอร์ versions — บัญชี Google Workspace บางองค์กรห้ามแชร์แบบ "ทุกคนที่มีลิงก์"; ใช้ปุ่มดาวน์โหลดแทน |
| `Exceeded maximum execution time` | ปกติสำหรับรอบแรกที่มีไฟล์มาก ระบบทำต่อในรอบถัดไปเอง |

---

## สำหรับนักพัฒนา

ซอร์สแยกไฟล์อยู่ที่ `gas/` — `dist/` สร้างจาก `gas/` ด้วยคำสั่ง build (ห้ามแก้ `dist/` โดยตรง)

```bash
npm install          # Tailwind + ฟอนต์ (ใช้ตอน build เท่านั้น)
npm test             # ทดสอบด้วย GAS จำลอง + ตรวจว่า dist/ ตรงกับซอร์ส
npm run build        # สร้าง dist/
npm run push         # build แล้ว clasp push (ต้องมี .clasp.json — ดู .clasp.json.example)
```
