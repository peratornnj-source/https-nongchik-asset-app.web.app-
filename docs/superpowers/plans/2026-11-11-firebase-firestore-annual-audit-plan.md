# Firebase Firestore Real-Time Sync & Annual Audit Government Report Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เชื่อมต่อระบบบริหารงานพัสดุ รพ.หนองจิก เข้ากับ Firebase Firestore แบบ Real-time Multi-user และสร้างระบบตรวจนับพัสดุประจำปีพร้อมออกรายงานราชการมาตรฐาน (A4 PDF & Excel) ตามระเบียบกระทรวงการคลังฯ พ.ศ. 2560 ข้อ 213

**Architecture:** สถาปัตยกรรม Client-side Single Page Application (Zero-Build) โดยแยกโมดูลอย่างชัดเจน: `firebase-bridge.js` จัดการเชื่อมต่อ Firestore/IndexedDB Offline และ Fallback, `audit-engine.js` ควบคุม State เครื่องสแกนแบบต่อเนื่องและกระทบยอดตรวจนับ, `report-generator.js` จัดฟอร์แมตเอกสารราชการและสร้างไฟล์ Excel/Print Layout เชื่อมต่อกับ UI ใน `index.html`

**Tech Stack:** HTML5, Vanilla JavaScript (ES6+), Firebase SDK v10 (Firestore/App), SheetJS (xlsx CDN), Web Audio API (Beep feedback), Tailwind CSS, Lucide Icons

**Spec:** `docs/superpowers/specs/2026-11-11-firebase-firestore-annual-audit-design.md`

## Global Constraints

- Platform: Zero-Build Client-side SPA รันได้โดยตรงบนเว็บเบราว์เซอร์มาตรฐานโดยไม่ต้องพึ่งพา Node.js build step ในเวลาใช้งาน
- Fallback: หากยังไม่ได้ตั้งค่า Firebase Config ระบบต้อง Fallback มาทำงานบน `localStorage` ได้ 100% โดยไม่มี Runtime Error
- Regulatory Compliance: โครงสร้างรายงานตรวจนับต้องสอดคล้องกับระเบียบกระทรวงการคลังว่าด้วยการจัดซื้อจัดจ้างและการบริหารพัสดุภาครัฐ พ.ศ. 2560 ข้อ 213
- Concurrency & Offline: เปิด IndexedDB Persistence รองรับการใช้งานออฟไลน์ และใช้ Last-Write-Wins บันทึกชื่อผู้ตรวจนับและเวลาล่าสุด

## Review Focus

1. **Unscanned items misreported as lost**: ระหว่างตรวจนับ ของที่ยังไม่สแกนต้องมีสถานะเป็น `pending` และไม่ถูกรายงานว่าเป็น "สูญไป" ในสรุปผลราชการจนกว่ากรรมการจะยืนยันในหน้ารวมกระทบยอด
2. **Disposed assets distorting audit valuation**: ครุภัณฑ์ที่มีสถานะ `จำหน่ายแล้ว/ยกเลิกการใช้` ในปีก่อนต้องถูกคัดออกจากฐานตัวหาร (Denominator) การตรวจนับตั้งแต่แรก
3. **Network disconnection during hospital walk**: เมื่อเจ้าหน้าที่เดินเข้าจุดอับสัญญาณในวอร์ด การสแกนยังต้องทำงานต่อเนื่องใน IndexedDB/Local cache และไม่ขึ้นแจ้งเตือนข้อผิดพลาดค้างหน้าจอ
4. **Special characters in Asset Code as Document ID**: รหัสครุภัณฑ์ที่มีเครื่องหมายทับ เช่น `6515-070-0002/22` ต้องถูก sanitize ให้เป็น ID ที่ปลอดภัยใน Firestore (เช่น แทนที่ `/` ด้วย `_`) เพื่อป้องกัน URL path error ใน Firestore SDK
5. **Print page break splitting tables in PDF**: ตารางรายการครุภัณฑ์ชำรุดในรายงาน PDF A4 ต้องมี CSS `page-break-inside: avoid` เพื่อไม่ให้แถวตารางหรือช่องลงนามขาดตอนข้ามหน้า

---

### Task 1: Firebase Bridge & Real-Time Sync Module (`firebase-bridge.js`)

**Files:**
- Create: `firebase-bridge.js`
- Create: `tests/test-firebase-bridge.test.js`

**Interfaces:**
- Produces:
  - `FirebaseBridge.sanitizeCode(code: string) -> string`
  - `FirebaseBridge.parseConfig(configInput: string | object) -> object | null`
  - `FirebaseBridge.init(config: object, options?: { enablePersistence: boolean }) -> Promise<boolean>`
  - `FirebaseBridge.getStatus() -> 'connected' | 'offline_cached' | 'local_storage'`
  - `FirebaseBridge.seedInitialAssets(assetsArray: Array<object>) -> Promise<{ total: number, inserted: number }>`
  - `FirebaseBridge.subscribeAssets(callback: (assets: Array<object>) => void) -> () => void`
  - `FirebaseBridge.subscribeAuditRound(fiscalYear: string, callback: (roundData: object) => void) -> () => void`
  - `FirebaseBridge.saveAuditItem(fiscalYear: string, assetCode: string, itemData: object) -> Promise<void>`
  - `FirebaseBridge.saveTicket(ticket: object) -> Promise<void>`
  - `FirebaseBridge.saveTransfer(transfer: object) -> Promise<void>`

- [ ] **Step 1: Write failing unit test for `firebase-bridge.js` helper methods**

Write `tests/test-firebase-bridge.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FirebaseBridge } from '../firebase-bridge.js';

test('sanitizeCode replaces forward slashes with underscores', () => {
  assert.equal(FirebaseBridge.sanitizeCode('6515-070-0002/22'), '6515-070-0002_22');
  assert.equal(FirebaseBridge.sanitizeCode('7440-001-0005/100'), '7440-001-0005_100');
});

test('parseConfig handles valid JSON string, JS object snippet, and invalid inputs', () => {
  const jsonStr = '{"apiKey": "AIzaSyFakeKey", "projectId": "nongchik-pms"}';
  const parsed = FirebaseBridge.parseConfig(jsonStr);
  assert.equal(parsed.projectId, 'nongchik-pms');

  const jsSnippet = 'const firebaseConfig = { apiKey: "AIza123", projectId: "test-proj" };';
  const parsedSnippet = FirebaseBridge.parseConfig(jsSnippet);
  assert.equal(parsedSnippet.projectId, 'test-proj');

  assert.equal(FirebaseBridge.parseConfig('invalid plain string'), null);
});

test('fallback to localStorage when Firebase is not configured', async () => {
  FirebaseBridge.reset();
  assert.equal(FirebaseBridge.getStatus(), 'local_storage');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/test-firebase-bridge.test.js`
Expected: FAIL with module not found or functions not defined.

- [ ] **Step 3: Implement `firebase-bridge.js`**

Implement `firebase-bridge.js` with:
- `sanitizeCode(code)`: replaces `/` with `_` and handles empty strings.
- `parseConfig(input)`: parses JSON or regex extracts `{ ... }` from JS config snippets paste.
- Connection state tracker (`'connected'`, `'offline_cached'`, `'local_storage'`).
- Compatibility wrapper for Firebase Firestore SDK (supports modular or compat SDK loaded via window.firebase or window.FirebaseFirestore).
- Storage operations for `assets`, `tickets`, `transfers`, and `annual_audits` with graceful fallback to `localStorage`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/test-firebase-bridge.test.js`
Expected: PASS all tests.

- [ ] **Step 5: Commit Task 1**

```bash
git add firebase-bridge.js tests/test-firebase-bridge.test.js
git commit -m "feat: add firebase-bridge module with offline fallback and tests"
```

---

### Task 2: Annual Audit State & Reconciliation Engine (`audit-engine.js`)

**Files:**
- Create: `audit-engine.js`
- Create: `tests/test-audit-engine.test.js`

**Interfaces:**
- Consumes: `FirebaseBridge.sanitizeCode`
- Produces:
  - `AuditEngine.createRound(fiscalYear: string, orderNo: string, orderDate: string, committee: Array<object>) -> object`
  - `AuditEngine.filterActiveAssets(allAssets: Array<object>) -> Array<object>` (excludes `จำหน่ายแล้ว/ยกเลิกการใช้`)
  - `AuditEngine.recordScan(round: object, assetCode: string, auditorName: string, condition?: string, notes?: string) -> { round: object, item: object, isNewScan: boolean }`
  - `AuditEngine.computeSummary(round: object, activeAssets: Array<object>) -> object` (calculates totalActive, scannedCount, pendingCount, condition breakdown, total valuation)
  - `AuditEngine.getPendingAssetsByDept(round: object, activeAssets: Array<object>) -> Map<string, Array<object>>`
  - `AuditEngine.markExplicitLost(round: object, assetCode: string, auditorName: string, reason: string) -> object`
  - `AuditEngine.finalizeRound(round: object) -> object` (sets status to 'finalized' and locks)
  - `AuditEngine.generateMasterUpdates(round: object, activeAssets: Array<object>) -> Array<{ code: string, oldStatus: string, newStatus: string }>`

- [ ] **Step 1: Write failing unit test for `audit-engine.js`**

Write `tests/test-audit-engine.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditEngine } from '../audit-engine.js';

test('filterActiveAssets excludes disposed items from audit denominator', () => {
  const assets = [
    { code: 'A1', name: 'Com 1', price: 10000, status: 'ใช้งานปกติ' },
    { code: 'A2', name: 'Com 2', price: 20000, status: 'จำหน่ายแล้ว/ยกเลิกการใช้' },
    { code: 'A3', name: 'Com 3', price: 15000, status: 'รอจำหน่าย' }
  ];
  const active = AuditEngine.filterActiveAssets(assets);
  assert.equal(active.length, 2);
  assert.equal(active.some(a => a.code === 'A2'), false);
});

test('fast continuous scan auto-records item as normal', () => {
  let round = AuditEngine.createRound('2569', '125/2569', '2026-09-15', []);
  const result = AuditEngine.recordScan(round, 'A1', 'นายสมชาย (OPD)');
  assert.equal(result.item.condition, 'normal');
  assert.equal(result.item.auditorName, 'นายสมชาย (OPD)');
  assert.equal(result.isNewScan, true);
  assert.equal(round.items['A1'].condition, 'normal');
});

test('computeSummary correctly computes percentages and excludes pending from lost', () => {
  const activeAssets = [
    { code: 'A1', name: 'Com 1', price: 10000, dept: 'OPD', status: 'ใช้งานปกติ' },
    { code: 'A2', name: 'Com 2', price: 20000, dept: 'IPD', status: 'ใช้งานปกติ' },
    { code: 'A3', name: 'Com 3', price: 30000, dept: 'OPD', status: 'ใช้งานปกติ' }
  ];
  let round = AuditEngine.createRound('2569', '125/2569', '2026-09-15', []);
  round = AuditEngine.recordScan(round, 'A1', 'Auditor 1', 'normal').round;
  round = AuditEngine.recordScan(round, 'A2', 'Auditor 2', 'damaged_repairable').round;

  const summary = AuditEngine.computeSummary(round, activeAssets);
  assert.equal(summary.totalCount, 3);
  assert.equal(summary.scannedCount, 2);
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.normalCount, 1);
  assert.equal(summary.damagedRepairableCount, 1);
  assert.equal(summary.lostCount, 0); // Unscanned A3 must NOT be counted as lost!
});

test('finalized round rejects further scans', () => {
  let round = AuditEngine.createRound('2569', '125/2569', '2026-09-15', []);
  round = AuditEngine.finalizeRound(round);
  assert.throws(() => {
    AuditEngine.recordScan(round, 'A1', 'Auditor');
  }, /locked|finalized/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/test-audit-engine.test.js`
Expected: FAIL with module not found or functions not defined.

- [ ] **Step 3: Implement `audit-engine.js`**

Implement `audit-engine.js` with:
- Round creation and committee configuration
- Active assets filtering (`status !== 'จำหน่ายแล้ว/ยกเลิกการใช้'`)
- Fast continuous scan recording with condition defaulting to `normal`
- Reconciliation summary generator (totals, percentages, values per condition)
- Departmental pending list aggregator
- Explicit marking of items as `lost`
- Finalization lock and master updates generator.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/test-audit-engine.test.js`
Expected: PASS all tests.

- [ ] **Step 5: Commit Task 2**

```bash
git add audit-engine.js tests/test-audit-engine.test.js
git commit -m "feat: add audit-engine state and reconciliation module with tests"
```

---

### Task 3: Government Compliance Report Engine & Exporters (`report-generator.js`)

**Files:**
- Create: `report-generator.js`
- Create: `tests/test-report-generator.test.js`

**Interfaces:**
- Consumes: `AuditEngine.computeSummary`, `AuditEngine.getPendingAssetsByDept`
- Produces:
  - `ReportGenerator.buildStatutoryReportData(round: object, activeAssets: Array<object>) -> object`
  - `ReportGenerator.renderPrintableHTML(reportData: object) -> string`
  - `ReportGenerator.generateExcelWorkbook(reportData: object) -> object` (SheetJS workbook ready for `XLSX.writeFile`)

- [ ] **Step 1: Write failing unit test for `report-generator.js`**

Write `tests/test-report-generator.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditEngine } from '../audit-engine.js';
import { ReportGenerator } from '../report-generator.js';

test('buildStatutoryReportData references Regulation Clause 213 and committee structure', () => {
  const activeAssets = [
    { code: 'A1', name: 'Com 1', price: 10000, date: '2020-01-01', dept: 'OPD', status: 'ใช้งานปกติ' },
    { code: 'A2', name: 'Bed 2', price: 50000, date: '2021-01-01', dept: 'IPD', status: 'ใช้งานปกติ' }
  ];
  let round = AuditEngine.createRound('2569', 'คำสั่งที่ 125/2569', '15 กันยายน 2569', [
    { name: 'นพ.วิชาญ', position: 'นายแพทย์ชำนาญการพิเศษ', role: 'ประธานกรรมการ' },
    { name: 'นางมาลี', position: 'พยาบาลวิชาชีพ', role: 'กรรมการ' },
    { name: 'นายสมศักดิ์', position: 'เจ้าพนักงานพัสดุ', role: 'กรรมการและเลขานุการ' }
  ]);
  round = AuditEngine.recordScan(round, 'A1', 'สมศักดิ์', 'normal').round;
  round = AuditEngine.recordScan(round, 'A2', 'สมศักดิ์', 'deteriorated_unusable', 'มอเตอร์ไหม้ ซ่อมไม่คุ้ม').round;

  const reportData = ReportGenerator.buildStatutoryReportData(round, activeAssets);
  assert.equal(reportData.fiscalYear, '2569');
  assert.equal(reportData.orderNo, 'คำสั่งที่ 125/2569');
  assert.equal(reportData.defectiveItems.length, 1);
  assert.equal(reportData.defectiveItems[0].code, 'A2');
  assert.equal(reportData.committee.length, 3);
});

test('renderPrintableHTML produces compliant HTML with print break CSS and signature block', () => {
  const mockReportData = {
    fiscalYear: '2569',
    orderNo: '125/2569',
    orderDate: '15 ก.ย. 2569',
    hospitalName: 'โรงพยาบาลหนองจิก',
    summary: { totalCount: 2, normalCount: 1, damagedRepairableCount: 0, deterioratedUnusableCount: 1, lostCount: 0, totalValue: 60000 },
    defectiveItems: [{ no: 1, code: 'A2', name: 'Bed 2', dept: 'IPD', price: 50000, conditionLabel: 'ชำรุดไม่คุ้มค่าซ่อม (เสนอจำหน่าย)', notes: 'มอเตอร์ไหม้' }],
    committee: [
      { name: 'นพ.วิชาญ', role: 'ประธานกรรมการ', position: 'นายแพทย์ชำนาญการพิเศษ' }
    ]
  };
  const html = ReportGenerator.renderPrintableHTML(mockReportData);
  assert.match(html, /รายงานผลการตรวจสอบพัสดุประจำปี/);
  assert.match(html, /ระเบียบกระทรวงการคลังว่าด้วยการจัดซื้อจัดจ้าง/);
  assert.match(html, /page-break-inside:\s*avoid/);
  assert.match(html, /ประธานกรรมการ/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/test-report-generator.test.js`
Expected: FAIL with module not found or functions not defined.

- [ ] **Step 3: Implement `report-generator.js`**

Implement `report-generator.js` with:
- Formal report data mapper matching Thai government procurement format
- A4 HTML Template with official government margins, Sarabun font, clear table borders, and `@media print` rules
- Excel sheet structure with summary tab and detailed defective/lost assets tab with proper number formatting.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/test-report-generator.test.js`
Expected: PASS all tests.

- [ ] **Step 5: Commit Task 3**

```bash
git add report-generator.js tests/test-report-generator.test.js
git commit -m "feat: add statutory annual audit report generator and Excel exporter"
```

---

### Task 4: UI Integration in `index.html` & End-to-End Verification

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Include Firebase SDKs, SheetJS, and newly created modules in `index.html`**

Add scripts:
- Firebase 10.x SDK (firebase-app-compat, firebase-firestore-compat) via CDN
- SheetJS (`xlsx.full.min.js`) via CDN for Excel export
- Script tags for `firebase-bridge.js`, `audit-engine.js`, `report-generator.js`

- [ ] **Step 2: Add Cloud Connection Status Pill & One-Click Cloud Seed in Header & Firebase Modal**

- Add status pill in top navigation:
  - 🟢 คลาวด์ออนไลน์ (Firestore Real-time)
  - 🟡 ออฟไลน์แคช (IndexedDB Cache)
  - ⚪ LocalStorage (โหมดในเครื่อง)
- In `openFirebaseModal`:
  - Show connection status
  - Add button "นำเข้าข้อมูลครุภัณฑ์ 600+ รายการขึ้น Cloud" (`syncAllToCloud`) using `FirebaseBridge.seedInitialAssets(assetsData)` with progress indicator.

- [ ] **Step 3: Upgrade Annual Audit Tab (`#auditView`) in `index.html`**

Enhance `#auditView` with:
- Active Fiscal Year Round Banner (ปีงบประมาณ, เลขที่คำสั่ง, รายชื่อกรรมการ, สถานะเปิด/ปิดรอบ)
- Fast Continuous Scan Mode:
  - Toggle "โหมดสแกนรวดเร็ว (Fast Scan - บันทึกปกติทันที)"
  - Web Audio API synthesized pleasant Beep sound on successful scan
  - Last scanned item card with quick "เปลี่ยนสภาพ (ชำรุด/หมายเหตุ)" button
- Live Progress Cards:
  - ตรวจนับแล้ว / คงเหลือ (Progress Bar)
  - สรุป 4 สภาพ (ปกติ / ชำรุดซ่อมได้ / ชำรุดจำหน่าย / สูญไป)
- Reconciliation Sub-tab (รายการตกสำรวจ / ยังไม่ได้ตรวจนับ):
  - Filter by department
  - Action button "ระบุเป็นสูญไป/หาไม่พบ"
- Action Toolbar:
  - ปุ่ม "ออกรายงานราชการ (ระเบียบข้อ 213)" -> Opens Report Preview Modal with "พิมพ์ A4 / บันทึก PDF" and "ส่งออก Excel"
  - ปุ่ม "ปิดรอบและปรับปรุงสถานะบัญชีหลัก" -> Confirms and updates master `assets`

- [ ] **Step 4: Test UI functionality end-to-end**

Run browser check or headless load check to verify:
- No console errors on initialization
- LocalStorage fallback operates cleanly when Firebase is not yet connected
- Fast scan registers items, plays beep, and updates live count
- Report modal opens and renders official government template properly
- Excel export button triggers workbook creation.

- [ ] **Step 5: Commit Task 4**

```bash
git add index.html
git commit -m "feat: complete UI integration for Firebase sync, fast audit scan, and government report"
```
