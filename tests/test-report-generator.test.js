import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditEngine } from '../audit-engine.js';
import { ReportGenerator } from '../report-generator.js';

test('buildStatutoryReportData references Regulation Clause 213 and committee structure', () => {
  const activeAssets = [
    { code: 'A1', name: 'Com 1', price: 10000, date: '2020-01-01', dept: 'OPD', status: 'ใช้งานปกติ' },
    { code: 'A2', name: 'Bed 2', price: 50000, date: '2021-01-01', dept: 'IPD', status: 'ใช้งานปกติ' },
    { code: 'A3', name: 'Pump 3', price: 20000, date: '2022-01-01', dept: 'OPD', status: 'ใช้งานปกติ' }
  ];
  let round = AuditEngine.createRound('2569', 'คำสั่งที่ 125/2569', '15 กันยายน 2569', [
    { name: 'นพ.วิชาญ รักษาดี', position: 'นายแพทย์ชำนาญการพิเศษ', role: 'ประธานกรรมการ' },
    { name: 'นางสาวมาลี มีสุข', position: 'พยาบาลวิชาชีพชำนาญการ', role: 'กรรมการ' },
    { name: 'นายสมศักดิ์ พัสดุงาม', position: 'เจ้าพนักงานพัสดุปฏิบัติงาน', role: 'กรรมการและเลขานุการ' }
  ]);
  round = AuditEngine.recordScan(round, 'A1', 'สมศักดิ์', 'normal').round;
  round = AuditEngine.recordScan(round, 'A2', 'สมศักดิ์', 'deteriorated_unusable', 'มอเตอร์ไหม้ ซ่อมไม่คุ้ม').round;
  round = AuditEngine.markExplicitLost(round, 'A3', 'สมศักดิ์', 'ไม่พบในทุกตึก');

  const reportData = ReportGenerator.buildStatutoryReportData(round, activeAssets);
  assert.equal(reportData.fiscalYear, '2569');
  assert.equal(reportData.orderNo, 'คำสั่งที่ 125/2569');
  assert.equal(reportData.committee.length, 3);
  
  // Scanned subtotal value must match sum of scanned items, not all hospital assets
  assert.equal(reportData.summary.scannedTotalValue, 80000); // 10000 + 50000 + 20000
  
  // Defective / Disposed / Lost items should be in defectiveItems list for attachment
  assert.equal(reportData.defectiveItems.length, 2);
  const a2Item = reportData.defectiveItems.find(i => i.code === 'A2');
  assert.equal(a2Item.condition, 'deteriorated_unusable');
  assert.equal(a2Item.conditionLabel, 'ชำรุด/เสื่อมสภาพไม่คุ้มค่าซ่อม (เสนอขอจำหน่าย)');
  assert.equal(a2Item.notes, 'มอเตอร์ไหม้ ซ่อมไม่คุ้ม');
});

test('renderPrintableHTML produces compliant HTML with print break CSS and signature block', () => {
  const mockReportData = {
    fiscalYear: '2569',
    orderNo: '125/2569',
    orderDate: '15 ก.ย. 2569',
    hospitalName: 'โรงพยาบาลหนองจิก',
    summary: { 
      totalCount: 2, 
      scannedCount: 2,
      normalCount: 1, 
      damagedRepairableCount: 0, 
      deterioratedUnusableCount: 1, 
      lostCount: 0, 
      totalValue: 60000,
      normalValue: 10000,
      deterioratedUnusableValue: 50000
    },
    defectiveItems: [
      { no: 1, code: 'A2', name: 'Bed 2', dept: 'IPD', price: 50000, conditionLabel: 'ชำรุด/เสื่อมสภาพไม่คุ้มค่าซ่อม (เสนอขอจำหน่าย)', notes: 'มอเตอร์ไหม้' }
    ],
    committee: [
      { name: 'นพ.วิชาญ รักษาดี', role: 'ประธานกรรมการ', position: 'นายแพทย์ชำนาญการพิเศษ' },
      { name: 'นางสาวมาลี มีสุข', role: 'กรรมการ', position: 'พยาบาลวิชาชีพชำนาญการ' },
      { name: 'นายสมศักดิ์ พัสดุงาม', role: 'กรรมการและเลขานุการ', position: 'เจ้าพนักงานพัสดุปฏิบัติงาน' }
    ]
  };
  const html = ReportGenerator.renderPrintableHTML(mockReportData);
  assert.match(html, /รายงานผลการตรวจสอบพัสดุประจำปี/);
  assert.match(html, /ระเบียบกระทรวงการคลังว่าด้วยการจัดซื้อจัดจ้าง/);
  assert.match(html, /page-break-inside:\s*avoid/);
  assert.match(html, /ประธานกรรมการ/);
  assert.match(html, /กรรมการและเลขานุการ/);
});

test('generateExcelWorkbook produces structured sheet payloads for SheetJS', () => {
  const mockReportData = {
    fiscalYear: '2569',
    orderNo: '125/2569',
    orderDate: '15 ก.ย. 2569',
    summary: { totalCount: 10, totalValue: 500000, normalCount: 8, damagedRepairableCount: 1, deterioratedUnusableCount: 1, lostCount: 0 },
    defectiveItems: [
      { no: 1, code: 'A2', name: 'Bed 2', dept: 'IPD', price: 50000, conditionLabel: 'ชำรุด/เสื่อมสภาพ', notes: 'มอเตอร์ไหม้' }
    ]
  };
  const wbData = ReportGenerator.generateExcelWorkbook(mockReportData);
  assert.equal(wbData.sheets.length, 2);
  assert.equal(wbData.sheets[0].name, 'สรุปผลการตรวจสอบ');
  assert.equal(wbData.sheets[1].name, 'บัญชีครุภัณฑ์ชำรุด-สูญไป');
  assert.equal(Array.isArray(wbData.sheets[0].data), true);
  assert.equal(Array.isArray(wbData.sheets[1].data), true);
});
