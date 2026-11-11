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
  assert.equal(active.some(a => a.code === 'A1'), true);
  assert.equal(active.some(a => a.code === 'A3'), true);
});

test('fast continuous scan auto-records item as normal', () => {
  let round = AuditEngine.createRound('2569', '125/2569', '2026-09-15', []);
  const result = AuditEngine.recordScan(round, '6515-070-0002/22', 'นายสมชาย (OPD)');
  assert.equal(result.item.condition, 'normal');
  assert.equal(result.item.auditorName, 'นายสมชาย (OPD)');
  assert.equal(result.isNewScan, true);
  
  // The sanitized key should store the item in round.items
  const sanitized = '6515-070-0002_22';
  assert.equal(round.items[sanitized].condition, 'normal');
});

test('computeSummary correctly computes percentages and excludes pending from lost', () => {
  const activeAssets = [
    { code: 'A1', name: 'Com 1', price: 10000, dept: 'OPD', status: 'ใช้งานปกติ' },
    { code: 'A2', name: 'Com 2', price: 20000, dept: 'IPD', status: 'ใช้งานปกติ' },
    { code: 'A3', name: 'Com 3', price: 30000, dept: 'OPD', status: 'ใช้งานปกติ' }
  ];
  let round = AuditEngine.createRound('2569', '125/2569', '2026-09-15', []);
  round = AuditEngine.recordScan(round, 'A1', 'Auditor 1', 'normal').round;
  round = AuditEngine.recordScan(round, 'A2', 'Auditor 2', 'damaged_repairable', 'จอเสีย').round;

  const summary = AuditEngine.computeSummary(round, activeAssets);
  assert.equal(summary.totalCount, 3);
  assert.equal(summary.scannedCount, 2);
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.normalCount, 1);
  assert.equal(summary.damagedRepairableCount, 1);
  assert.equal(summary.deterioratedUnusableCount, 0);
  assert.equal(summary.lostCount, 0); // Unscanned A3 must NOT be counted as lost!
  assert.equal(summary.totalValue, 60000);
  assert.equal(summary.normalValue, 10000);
});

test('reconciliation gets pending assets grouped by department', () => {
  const activeAssets = [
    { code: 'A1', name: 'Com 1', price: 10000, dept: 'OPD-งานผู้ป่วยนอก' },
    { code: 'A2', name: 'Bed 2', price: 20000, dept: 'IPD1-งานหอผู้ป่วยใน' },
    { code: 'A3', name: 'Pump 3', price: 30000, dept: 'OPD-งานผู้ป่วยนอก' }
  ];
  let round = AuditEngine.createRound('2569', '125/2569', '2026-09-15', []);
  round = AuditEngine.recordScan(round, 'A1', 'Auditor 1', 'normal').round;

  const pendingByDept = AuditEngine.getPendingAssetsByDept(round, activeAssets);
  assert.equal(pendingByDept.get('OPD-งานผู้ป่วยนอก').length, 1);
  assert.equal(pendingByDept.get('OPD-งานผู้ป่วยนอก')[0].code, 'A3');
  assert.equal(pendingByDept.get('IPD1-งานหอผู้ป่วยใน').length, 1);
});

test('markExplicitLost explicitly classifies pending item as lost', () => {
  let round = AuditEngine.createRound('2569', '125/2569', '2026-09-15', []);
  round = AuditEngine.markExplicitLost(round, 'A3', 'กรรมการพัสดุ', 'ตรวจสอบทุกตึกแล้วไม่พบ');
  const sanitized = 'A3';
  assert.equal(round.items[sanitized].condition, 'lost');
  assert.equal(round.items[sanitized].notes, 'ตรวจสอบทุกตึกแล้วไม่พบ');
});

test('finalized round rejects further scans', () => {
  let round = AuditEngine.createRound('2569', '125/2569', '2026-09-15', []);
  round = AuditEngine.finalizeRound(round);
  assert.equal(round.status, 'finalized');
  assert.throws(() => {
    AuditEngine.recordScan(round, 'A1', 'Auditor');
  }, /locked|finalized/);
});

test('generateMasterUpdates correctly identifies status changes to apply', () => {
  const activeAssets = [
    { code: 'A1', name: 'Com 1', status: 'ใช้งานปกติ' },
    { code: 'A2', name: 'Bed 2', status: 'ใช้งานปกติ' },
    { code: 'A3', name: 'Pump 3', status: 'ใช้งานปกติ' }
  ];
  let round = AuditEngine.createRound('2569', '125/2569', '2026-09-15', []);
  round = AuditEngine.recordScan(round, 'A1', 'Auditor', 'normal').round;
  round = AuditEngine.recordScan(round, 'A2', 'Auditor', 'deteriorated_unusable', 'มอเตอร์พัง').round;
  round = AuditEngine.markExplicitLost(round, 'A3', 'Auditor', 'หาไม่พบ');

  const updates = AuditEngine.generateMasterUpdates(round, activeAssets);
  assert.equal(updates.length, 2); // A2 and A3 changed status
  const a2Update = updates.find(u => u.code === 'A2');
  assert.equal(a2Update.newStatus, 'รอจำหน่าย');
  const a3Update = updates.find(u => u.code === 'A3');
  assert.equal(a3Update.newStatus, 'สูญไป/หาไม่พบ');
});
