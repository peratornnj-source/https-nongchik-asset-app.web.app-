# Design Document: Multi-Format Database Importer (.xlsx, .xls, .csv, .json)

- **Project**: ระบบบริหารงานพัสดุและครุภัณฑ์ โรงพยาบาลหนองจิก (Nongchik Hospital Asset Management)
- **Date**: 2026-11-11
- **Status**: Approved

---

## 1. Intent & The Why
โรงพยาบาลหนองจิกมีข้อมูลครุภัณฑ์ที่ส่งออกจากโปรแกรมหรือระบบสารสนเทศต่างๆ ของกระทรวงสาธารณสุข และแบบฟอร์มสเปรดชีตของฝ่ายพัสดุ ซึ่งมักเป็นไฟล์ Microsoft Excel (`.xlsx`, `.xls`) หรือ `.csv` ที่มีรูปแบบหัวคอลัมน์แตกต่างกัน
เดิมระบบรองรับเฉพาะไฟล์ `.csv` แบบจำกัดโครงสร้างคอลัมน์ ทำให้ผู้ใช้ต้องแปลงไฟล์เป็น CSV ก่อน การเพิ่มระบบนำเข้าไฟล์ `.xlsx`, `.xls`, `.csv`, `.tsv`, และ `.json` พร้อมการจับคู่คอลัมน์อัตโนมัติ (Smart Auto-Mapping) จะทำให้การอัปเดตฐานข้อมูลทำได้ง่าย สะดวก และปลอดภัย

---

## 2. Goals & Non-Goals

### Goals
- **Multi-Format Support**: อ่านและแยกแยะไฟล์ `.xlsx`, `.xls`, `.csv`, `.tsv`, และ `.json` ได้โดยตรงในเบราว์เซอร์
- **Smart Column Detection**: จับคู่คอลัมน์อัตโนมัติจากคำพบบ่อยทั้งภาษาไทยและภาษาอังกฤษ (เลขครุภัณฑ์, ชื่อรายการ, ราคา, วันที่, แผนก, สถานะ)
- **Import Modes**:
  1. **Smart Merge / Upsert**: ค้นหาตามเลขครุภัณฑ์ อัปเดตข้อมูลเดิมหากพบ หรือเพิ่มใหม่หากไม่พบ (ค่าเริ่มต้น)
  2. **Replace All**: ล้างข้อมูลเดิมและแทนที่ด้วยข้อมูลชุดใหม่
- **Interactive Preview Modal**: แสดงสรุปจำนวนรายการ คอลัมน์ที่ตรวจพบ และตัวอย่าง 3-5 รายการแรกให้ผู้ใช้ตรวจสอบและกดยืนยัน
- **Live Sync & Cloud Upload**: อัปเดตตารางหน้าจอและสถิติ KPI ทันที พร้อมตัวเลือกอัปโหลดขึ้น Cloud Firestore

### Non-Goals
- ไม่ดึงข้อมูลผ่าน API เชื่อมต่อกับระบบ ERP ภายนอกโดยตรง (นำเข้าผ่านไฟล์ที่ผู้ใช้เลือก)

---

## 3. Technical Architecture & File Layout
- **New Module**: `data-importer.js`
  - `DataImporter.detectColumns(rowKeys: string[]) -> object`
  - `DataImporter.parseExcelBuffer(buffer: ArrayBuffer) -> Array<object>`
  - `DataImporter.parseCSVText(text: string) -> Array<object>`
  - `DataImporter.parseJSONText(text: string) -> Array<object>`
  - `DataImporter.normalizeAssets(rawRows: Array<object>, mapping: object) -> Array<object>`
  - `DataImporter.mergeAssets(currentAssets: Array<object>, importedAssets: Array<object>, mode: 'merge'|'replace') -> { merged: Array<object>, addedCount: number, updatedCount: number }`
- **UI Changes in `index.html`**:
  - อัปเกรดปุ่ม "นำเข้าข้อมูล" ให้รับ `.xlsx, .xls, .csv, .tsv, .json`
  - เพิ่มหน้าต่าง `#importPreviewModal`
- **Unit Tests**: `tests/test-data-importer.test.js`
