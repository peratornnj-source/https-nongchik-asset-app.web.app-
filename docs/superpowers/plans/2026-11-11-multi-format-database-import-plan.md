# Multi-Format Database Importer (.xlsx, .xls, .csv, .json) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มความสามารถในการนำเข้าไฟล์ฐานข้อมูลครุภัณฑ์จาก Microsoft Excel (.xlsx, .xls), CSV/TSV, และ JSON พร้อมระบบจับคู่คอลัมน์อัตโนมัติ (Smart Auto-Detection) และหน้าต่างตรวจสอบก่อนนำเข้า (Preview Modal)

**Architecture:** สร้างโมดูล `data-importer.js` จัดการแยกแยะไฟล์ สกัดหัวคอลัมน์ภาษาไทย/อังกฤษ ตรวจสอบความถูกต้อง แปลงข้อมูล (Normalization) และรวมข้อมูล (Smart Merge / Upsert) เชื่อมต่อกับ UI ใน `index.html`

**Tech Stack:** JavaScript (ES6+), SheetJS (xlsx CDN), HTML5 File API, Tailwind CSS, Lucide Icons

**Spec:** `docs/superpowers/specs/2026-11-11-multi-format-database-import-design.md`

## Global Constraints
- Platform: Zero-Build Client-side SPA
- Compatibility: รองรับทั้ง `.xlsx`, `.xls`, `.csv`, `.tsv`, และ `.json`
- Data Safety: ต้องมีหน้าต่าง Preview ให้ผู้ใช้ตรวจสอบจำนวนและตัวอย่างข้อมูลก่อนบันทึกจริงลงในฐานข้อมูล
- Non-Destructive Default: ค่าเริ่มต้นของการนำเข้าคือ "Smart Merge / Upsert" (ไม่ลบข้อมูลที่มีอยู่เดิม)

## Review Focus
1. **Spreadsheets with empty header rows or merged cells**: ตาราง Excel ของราชการมักมีหัวเรื่องเอกสาร 1-2 บรรทัดแรก ต้องตรวจจับแถวที่เป็นหัวคอลัมน์จริงได้อย่างถูกต้อง
2. **Exponential notation or formatted numbers in price column**: ตัวเลขราคาที่มีเครื่องหมายจุลภาค (เช่น `"24,900.00"`) หรือตัวเลขสไตล์ Excel ต้องแปลงเป็น Number ได้อย่างถูกต้อง
3. **Excel serial dates vs Thai Buddhist Era years**: วันที่ที่เป็นตัวเลข serial number ของ Excel (เช่น 44560) หรือ พ.ศ. (เช่น 2567) ต้องจัดรูปแบบเป็น YYYY-MM-DD ได้อย่างถูกต้อง
4. **Duplicate asset codes within the imported file**: หากในไฟล์ Excel มีรหัสครุภัณฑ์ซ้ำกัน ต้องจัดการไม่ให้เกิดข้อผิดพลาด
5. **Character encoding for Thai CSV**: ไฟล์ CSV ภาษาไทยที่บันทึกด้วย TIS-620 / ANSI หรือ UTF-8 พร้อม BOM ต้องอ่านภาษาไทยได้ไม่เป็นตัวอักษรต่างดาว

---

### Task 1: Data Importer Parsing & Normalization Engine (`data-importer.js`)

**Files:**
- Create: `data-importer.js`
- Create: `tests/test-data-importer.test.js`

**Interfaces:**
- Produces:
  - `DataImporter.detectColumns(headers: string[]) -> { codeKey: string, nameKey: string, priceKey: string, dateKey: string, deptKey: string, statusKey: string }`
  - `DataImporter.normalizeDate(val: any) -> string`
  - `DataImporter.normalizePrice(val: any) -> number`
  - `DataImporter.normalizeRows(rawRows: Array<object>, mapping?: object) -> Array<object>`
  - `DataImporter.parseJSON(text: string) -> Array<object>`
  - `DataImporter.mergeAssets(existingAssets: Array<object>, importedAssets: Array<object>, mode: 'merge'|'replace') -> { merged: Array<object>, addedCount: number, updatedCount: number }`

- [x] **Step 1: Write failing unit test for `data-importer.js`**

Write `tests/test-data-importer.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataImporter } from '../data-importer.js';

test('detectColumns correctly identifies Thai and English column variations', () => {
  const headersThai = ['ลำดับ', 'รหัสครุภัณฑ์', 'รายการครุภัณฑ์', 'ราคาจัดซื้อ', 'วันที่ได้มา', 'หน่วยงานที่ครอบครอง', 'สภาพ'];
  const mapping = DataImporter.detectColumns(headersThai);
  assert.equal(mapping.codeKey, 'รหัสครุภัณฑ์');
  assert.equal(mapping.nameKey, 'รายการครุภัณฑ์');
  assert.equal(mapping.priceKey, 'ราคาจัดซื้อ');
  assert.equal(mapping.dateKey, 'วันที่ได้มา');
  assert.equal(mapping.deptKey, 'หน่วยงานที่ครอบครอง');
  assert.equal(mapping.statusKey, 'สภาพ');
});

test('normalizePrice handles commas, currency symbols, and invalid strings', () => {
  assert.equal(DataImporter.normalizePrice('24,900.50'), 24900.5);
  assert.equal(DataImporter.normalizePrice(' 1,000,000 ฿ '), 1000000);
  assert.equal(DataImporter.normalizePrice(35000), 35000);
  assert.equal(DataImporter.normalizePrice(''), 0);
  assert.equal(DataImporter.normalizePrice(null), 0);
});

test('normalizeRows converts varied raw rows to standard asset structure', () => {
  const rawRows = [
    {
      'หมายเลขครุภัณฑ์': '6515-001-0001/1',
      'ชื่อรายการ': 'เครื่องช่วยหายใจ',
      'ราคา': '150,000',
      'วันที่': '2024-05-10',
      'แผนก': 'ICU',
      'สถานะ': 'ใช้งานปกติ'
    }
  ];
  const normalized = DataImporter.normalizeRows(rawRows);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].code, '6515-001-0001/1');
  assert.equal(normalized[0].name, 'เครื่องช่วยหายใจ');
  assert.equal(normalized[0].price, 150000);
  assert.equal(normalized[0].dept, 'ICU');
  assert.equal(normalized[0].status, 'ใช้งานปกติ');
});

test('mergeAssets in merge mode updates existing items and appends new ones', () => {
  const current = [
    { code: 'A1', name: 'Old Name 1', price: 1000, dept: 'OPD', status: 'ใช้งานปกติ' },
    { code: 'A2', name: 'Item 2', price: 2000, dept: 'IPD', status: 'ใช้งานปกติ' }
  ];
  const incoming = [
    { code: 'A1', name: 'Updated Name 1', price: 1500, dept: 'OPD', status: 'ใช้งานปกติ' },
    { code: 'A3', name: 'New Item 3', price: 3000, dept: 'COM', status: 'ใช้งานปกติ' }
  ];

  const result = DataImporter.mergeAssets(current, incoming, 'merge');
  assert.equal(result.merged.length, 3);
  assert.equal(result.updatedCount, 1);
  assert.equal(result.addedCount, 1);
  const a1 = result.merged.find(a => a.code === 'A1');
  assert.equal(a1.name, 'Updated Name 1');
  assert.equal(a1.price, 1500);
});

test('mergeAssets in replace mode completely overwrites existing dataset', () => {
  const current = [{ code: 'A1', name: 'Item 1' }];
  const incoming = [{ code: 'B1', name: 'New Set' }];
  const result = DataImporter.mergeAssets(current, incoming, 'replace');
  assert.equal(result.merged.length, 1);
  assert.equal(result.merged[0].code, 'B1');
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/test-data-importer.test.js`
Expected: FAIL with module not found.

- [x] **Step 3: Implement `data-importer.js`**

Implement `data-importer.js` with:
- `detectColumns(headers)` using regular expressions matching common Thai & English field aliases
- `normalizePrice(val)` and `normalizeDate(val)`
- `normalizeRows(rawRows, customMapping)`
- `parseJSON(text)`
- `mergeAssets(current, incoming, mode)`
- SheetJS integration helper `parseWorkbook(workbook)` to extract rows from the first sheet.

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/test-data-importer.test.js`
Expected: PASS all tests.

- [x] **Step 5: Commit Task 1**

```bash
git add data-importer.js tests/test-data-importer.test.js
git commit -m "feat: add data-importer module with smart column mapping and tests"
```

---

### Task 2: UI Integration in `index.html` (Preview Modal & Multi-Format Handler)

**Files:**
- Modify: `index.html`

- [x] **Step 1: Include `data-importer.js` module in `index.html`**

Load `data-importer.js` alongside existing modules.

- [x] **Step 2: Add `#importPreviewModal` to `index.html`**

Create modal containing:
- File metadata (file name, size, total rows detected)
- Column mapping feedback badge (แสดงคอลัมน์ที่ตรวจพบ: เลขครุภัณฑ์, ชื่อรายการ, ราคา, แผนก ฯลฯ)
- Table preview (3-5 sample rows)
- Import Mode Selection:
  - 🔘 **เพิ่มและอัปเดตต่อจากข้อมูลเดิม (Smart Merge / Upsert)** (Default)
  - 🔘 **แทนที่ฐานข้อมูลทั้งหมด (Replace All)**
- Action Buttons: "ยืนยันการนำเข้าข้อมูล" and "ยกเลิก"

- [x] **Step 3: Update Import Button and File Change Handler**

- Change `#csvFileInput` to `#databaseFileInput` with `accept=".xlsx,.xls,.csv,.tsv,.json"`
- Update button label to "นำเข้าข้อมูล (Excel / CSV / JSON)"
- Implement `handleDatabaseFileUpload(event)`:
  - If `.json`: parse with `DataImporter.parseJSON`
  - If `.xlsx` or `.xls`: read as ArrayBuffer, parse via `XLSX.read(data, { type: 'array' })`
  - If `.csv` or `.tsv`: read as text with UTF-8 / auto-detect, or parse via `XLSX.read`
  - Normalize rows, populate preview modal, and display preview.
- Implement `confirmDataImport()`:
  - Calls `DataImporter.mergeAssets(assetsData, pendingImportRows, selectedMode)`
  - Updates `assetsData`, `localStorage.setItem('nongchik_custom_assets', ...)`
  - Re-renders tables and KPIs
  - If Firebase connected, offers to upload/sync to Firestore.

- [x] **Step 4: Run test suite**

Run `npm test` and verify syntax.

- [x] **Step 5: Commit Task 2**

```bash
git add index.html
git commit -m "feat: integrate multi-format spreadsheet import UI and preview modal"
```

---

### Task 3: Deploy to Firebase Hosting and Verify in Browser

- [x] **Step 1: Deploy to Firebase Hosting**

Run `firebase deploy --only hosting --project nongchik-asset-app`

- [x] **Step 2: Smoke test live site with Browser Subagent**

Verify the live site loads and the new "นำเข้าข้อมูล (Excel / CSV / JSON)" button is active.
