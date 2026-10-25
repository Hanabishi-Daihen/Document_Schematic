# Document Schematic

Web app สำหรับรวมเอกสาร PDF จาก OneDrive องค์กรไว้ที่เดียว พร้อมระบบค้นหาและการติดตาม Revision ของเอกสาร — ทำงานบน **Google Apps Script** ใช้งานฟรีทั้งหมด

- ดึงเอกสารจากลิงก์ OneDrive ผ่าน Microsoft Graph API (sync อัตโนมัติทุก 30 นาที)
- แยกเลข `Rev.N` จากชื่อไฟล์ แสดงป้าย **🔄 Revised** (เลข Rev เปลี่ยน) และ **📝 Updated** (แก้เนื้อหาแต่ Rev เดิม)
- ค้นหาจากชื่อและเนื้อหา PDF ภาษาไทย (OCR ผ่าน Google Drive)
- เก็บสำเนาทุกเวอร์ชัน ดูย้อนหลังและเปรียบเทียบได้

Stack: Google Apps Script · Google Sheets (ฐานข้อมูล) · Google Drive (เก็บไฟล์ + OCR) · Microsoft Graph API

ดูรายละเอียดการออกแบบได้ที่ [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md)
