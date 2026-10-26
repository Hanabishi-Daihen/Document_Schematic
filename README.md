# Document Schematic

Web app สำหรับรวมเอกสาร PDF จาก OneDrive องค์กรไว้ที่เดียว พร้อมระบบค้นหาและการติดตาม Revision ของเอกสาร — ทำงานบน **Google Apps Script** ใช้งานฟรีทั้งหมด

- ดึงเอกสารจากลิงก์ OneDrive ผ่าน Microsoft Graph API (sync อัตโนมัติทุก 30 นาที)
- แยกเลข `Rev.N` จากชื่อไฟล์ แสดงป้าย **🔄 Revised** (เลข Rev เปลี่ยน) และ **📝 Updated** (แก้เนื้อหาแต่ Rev เดิม)
- ค้นหาจากชื่อและเนื้อหา PDF ภาษาไทย (OCR ผ่าน Google Drive)
- เก็บสำเนาทุกเวอร์ชัน ดูย้อนหลังได้ในเว็บ

Stack: Google Apps Script · Google Sheets (ฐานข้อมูล) · Google Drive (เก็บไฟล์ + OCR) · Microsoft Graph API

## เริ่มต้น
- **ติดตั้ง:** วาง 3 ไฟล์จาก [`dist/`](dist) ลงใน Apps Script ของ Google Sheet แล้วใช้เมนู **📄 Document Schematic** — ดู [docs/SETUP.md](docs/SETUP.md)
- **การออกแบบระบบ:** [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md)
- **นักพัฒนา (Node 18+):** `npm install` → `npm test` → `npm run build`

หน้าเว็บไม่โหลดอะไรจาก CDN ภายนอก — CSS, ฟอนต์ และ JavaScript ฝังอยู่ใน `dist/Index.html`, PDF แสดงด้วย Google Drive viewer
