# MOPH Government Asset Management System Full Upgrade (Phase 1–3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Nongchik Hospital Asset Management System (`nongchik-asset-app.web.app`) to full Thai Ministry of Public Health (MOPH) government compliance across asset register & depreciation, Firebase Auth RBAC & audit logging, statutory disposal workflow (Clause 215–218), official A4 print forms, hospital maintenance/PM/calibration (HA), and Firebase Storage photo/document evidence.

**Architecture:** Zero-build Vanilla ES Modules running in the browser with Firebase 10.13.0 Compat SDK (App, Auth, Firestore, Storage) and full `localStorage` fallback. All domain logic lives in pure, testable ES modules verified by Node's built-in test runner (`node --test tests/*.test.js`), while `index.html` wires UI views, modals, and real-time listeners.

**Tech Stack:** HTML5, Vanilla JavaScript (ES Modules), Tailwind CSS CDN, Lucide Icons, SheetJS, Firebase 10.13.0 Compat SDK (`firebase-app`, `firebase-auth`, `firebase-firestore`, `firebase-storage`), Node.js `node:test` + `node:assert`.

**Spec:** `docs/superpowers/specs/2026-11-20-moph-government-asset-upgrade-design.md`

## Global Constraints
- Zero-build static SPA: must work directly on Firebase Hosting (`firebase.json` `public: "."`) without bundlers or backend servers.
- Backward compatibility: all 845 existing assets in `assets-data.js` (6 fields: `code`, `name`, `price`, `date`, `dept`, `status`) and existing CSV/Excel imports must work seamlessly without migration breakage.
- Soft disposal only: disposed assets must never be hard-deleted; status transitions to `จำหน่ายแล้ว` with `disposalId` reference preserved.
- Local fallback: if Firebase Auth or Storage is not yet enabled in Console or device is offline, app must degrade gracefully to local demo/offline mode without crashing.
- Test suite: `npm test` (`node --test tests/*.test.js`) must pass 100% after every task.

## Review Focus
- Legacy 6-field assets with missing `date`, `price: 0`, or invalid date string passed to depreciation calculation must return safe zeroed/default values rather than `NaN`.
- Assets with forward slashes in `code` (e.g., `7440-001-0005/56`) must be safely sanitized in Firestore document IDs and Storage paths.
- Role enforcement must block unauthorized UI actions (`dept_user` cannot edit master assets, finalize audits, or approve disposals) AND match `firestore.rules` / `storage.rules` server-side.
- Disposal state machine must prevent skipping required statutory steps (e.g., cannot jump `draft` directly to `completed` without `committee_review` and `approved`) and must refuse disposing an already-disposed asset.
- Repair cost ratio calculation must guard against `price <= 0` (no `Infinity` / `NaN` division-by-zero) and accurately trigger uneconomical alerts at `>= 50%` or `>= 3` repairs within 365 days.

---

### Task 1: Asset Register Normalization, Depreciation Engine & 13-Digit Code Generator

**Files:**
- Create: `depreciation-engine.js`
- Create: `tests/test-depreciation-engine.test.js`

**Interfaces:**
- Produces (named export `DepreciationEngine`):
  - `getDefaultUsefulLife(code: string) -> number` (returns years: `7440` -> 3; `6515`/`6520`/`6525`/`7110`/`7490`/`4110`/`4120`/`2310`/`2320` -> 5; fallback -> 5)
  - `normalizeAssetRecord(raw: object) -> object` (ensures all ผท. fields exist with safe defaults while preserving existing 6 fields)
  - `calculateDepreciation(asset: object, asOfDate?: string | Date) -> { purchasePrice, usefulLifeYears, salvageValue, ageYears, annualDepreciation, accumulatedDepreciation, netBookValue, isFullyDepreciated }`
  - `generateNextAssetCode(categoryPrefix: string, existingAssets: Array<object>, fiscalYearBE?: number) -> string` (format `XXXX-XXX-NNNN/YY`, e.g., `7440-001-0001/69`)
  - `buildAssetTimeline(asset: object, transfers?: Array, tickets?: Array, audits?: Array, disposals?: Array) -> Array<{ date, type, title, detail, actor }>` (sorted newest-first)

- [ ] **Step 1: Write failing tests in `tests/test-depreciation-engine.test.js`**
  - Test `getDefaultUsefulLife` for `7440-001-0005/56` (3), `6515-070-0002/22` (5), unknown prefix (5).
  - Test `calculateDepreciation` mid-life (e.g., 30,000 THB, 3 years, after 1 year -> annual 9,999.67, NBV ~20,000.33), fully depreciated (>= useful life -> NBV equals salvageValue `1` THB, `isFullyDepreciated: true`), and legacy/invalid input (`price: 0`, missing `date` -> no `NaN`, NBV `0`).
  - Test `generateNextAssetCode` increments sequence past existing codes sharing the same prefix and fiscal year suffix.
  - Test `normalizeAssetRecord` fills defaults (`fundSource: 'ไม่ระบุ'`, `salvageValue: 1`, `usefulLifeYears`, `isMedicalDevice` auto-detected for `65xx` prefix).
  - Test `buildAssetTimeline` merges acquisition, transfer, repair, audit, and disposal events sorted descending by date.
- [ ] **Step 2: Run `node --test tests/test-depreciation-engine.test.js` and verify FAIL**
- [ ] **Step 3: Implement `depreciation-engine.js`**
  - Straight-line formula: `depreciableBase = Math.max(0, price - salvageValue)`, `annual = depreciableBase / usefulLifeYears`, `accumulated = Math.min(depreciableBase, annual * elapsedYears)`, `nbv = price > 0 ? Math.max(salvageValue, price - accumulated) : 0` (rounded to 2 decimals).
  - When `price <= salvageValue`, `nbv = price`, `accumulated = 0`.
- [ ] **Step 4: Run `npm test` and verify PASS**
- [ ] **Step 5: Commit (`feat: add government asset depreciation engine, normalizer, and timeline builder`)**

---

### Task 2: Firebase Auth RBAC & Audit Trail Module

**Files:**
- Create: `auth-rbac.js`
- Create: `tests/test-auth-rbac.test.js`

**Interfaces:**
- Produces (named exports `ROLES`, `PERMISSIONS`, `AuthRBAC`, `AuditLogger`):
  - `ROLES`: `{ admin, auditor, dept_user, technician, executive }` with Thai labels and badge styles.
  - `AuthRBAC.can(role: string, permission: string) -> boolean`
  - `AuthRBAC.getRolePermissions(role: string) -> string[]`
  - `AuthRBAC.resolveBootstrapRole(existingUsersCount: number, requestedRole?: string) -> string` (returns `'admin'` if `existingUsersCount === 0`, else `requestedRole || 'dept_user'`)
  - `AuthRBAC.filterAssetsForUser(assets: Array, user: object) -> Array` (`dept_user` sees their dept by default or flagged view; other roles see all)
  - `AuthRBAC.initFirebaseAuth(onStateChange) -> boolean` (attaches `firebase.auth().onAuthStateChanged` if SDK loaded, otherwise returns `false`)
  - `AuthRBAC.signInWithEmail(email, password)`, `AuthRBAC.registerWithEmail(email, password, profile)`, `AuthRBAC.signOut()`
  - `AuditLogger.createEntry({ actor, action, targetType, targetId, summary, changes }) -> object` (normalized log entry with ISO timestamp and unique `id`)
  - `AuditLogger.filterLogs(logs: Array, filters: { action?, targetType?, query? }) -> Array`

- [ ] **Step 1: Write failing tests in `tests/test-auth-rbac.test.js`**
  - Verify permission matrix for all 5 roles:
    - `admin`: all permissions (`asset:write`, `asset:import`, `audit:scan`, `audit:finalize`, `disposal:manage`, `disposal:approve`, `transfer:manage`, `repair:manage`, `pm:manage`, `user:manage`, `auditlog:view`)
    - `auditor`: `audit:scan`, `audit:report`, cannot `asset:write` or `user:manage` or `disposal:approve`
    - `dept_user`: `transfer:request`, `repair:request`, cannot `asset:write`, `audit:finalize`, `disposal:manage`
    - `technician`: `repair:manage`, `pm:manage`, cannot `asset:write`, `disposal:approve`, `user:manage`
    - `executive`: `dashboard:executive`, `disposal:approve`, `auditlog:view`, cannot `asset:write` or `user:manage`
  - Verify `resolveBootstrapRole(0)` returns `'admin'`, while `resolveBootstrapRole(3)` returns `'dept_user'`.
  - Verify `AuditLogger.createEntry` populates `id`, `timestamp`, `actorUid`, `actorName`, `actorRole`, `action`, `targetType`, `targetId`, `summary`.
  - Verify `AuditLogger.filterLogs` filters by `action`, `targetType`, and Thai keyword `query`.
- [ ] **Step 2: Run `node --test tests/test-auth-rbac.test.js` and verify FAIL**
- [ ] **Step 3: Implement `auth-rbac.js`**
- [ ] **Step 4: Run `npm test` and verify PASS**
- [ ] **Step 5: Commit (`feat: add 5-role Firebase Auth RBAC engine and audit logger`)**

---

### Task 3: Security Rules (`firestore.rules`, `storage.rules`) & `FirebaseBridge` Extensions

**Files:**
- Create: `firestore.rules`
- Create: `storage.rules`
- Modify: `firebase.json`
- Modify: `firebase-bridge.js`
- Modify: `tests/test-firebase-bridge.test.js`

**Interfaces:**
- Produces (additional methods on `FirebaseBridge`):
  - `saveUserProfile(uid, profile) -> Promise<boolean>`
  - `getUserProfile(uid) -> Promise<object|null>`
  - `listUserProfiles() -> Promise<Array>`
  - `appendAuditLog(entry) -> Promise<boolean>`
  - `listenAuditLogs(callback, limitCount?) -> Function`
  - `saveDisposal(disposal) -> Promise<boolean>`
  - `listenDisposals(callback) -> Function`
  - `savePmSchedule(schedule) -> Promise<boolean>`
  - `listenPmSchedules(callback) -> Function`

- [ ] **Step 1: Add failing tests in `tests/test-firebase-bridge.test.js`**
  - Verify all new `FirebaseBridge` methods exist and safely resolve/fallback in localStorage mode when Firebase is not connected.
  - Verify `firestore.rules` and `storage.rules` files exist and contain role helper rules for `admin`, `auditor`, `technician`, `executive`, and `dept_user`.
- [ ] **Step 2: Run `node --test tests/test-firebase-bridge.test.js` and verify FAIL**
- [ ] **Step 3: Implement `firestore.rules`, `storage.rules`, update `firebase.json`, and extend `firebase-bridge.js`**
  - `firestore.rules`: helper `isSignedIn()`, `getUserRole()`, `hasRole(roles)`. Protect `assets` (write: `admin`), `users` (read self or `admin`; write: `admin` or bootstrap first user), `audit_logs` (create: signed-in; read: `admin`/`executive`; update/delete: false — immutable!), `disposals` (write: `admin`/`executive`), `pm_schedules` (write: `admin`/`technician`), `tickets` (create: signed-in; update: `admin`/`technician`), `transfers` (create: signed-in; update: `admin`), `annual_audits` (write: `admin`/`auditor`).
  - `storage.rules`: authenticated read; size limit <= 5MB and image/pdf contentType check; write scoped by path (`assets/**` -> `admin`, `audits/**` -> `admin`/`auditor`, `pm/**` -> `admin`/`technician`, `disposals/**` -> `admin`).
- [ ] **Step 4: Run `npm test` and verify PASS**
- [ ] **Step 5: Commit (`feat: add Firestore/Storage RBAC security rules and extend FirebaseBridge collections`)**

---

### Task 4: Statutory Disposal Workflow Engine (Regulation Clauses 215–218)

**Files:**
- Create: `disposal-engine.js`
- Create: `tests/test-disposal-engine.test.js`

**Interfaces:**
- Produces (named exports `DISPOSAL_METHODS`, `DISPOSAL_STATUSES`, `DisposalEngine`):
  - `DISPOSAL_METHODS`: `{ auction, exchange, transfer, destroy, write_off }` with Thai statutory labels.
  - `DISPOSAL_STATUSES`: `['draft', 'committee_review', 'approved', 'completed']`.
  - `DisposalEngine.extractCandidates(assets, auditRound?, tickets?) -> Array` (finds non-disposed items marked `ชำรุด/รอจำหน่าย`, `สูญหาย`, or flagged `damaged_unrepairable`/`lost` in audit, or exceeding repair threshold).
  - `DisposalEngine.createDisposalRequest({ fiscalYear, method, reason, items, createdBy, existingDisposals }) -> object` (auto-generates `disposalNo` e.g. `จห.2569/001`, rejects already-disposed items).
  - `DisposalEngine.transitionStatus(disposal, nextStatus, metadata) -> object` (enforces strict sequential flow `draft -> committee_review -> approved -> completed`; requires `committeeOrderNo` for `committee_review` and `approvedBy` for `approved`).
  - `DisposalEngine.buildMasterDisposalPatches(disposal) -> Array<{ code, status: 'จำหน่ายแล้ว', disposalId, disposedAt, disposalMethod }>` (only valid when `disposal.status === 'completed'`).

- [ ] **Step 1: Write failing tests in `tests/test-disposal-engine.test.js`**
  - Test `extractCandidates` excludes already-disposed assets and captures audit `damaged_unrepairable` / `lost` items.
  - Test `createDisposalRequest` generates sequential `disposalNo` and rejects disposed items.
  - Test `transitionStatus` allows valid transitions, blocks skipping (`draft -> completed` throws), and requires `committeeOrderNo` / `approvedBy`.
  - Test `buildMasterDisposalPatches` produces soft-disposal updates (`status: 'จำหน่ายแล้ว'`, `disposalId`) only when completed.
- [ ] **Step 2: Run `node --test tests/test-disposal-engine.test.js` and verify FAIL**
- [ ] **Step 3: Implement `disposal-engine.js`**
- [ ] **Step 4: Run `npm test` and verify PASS**
- [ ] **Step 5: Commit (`feat: add statutory disposal workflow engine per Regulation Clauses 215-218`)**

---

### Task 5: Official Thai Government A4 Print Forms Generator

**Files:**
- Create: `gov-forms.js`
- Create: `tests/test-gov-forms.test.js`

**Interfaces:**
- Consumes: `DepreciationEngine.calculateDepreciation`
- Produces (named export `GovForms`):
  - `renderAssetRegisterCard(asset, depreciation, history?) -> string` (ทะเบียนคุมทรัพย์สิน แบบ ผท. — A4 HTML with acquisition, fund source, depreciation table, signature lines)
  - `renderTransferOrBorrowForm(transfer, asset) -> string` (ใบโอนย้ายครุภัณฑ์ / ใบยืม-คืนครุภัณฑ์ — A4 HTML with sender, receiver, asset officer, director signature blocks)
  - `renderAnnualAuditMemo(auditRound, reportData) -> string` (บันทึกข้อความรายงานผลการตรวจสอบพัสดุประจำปี เสนอผู้อำนวยการ ตามข้อ 213 — official Garuda-header Thai memo layout with summary table & committee signatures)
  - `renderDisposalRequestForm(disposal) -> string` (แบบขออนุมัติจำหน่ายพัสดุ ตามข้อ 215–218 — A4 HTML with itemized NBV table, method, committee & director approval blocks)

- [ ] **Step 1: Write failing tests in `tests/test-gov-forms.test.js`**
  - Test each of the 4 renderers returns complete printable HTML with `@page`, Thai official titles (`ทะเบียนคุมทรัพย์สิน`, `ใบโอนย้ายครุภัณฑ์` / `ใบยืม-คืนครุภัณฑ์`, `บันทึกข้อความ`, `ขออนุมัติจำหน่ายพัสดุ`), escaped user text (XSS-safe), and signature blocks.
- [ ] **Step 2: Run `node --test tests/test-gov-forms.test.js` and verify FAIL**
- [ ] **Step 3: Implement `gov-forms.js`**
- [ ] **Step 4: Run `npm test` and verify PASS**
- [ ] **Step 5: Commit (`feat: add official Thai government A4 print forms generator`)**

---

### Task 6: Hospital Maintenance, Repair Cost Alert & PM/Calibration Engine (HA)

**Files:**
- Create: `maintenance-engine.js`
- Create: `tests/test-maintenance-engine.test.js`

**Interfaces:**
- Produces (named export `MaintenanceEngine`):
  - `DEFAULT_THRESHOLDS`: `{ costRatioPercent: 50, maxRepairsPerYear: 3, pmDueSoonDays: 30 }`
  - `evaluateRepairEconomics(asset, tickets, thresholds?) -> { totalRepairCost, repairCount, repairsLast12Months, costRatioPercent, isUneconomical, reasons: string[] }`
  - `calculateNextDueDate(lastDoneDate: string, intervalMonths: number) -> string` (`YYYY-MM-DD`)
  - `classifyPmStatus(schedule, today?: string | Date, dueSoonDays?: number) -> { status: 'overdue' | 'due_soon' | 'normal', daysRemaining: number }`
  - `summarizePmCompliance(schedules, today?) -> { total, overdue, dueSoon, normal, compliancePercent }`
  - `findOverdueBorrows(transfers, today?) -> Array` (unreturned borrow transfers whose `dueDate < today`)

- [ ] **Step 1: Write failing tests in `tests/test-maintenance-engine.test.js`**
  - Test `evaluateRepairEconomics`: 10,000 THB asset with 5,500 THB cumulative repair cost -> `isUneconomical: true`, `costRatioPercent: 55`; asset with 3 repairs in last 12 months -> `isUneconomical: true`; asset with `price: 0` -> `costRatioPercent: 0` (no `NaN`/`Infinity`).
  - Test `calculateNextDueDate` adds 6 or 12 months accurately.
  - Test `classifyPmStatus` returns `'overdue'`, `'due_soon'` (<= 30 days), and `'normal'`.
  - Test `findOverdueBorrows` returns only unreturned borrows past `dueDate`.
- [ ] **Step 2: Run `node --test tests/test-maintenance-engine.test.js` and verify FAIL**
- [ ] **Step 3: Implement `maintenance-engine.js`**
- [ ] **Step 4: Run `npm test` and verify PASS**
- [ ] **Step 5: Commit (`feat: add hospital maintenance economics, PM/calibration, and overdue borrow engine`)**

---

### Task 7: Client-Side Image Compression & Firebase Storage Service

**Files:**
- Create: `storage-service.js`
- Create: `tests/test-storage-service.test.js`

**Interfaces:**
- Consumes: `FirebaseBridge.sanitizeCode`
- Produces (named export `StorageService`):
  - `buildStoragePath(folder: 'assets' | 'audits' | 'pm' | 'disposals', entityId: string, filename: string) -> string` (sanitizes `/` in `entityId`, safe filename with timestamp)
  - `validateFile(file: { name, size, type }, maxBytes?) -> { valid: boolean, error?: string }` (default max 5MB, allows `image/*` and `application/pdf`)
  - `compressImageInBrowser(file, options?: { maxWidth?, quality? }) -> Promise<Blob | string>` (Canvas resize to max 1024px, JPEG 0.75)
  - `uploadEvidence(file, folder, entityId) -> Promise<{ url: string, storagePath: string, mode: 'firebase_storage' | 'local_data_url' }>` (uploads via `firebase.storage()` when available; falls back to compressed DataURL in local mode)

- [ ] **Step 1: Write failing tests in `tests/test-storage-service.test.js`**
  - Test `buildStoragePath` sanitizes slashes in asset codes (`7440-001-0005/56` -> `assets/7440-001-0005_56/...`).
  - Test `validateFile` accepts valid JPEG/PNG/PDF under 5MB and rejects > 5MB or unsupported `.exe` file.
- [ ] **Step 2: Run `node --test tests/test-storage-service.test.js` and verify FAIL**
- [ ] **Step 3: Implement `storage-service.js`**
- [ ] **Step 4: Run `npm test` and verify PASS**
- [ ] **Step 5: Commit (`feat: add Firebase Storage evidence service with client-side image compression`)**

---

### Task 8: Full UI Integration in `index.html` & End-to-End Verification

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes all 6 new modules (`DepreciationEngine`, `AuthRBAC`, `AuditLogger`, `DisposalEngine`, `GovForms`, `MaintenanceEngine`, `StorageService`) + updated `FirebaseBridge`.
- UI Additions & Upgrades:
  1. **Firebase SDK Scripts**: Add `firebase-auth-compat.js` and `firebase-storage-compat.js` (10.13.0).
  2. **Navigation & Role Gating**: Add tabs for **จำหน่ายพัสดุ (ข้อ 215)**, **PM / สอบเทียบ (HA)**, and **ผู้ใช้งาน & Audit Log**; apply RBAC visibility/action guards cleanly with clear role badge in header.
  3. **Auth Modal Upgrade**: Support Firebase Email/Password Login & Register (with PDPA consent + first-user Admin bootstrap) PLUS Local Demo/Fallback switcher so offline/unconfigured usage still works seamlessly.
  4. **Asset Register CRUD & Detail Modal**:
     - Add "+ เพิ่มครุภัณฑ์ใหม่" & "แก้ไข" modal with full ผท. fields (`fundSource`, `contractNo`, `vendor`, `warrantyExpiry`, `brandModel`, `serialNo`, `spec`, `location`, `custodian`, `usefulLifeYears`, `isMedicalDevice`) + auto-generate 13-digit code button + photo upload via `StorageService`.
     - Upgrade Asset Detail modal to show live **ค่าเสื่อมราคา & มูลค่าสุทธิตามบัญชี (NBV)**, **ต้นทุนค่าซ่อมสะสม/เตือนไม่คุ้มซ่อม**, **Asset Movement Timeline**, and **"พิมพ์ทะเบียนคุมทรัพย์สิน (ผท.)"** button.
  5. **Transfers & Borrow Upgrade**: Support `transferType` (`โอนย้าย` / `ยืมใช้งาน`), `dueDate`, overdue warning badges, and **"พิมพ์ใบโอนย้าย / ใบยืม-คืน"** button.
  6. **Annual Audit Upgrade**: Add committee order number (`orderNo`), evidence photo upload per scanned item, and **"พิมพ์บันทึกข้อความรายงานผลตรวจ (ข้อ 213)"** button.
  7. **Disposal Workflow Tab**: Candidate list (auto-extracted from audit/repair), Create Disposal Request modal (5 statutory methods), 4-step workflow progression buttons (`draft -> committee_review -> approved -> completed`), Soft-Disposal apply to master register, and **"พิมพ์แบบขออนุมัติจำหน่าย"** button.
  8. **Maintenance & PM/Calibration (HA) Tab**: Add `repairCost`, `partsUsed`, `repairVendor` to repair tickets + uneconomical-repair warning badges; add PM/Calibration schedule table with overdue/due-soon counters, "+ เพิ่มแผน PM/สอบเทียบ", and "บันทึกผลการตรวจ/แนบใบรับรอง" modal.
  9. **Admin Users & Audit Log Tab**: Manage user roles (`admin`, `auditor`, `dept_user`, `technician`, `executive`) + searchable Audit Trail table.
  10. **Executive Analytics Dashboard Upgrade**: Add Total Net Book Value (NBV), breakdown by Fund Source (`งบประมาณ`/`เงินบำรุง`/`เงินบริจาค`), and Actionable Alerts strip (PM overdue, overdue borrows, uneconomical repairs).

- [ ] **Step 1: Wire Firebase Auth/Storage scripts and ES module imports in `index.html`**
- [ ] **Step 2: Integrate Phase 1 UI (Auth/RBAC Modal, Asset CRUD + ผท. Detail/Depreciation/Timeline, Admin Users & Audit Log)**
- [ ] **Step 3: Integrate Phase 2 UI (Disposal Workflow Tab, GovForms print buttons across Asset/Transfer/Audit/Disposal, Audit evidence photo)**
- [ ] **Step 4: Integrate Phase 3 UI (Repair cost fields + uneconomical alerts, PM/Calibration HA Tab, Executive Analytics Dashboard upgrades)**
- [ ] **Step 5: Run full verification**
  - Run `npm test` -> verify all unit tests pass.
  - Check syntax/script integrity and verify no console/parse errors.
- [ ] **Step 6: Commit (`feat: integrate full MOPH government asset management UI across Phases 1-3`)**
