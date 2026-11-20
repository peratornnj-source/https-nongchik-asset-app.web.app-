import test from 'node:test';
import assert from 'node:assert/strict';
import { GovForms } from '../gov-forms.js';
import { DepreciationEngine } from '../depreciation-engine.js';

test('renderAssetRegisterCard renders Thai ผท. register card with depreciation and escaped HTML', () => {
  const asset = DepreciationEngine.normalizeAssetRecord({
    code: '6515-070-0002/22',
    name: 'เครื่องวัดความดัน <script>alert(1)</script>',
    price: 15000,
    date: '2022-05-01',
    dept: 'OPD',
    fundSource: 'เงินบำรุง',
    serialNo: 'SN-998877',
    vendor: 'บริษัท เมดิคอล จำกัด'
  });
  const dep = DepreciationEngine.calculateDepreciation(asset, '2026-11-20');
  const html = GovForms.renderAssetRegisterCard(asset, dep, []);

  assert.ok(html.includes('@page'));
  assert.ok(html.includes('ทะเบียนคุมทรัพย์สิน'));
  assert.ok(html.includes('6515-070-0002/22'));
  assert.ok(html.includes('เงินบำรุง'));
  assert.ok(html.includes('SN-998877'));
  assert.equal(html.includes('<script>alert(1)</script>'), false);
});

test('renderTransferOrBorrowForm renders both transfer and borrow official A4 forms with signatures', () => {
  const asset = { code: '7440-001-0005/56', name: 'คอมพิวเตอร์', price: 25000 };
  const transferHtml = GovForms.renderTransferOrBorrowForm({
    docNo: 'อย.2569/001',
    transferType: 'transfer',
    date: '2026-11-20',
    fromDept: 'COM',
    toDept: 'OPD',
    requester: 'นายสมชาย',
    reason: 'ทดแทนเครื่องเดิม'
  }, asset);
  assert.ok(transferHtml.includes('ใบโอนย้ายครุภัณฑ์'));
  assert.ok(transferHtml.includes('ผู้ส่งมอบ') && transferHtml.includes('ผู้รับมอบ'));

  const borrowHtml = GovForms.renderTransferOrBorrowForm({
    docNo: 'ยค.2569/002',
    transferType: 'borrow',
    date: '2026-11-20',
    dueDate: '2026-12-01',
    fromDept: 'COM',
    toDept: 'ER',
    requester: 'นางสาวพยาบาล'
  }, asset);
  assert.ok(borrowHtml.includes('ใบยืม-คืนครุภัณฑ์'));
  assert.ok(borrowHtml.includes('2026-12-01'));
});

test('renderAnnualAuditMemo renders Clause 213 Thai official memo to Hospital Director', () => {
  const html = GovForms.renderAnnualAuditMemo(
    {
      fiscalYear: 2569,
      orderNo: 'คำสั่ง รพ.หนองจิก ที่ 201/2569',
      orderDate: '2026-09-25',
      committee: [{ name: 'นพ.สมศักดิ์', position: 'ประธานกรรมการ' }]
    },
    {
      summary: { totalActive: 800, normal: 760, damagedRepairable: 25, damagedUnrepairable: 10, lost: 5, totalValue: 12500000 }
    }
  );
  assert.ok(html.includes('บันทึกข้อความ'));
  assert.ok(html.includes('ข้อ 213'));
  assert.ok(html.includes('ผู้อำนวยการโรงพยาบาลหนองจิก'));
  assert.ok(html.includes('คำสั่ง รพ.หนองจิก ที่ 201/2569'));
  assert.ok(html.includes('นพ.สมศักดิ์'));
});

test('renderDisposalRequestForm renders Clause 215-218 disposal approval form with NBV totals', () => {
  const html = GovForms.renderDisposalRequestForm({
    disposalNo: 'จห.2569/001',
    fiscalYear: 2569,
    method: 'auction',
    reason: 'ชำรุดเสื่อมสภาพไม่คุ้มซ่อม',
    committeeOrderNo: 'คำสั่ง รพ.หนองจิก ที่ 305/2569',
    committeeMembers: [{ name: 'นางสมศรี', position: 'ประธานกรรมการ' }],
    items: [
      { code: '7440-001-0005/56', name: 'คอมพิวเตอร์', dept: 'COM', price: 9000, nbv: 1, condition: 'ชำรุด' }
    ],
    createdBy: 'เจ้าหน้าที่พัสดุ',
    approvedBy: 'ผู้อำนวยการโรงพยาบาลหนองจิก'
  });
  assert.ok(html.includes('ขออนุมัติจำหน่ายพัสดุ'));
  assert.ok(html.includes('จห.2569/001'));
  assert.ok(html.includes('ขายทอดตลาด'));
  assert.ok(html.includes('7440-001-0005/56'));
});
