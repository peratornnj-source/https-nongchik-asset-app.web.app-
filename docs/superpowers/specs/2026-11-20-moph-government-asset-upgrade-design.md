# Design Document: MOPH Government Asset Management System Full Upgrade (Phase 1–3)

- **Project**: ระบบบริหารงานพัสดุและครุภัณฑ์ โรงพยาบาลหนองจิก (`nongchik-asset-app.web.app`)
- **Date**: 2026-11-20
- **Status**: Draft (Awaiting User Approval)

---

## 1. Intent & The Why

### Background
ปัจจุบันระบบพัสดุโรงพยาบาลหนองจิกมีโครงสร้างพื้นฐานที่ดีแล้ว (ทะเบียนครุภัณฑ์ 845 รายการ, นำเข้าข้อมูล Excel/CSV/JSON, สติ๊กเกอร์ QR, สแกนตรวจนับประจำปีพร้อมกระทบยอด, ยืม-โอนย้าย, แจ้งซ่อม, Dashboard และเชื่อม Firebase Firestore) แต่ยังไม่ครบถ้วนตามกรอบกฎหมายและมาตรฐานของโรงพยาบาลสังกัดกระทรวงสาธารณสุข ได้แก่:
1. **ระเบียบกระทรวงการคลังว่าด้วยการจัดซื้อจัดจ้างและการบริหารพัสดุภาครัฐ พ.ศ. 2560** (การควบคุมทะเบียนทรัพย์สิน, การตรวจสอบพัสดุประจำปี ข้อ 213, การจำหน่ายพัสดุ ข้อ 215–218)
2. **มาตรฐานบัญชีภาครัฐ (กรมบัญชีกลาง / New GFMIS Thai / สตง.)** ที่ต้องแยกแหล่งเงิน (งบประมาณ/เงินบำรุง/เงินบริจาค), คำนวณค่าเสื่อมราคา (Depreciation) และมูลค่าสุทธิตามบัญชี (Net Book Value) รวมถึงมี Audit Trail ตรวจสอบย้อนหลังได้
3. **เกณฑ์คุณภาพโรงพยาบาล (HA)** ด้านการบริหารจัดการเครื่องมือแพทย์ (MEM) ที่ต้องติดตามต้นทุนการซ่อมสะสม แผนบำรุงรักษาเชิงป้องกัน (PM) และการสอบเทียบ (Calibration)

### Why Now
ผู้ใช้ต้องการยกระดับระบบทั้งหมดแบบครบวงจร (ทั้ง 3 เฟส) โดยเลือกแนวทางความปลอดภัยระดับ Production (**Firebase Authentication + Firebase Storage + Firestore Security Rules**) เพื่อให้สามารถนำไปใช้งานจริงในโรงพยาบาลหนองจิกได้หลายแผนกพร้อมกันอย่างมั่นใจและผ่านการตรวจสอบจาก สตง. และผู้เยี่ยมสำรวจ HA

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- **Complete Government Asset Register**: รองรับฟิลด์ทะเบียนคุมทรัพย์สิน (แบบ ผท.) ครบถ้วน, ฟอร์มเพิ่ม/แก้ไขครุภัณฑ์รายตัว, รันรหัสครุภัณฑ์ 13 หลักอัตโนมัติ, คำนวณค่าเสื่อมราคาอัตโนมัติตามเกณฑ์กรมบัญชีกลาง และแสดง Asset Movement Timeline
- **Production Security & RBAC**: ใช้ Firebase Auth (Email/Password) ร่วมกับ Firestore User Profile เพื่อควบคุมสิทธิ์ 5 บทบาท (`admin`, `auditor`, `dept_user`, `technician`, `executive`), บันทึก Audit Log ทุกการเปลี่ยนแปลงสำคัญ และบังคับสิทธิ์ฝั่งเซิร์ฟเวอร์ด้วย `firestore.rules` และ `storage.rules`
- **End-to-End Disposal Workflow (ข้อ 215–218)**: เชื่อมผลตรวจนับประจำปี/รายการซ่อมไม่คุ้มเข้าสู่กระบวนการขอจำหน่าย -> ตั้งกรรมการ -> อนุมัติ -> ลงจ่ายออกจากทะเบียนโดยยังคงประวัติไว้ตรวจสอบย้อนหลัง
- **Official Thai Government Print Forms**: พิมพ์เอกสารราชการ A4 ได้จริง (ทะเบียนคุมทรัพย์สิน ผท., ใบโอนย้าย, ใบยืม-คืน, บันทึกข้อความรายงานผลตรวจประจำปี ข้อ 213, แบบขอจำหน่ายพัสดุ)
- **Hospital Maintenance & HA Compliance**: บันทึกค่าซ่อมสะสม + แจ้งเตือนไม่คุ้มซ่อม (เกินเกณฑ์ % ที่กำหนด), ระบบแผน PM และ Calibration เครื่องมือแพทย์พร้อมแจ้งเตือนใกล้ครบกำหนด/เกินกำหนด
- **Photo & Document Evidence**: อัปโหลดรูปครุภัณฑ์, รูปหลักฐานตรวจนับ, เอกสารใบรับประกัน/ใบสอบเทียบขึ้น Firebase Storage (บีบอัดภาพฝั่ง Client ก่อนอัปโหลดเพื่อลดพื้นที่และโหลดเร็ว)

### Non-Goals
- ไม่เชื่อมต่อ API ตรงกับระบบ New GFMIS Thai หรือ HOSxP ในระยะนี้ (ใช้การส่งออก/นำเข้า Excel และ CSV ที่เข้ากันได้แทน)
- ไม่สร้าง Backend Server แยก (Node/Express/Cloud Functions) เพื่อคงโครงสร้าง Static SPA บน Firebase Hosting ที่ดูแลรักษาง่ายและประหยัดค่าใช้จ่าย

### Anti-Goals
- ห้ามทำลายข้อมูลครุภัณฑ์เดิม 845 รายการ (`assets-data.js`) และความเข้ากันได้ย้อนหลังของไฟล์นำเข้า CSV/Excel เดิม (ฟิลด์ใหม่ทั้งหมดต้องมีค่าเริ่มต้นที่ปลอดภัยเมื่อข้อมูลเดิมไม่มีฟิลด์นั้น)
- ห้ามลบครุภัณฑ์ที่จำหน่ายแล้วออกจากฐานข้อมูลถาวร (ต้องเป็น Soft Disposal / เปลี่ยนสถานะเป็น `จำหน่ายแล้ว` พร้อมเก็บร่องรอยเอกสารอ้างอิง)
- ห้ามทำให้โหมดทดสอบ/ใช้งาน Local (`localStorage` fallback เมื่อยังไม่ได้ล็อกอิน Cloud หรือทำงานออฟไลน์) พัง

---

## 3. Constraints
- **Architecture**: Zero-Build Static Web App (HTML5, Vanilla ES Modules, Tailwind CSS CDN, Firebase 10.13.0 Compat SDK)
- **Testing**: โมดูลตรรกะหลักทั้งหมดต้องเขียนเป็น Pure/Testable ES Modules ที่รันทดสอบด้วย `npm test` (`node --test tests/*.test.js`) ได้โดยไม่ต้องพึ่ง Browser
- **Firebase Console Setup Required (by User)**: เนื่องจากเลือกแนวทาง B ผู้ใช้จะต้องเปิดใช้งาน **Authentication (Email/Password)** และ **Cloud Storage** ใน Firebase Console ของโปรเจกต์ `nongchik-asset-app` และ deploy `firestore.rules` / `storage.rules` (ระบบจะมีคู่มือตั้งค่าและหน้าตรวจสถานะให้ชัดเจน รวมถึง bootstrap ผู้ใช้ Admin คนแรกได้สะดวก)

---

## 4. Architectural Approaches

### Approaches Considered
1. **Approach A: Firestore-only Custom Auth + Compressed Base64 Photos**
   - *ข้อดี*: ใช้งานได้ทันทีไม่ต้องเปิด Firebase Auth/Storage
   - *ข้อเสีย*: ไม่สามารถบังคับ Security Rules ระดับ UID/Role ฝั่งเซิร์ฟเวอร์ได้จริง เสี่ยงต่อการถูกแก้ไขข้อมูลผ่าน Console ไม่เหมาะกับเกณฑ์ตรวจสอบ สตง.
2. **Approach B: Firebase Auth (Email/Password) + Firebase Storage + Firestore Security Rules + Modular ES Engines (SELECTED)**
   - *ข้อดี*: แยกสิทธิ์ฝั่งเซิร์ฟเวอร์จริงด้วย `firestore.rules` / `storage.rules`, จัดเก็บรูปถ่าย/เอกสารแนบได้ไม่ติดลิมิต 1MB ของ Firestore document, และแยกโค้ดเป็นโมดูลย่อยที่ทดสอบได้ด้วย Unit Test
   - *ข้อเสีย*: ต้องเปิดใช้งาน Firebase Auth และ Cloud Storage ใน Firebase Console ก่อนใช้งาน Cloud เต็มรูปแบบ (แก้จุดอ่อนด้วยการคง Local Demo/Fallback Mode ไว้ระหว่างตั้งค่า)

### Modular File Architecture (เพิ่มจากไฟล์เดิม)
- `auth-rbac.js` — จัดการ Firebase Auth, สิทธิ์ 5 บทบาท (`can(role, permission)`), และการบันทึก `audit_logs`
- `depreciation-engine.js` — ตารางอายุการใช้งานตามเกณฑ์กรมบัญชีกลาง, คำนวณค่าเสื่อมราคาแบบเส้นตรง (Straight-Line) รายปี/สะสม/มูลค่าสุทธิ (NBV), และตัวสร้างรหัสครุภัณฑ์ 13 หลักอัตโนมัติ
- `disposal-engine.js` — จัดการ State Machine ของกระบวนการจำหน่ายพัสดุตามข้อ 215–218 และการลงจ่ายออกจากทะเบียน
- `maintenance-engine.js` — คำนวณต้นทุนซ่อมสะสม, แจ้งเตือนไม่คุ้มซ่อม, และระบบแผน PM / Calibration เครื่องมือแพทย์ (overdue / due soon / normal)
- `gov-forms.js` — ตัวสร้าง HTML Template สำหรับพิมพ์เอกสารราชการ A4 (แบบ ผท., ใบโอนย้าย, ใบยืม-คืน, บันทึกข้อความรายงานผลตรวจ ข้อ 213, แบบขอจำหน่ายพัสดุ)
- `storage-service.js` — บีบอัดรูปภาพฝั่ง Client (Canvas resize + JPEG quality) และอัปโหลด/ลบไฟล์บน Firebase Storage พร้อม fallback
- `firestore.rules` & `storage.rules` — กฎความปลอดภัยฝั่งเซิร์ฟเวอร์ตาม Role ของผู้ใช้
- `firebase.json` — อัปเดตเพิ่มคอนฟิกชี้ไปยัง `firestore.rules` และ `storage.rules`

---

## 5. Data Model Design (Backward-Compatible)

### 5.1 `assets/{sanitizedCode}` (ขยายจาก 6 ฟิลด์เดิม)
ฟิลด์เดิม: `code`, `name`, `price`, `date`, `dept`, `status`
ฟิลด์ใหม่ (Optional มี default):
- `fundSource`: `'งบประมาณ'` | `'เงินบำรุง'` | `'เงินบริจาค'` | `'อื่นๆ'` (default: `'ไม่ระบุ'`)
- `contractNo`: เลขที่สัญญา / ใบสั่งซื้อ
- `vendor`: ชื่อผู้ขาย / ผู้รับจ้าง
- `warrantyExpiry`: วันหมดประกัน (`YYYY-MM-DD`)
- `brandModel`: ยี่ห้อ / รุ่น
- `serialNo`: หมายเลขเครื่อง (S/N)
- `spec`: คุณลักษณะเฉพาะ
- `location`: สถานที่ตั้ง (อาคาร/ชั้น/ห้อง)
- `custodian`: ผู้รับผิดชอบ / ผู้ครอบครอง
- `usefulLifeYears`: อายุการใช้งานตามเกณฑ์กรมบัญชีกลาง (ปี) — ถ้าไม่ระบุ จะประเมินอัตโนมัติจากรหัสหมวด 4 หลักแรก (เช่น `7440` คอมพิวเตอร์ = 3 ปี, `6515` เครื่องมือแพทย์ = 5 ปี, `7110` ครุภัณฑ์สำนักงาน = 5 ปี)
- `salvageValue`: มูลค่าซาก (default: `1` บาท ตามแนวปฏิบัติบัญชีภาครัฐเมื่อตัดค่าเสื่อมหมดแต่ยังใช้งานอยู่)
- `photoUrl`: URL รูปถ่ายหลักบน Firebase Storage
- `attachments`: `Array<{ name, url, type, uploadedAt }>`
- `isMedicalDevice`: `boolean` (ระบุว่าเป็นเครื่องมือแพทย์ที่ต้องทำ PM/Calibration หรือไม่)
- `disposalId`: รหัสเอกสารจำหน่าย (หากจำหน่ายแล้ว)
- `history`: `Array<{ date, type, summary, actor }>` (หรือรวมกับ events จาก transfers/tickets/audits/disposals เป็น Timeline)

### 5.2 `users/{uid}`
- `uid`, `email`, `fullName`, `position`, `dept`
- `role`: `'admin'` | `'auditor'` | `'dept_user'` | `'technician'` | `'executive'`
- `active`: `boolean`
- `pdpaConsentAt`: ISO timestamp
- `createdAt`, `updatedAt`

### 5.3 `audit_logs/{logId}`
- `timestamp`, `actorUid`, `actorName`, `actorRole`, `action` (`ASSET_CREATE`, `ASSET_UPDATE`, `TRANSFER_CREATE`, `DISPOSAL_APPROVE`, `AUDIT_FINALIZE`, `PM_RECORD`, `USER_ROLE_CHANGE`, ฯลฯ), `targetType`, `targetId`, `summary`, `changes`

### 5.4 `disposals/{disposalId}`
- `disposalNo` (เช่น `จห.2569/001`), `fiscalYear`, `status` (`draft` | `committee_review` | `approved` | `completed`)
- `method`: `'auction'` (ขายทอดตลาด) | `'exchange'` (แลกเปลี่ยน) | `'transfer'` (โอน) | `'destroy'` (แปรสภาพหรือทำลาย) | `'write_off'` (จำหน่ายเป็นสูญ)
- `committeeOrderNo`, `committeeOrderDate`, `committeeMembers`: `Array<{ name, position, role }>`
- `reason`, `items`: `Array<{ code, name, price, nbv, condition, photoUrl, estimatedValue }>`
- `approvedBy`, `approvedAt`, `completedAt`, `createdBy`, `createdAt`

### 5.5 `pm_schedules/{scheduleId}`
- `assetCode`, `assetName`, `dept`, `scheduleType` (`'pm'` | `'calibration'`)
- `intervalMonths` (เช่น 6 หรือ 12), `lastDoneDate`, `nextDueDate`
- `provider` (ศูนย์เครื่องมือแพทย์ / บริษัทภายนอก), `certNo`, `certUrl`, `lastResult` (`pass` | `fail` | `pending`), `notes`

### 5.6 ส่วนขยายของ `tickets`, `transfers`, `annual_audits`
- `tickets`: เพิ่ม `repairCost` (บาท), `partsUsed`, `repairVendor`, `technicianName`, `completedAt`, `repairRatioPercent`
- `transfers`: เพิ่ม `docNo`, `transferType` (`'transfer'` | `'borrow'`), `dueDate` (สำหรับยืม), `returnedAt`, `approvedBy`
- `annual_audits`: เพิ่ม `orderNo`, `orderDate`, `fiscalYear`, `records[code].photoUrl`

---

## 6. Phased Delivery Plan

เพื่อควบคุมคุณภาพ ลดความเสี่ยง และให้ระบบพร้อมใช้งานจริงทีละขั้น จะแบ่งการพัฒนาและทดสอบออกเป็น **3 เฟสต่อเนื่อง**:

| เฟส | ขอบเขตงานหลัก | ผลลัพธ์ที่ตรวจสอบได้ |
| :--- | :--- | :--- |
| **Phase 1: Foundation, Register & Security** | 1) `depreciation-engine.js` + ฟอร์มเพิ่ม/แก้ไขครุภัณฑ์ครบฟิลด์ ผท. + รันรหัส 13 หลัก + Asset Timeline<br>2) `auth-rbac.js` (Firebase Auth Email/Password + 5 Roles + หน้าจัดการผู้ใช้สำหรับ Admin + Audit Log)<br>3) `firestore.rules` + `storage.rules` + Unit Tests | เพิ่ม/แก้ครุภัณฑ์ ดูค่าเสื่อมราคาและ NBV ได้, ล็อกอินแยกสิทธิ์ 5 บทบาทได้จริง, บันทึกและดู Audit Log ได้ |
| **Phase 2: Disposal Workflow & Official Forms** | 1) `disposal-engine.js` + หน้าจอระบบจำหน่ายพัสดุครบ 4 ขั้นตอน (ข้อ 215–218)<br>2) `gov-forms.js` (พิมพ์แบบ ผท., ใบโอนย้าย, ใบยืม-คืน, บันทึกข้อความรายงานผลตรวจ ข้อ 213, แบบขอจำหน่าย)<br>3) แนบข้อมูลคำสั่งแต่งตั้งกรรมการในรอบตรวจนับ + Unit Tests | ทำเรื่องจำหน่ายจากผลตรวจนับจนลงจ่ายออกจากทะเบียนได้, พิมพ์เอกสารราชการ A4 ได้ทุกแบบฟอร์ม |
| **Phase 3: Hospital Maintenance (HA) & Cloud Storage** | 1) `storage-service.js` (บีบอัดภาพ + อัปโหลด Firebase Storage สำหรับรูปครุภัณฑ์/รูปตรวจนับ/ใบสอบเทียบ)<br>2) `maintenance-engine.js` (ค่าซ่อมสะสม + เตือนไม่คุ้มซ่อม + ตาราง PM/Calibration เครื่องมือแพทย์)<br>3) อัปเกรด Dashboard ผู้บริหาร (สรุปตามแหล่งเงิน, มูลค่าสุทธิ NBV, แจ้งเตือน PM/ยืมเกินกำหนด/ซ่อมไม่คุ้ม) + Unit Tests | อัปโหลดรูปหลักฐานได้, เห็นแจ้งเตือนเครื่องมือแพทย์ครบกำหนดสอบเทียบและครุภัณฑ์ซ่อมไม่คุ้ม, พร้อม deploy ขึ้น Firebase |

---

## 7. Decisions Made by Designer (For User Review)
1. **เกณฑ์ค่าซ่อมไม่คุ้มซ่อม (Default Threshold)**: ตั้งค่าเริ่มต้นที่ **50% ของราคาซื้อ** (หรือซ่อมเกิน 3 ครั้งใน 1 ปี) โดยให้ Admin ปรับเกณฑ์ได้ในหน้าตั้งค่า
2. **อายุการใช้งานเริ่มต้นตามหมวดรหัสครุภัณฑ์ (กรมบัญชีกลาง)**:
   - `7440` (คอมพิวเตอร์/IT): 3 ปี
   - `6515` / `6520` / `6525` (เครื่องมือแพทย์): 5 ปี
   - `7110` / `7490` (ครุภัณฑ์สำนักงาน): 5 ปี
   - `4110` / `4120` (เครื่องปรับอากาศ/ทำความเย็น): 5 ปี
   - `2310` / `2320` (ยานพาหนะ): 5 ปี
   - หมวดอื่นๆ: 5 ปี (และแก้ไขรายตัวได้ทุกชิ้น)
3. **Bootstrap Admin คนแรก**: เมื่อเปิดใช้งาน Firebase Auth ครั้งแรก หากยังไม่มีผู้ใช้ใน collection `users` ระบบจะอนุญาตให้ผู้ใช้ที่สมัคร/ล็อกอินคนแรกตั้งค่าเป็น `admin` (เจ้าหน้าที่พัสดุหลัก) เพื่อจัดการเพิ่มบัญชีและกำหนด Role ให้บุคลากรคนอื่นได้ทันที
4. **Local Fallback Mode**: หากเปิดแอปโดยยังไม่ได้เปิดใช้ Firebase Auth ใน Console หรือทำงานออฟไลน์ ระบบยังสามารถเข้าดู/ทดสอบในโหมด Local Demo ได้โดยไม่จอดำ
