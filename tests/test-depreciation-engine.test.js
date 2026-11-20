import test from 'node:test';
import assert from 'node:assert/strict';
import { DepreciationEngine } from '../depreciation-engine.js';

test('getDefaultUsefulLife returns Comptroller General standard years by 4-digit prefix', () => {
  assert.equal(DepreciationEngine.getDefaultUsefulLife('7440-001-0005/56'), 3);
  assert.equal(DepreciationEngine.getDefaultUsefulLife('6515-070-0002/22'), 5);
  assert.equal(DepreciationEngine.getDefaultUsefulLife('6520-010-0001/65'), 5);
  assert.equal(DepreciationEngine.getDefaultUsefulLife('7110-001-0001/60'), 5);
  assert.equal(DepreciationEngine.getDefaultUsefulLife('9999-001-0001/65'), 5);
  assert.equal(DepreciationEngine.getDefaultUsefulLife(''), 5);
});

test('calculateDepreciation computes straight-line mid-life NBV accurately', () => {
  const asset = {
    code: '7440-001-0001/68',
    price: 30000,
    date: '2025-01-01',
    usefulLifeYears: 3,
    salvageValue: 1
  };
  const res = DepreciationEngine.calculateDepreciation(asset, '2026-01-01');
  assert.equal(res.purchasePrice, 30000);
  assert.equal(res.usefulLifeYears, 3);
  assert.equal(res.salvageValue, 1);
  assert.equal(res.annualDepreciation, 9999.67);
  assert.ok(res.accumulatedDepreciation >= 9999 && res.accumulatedDepreciation <= 10001);
  assert.ok(res.netBookValue >= 19999 && res.netBookValue <= 20001);
  assert.equal(res.isFullyDepreciated, false);
});

test('calculateDepreciation floors NBV at 1 THB salvageValue when fully depreciated', () => {
  const asset = {
    code: '7440-001-0005/56',
    price: 9000,
    date: '2006-03-07'
  };
  const res = DepreciationEngine.calculateDepreciation(asset, '2026-11-20');
  assert.equal(res.usefulLifeYears, 3);
  assert.equal(res.netBookValue, 1);
  assert.equal(res.accumulatedDepreciation, 8999);
  assert.equal(res.isFullyDepreciated, true);
});

test('calculateDepreciation handles legacy zero-price and invalid dates without NaN', () => {
  const zeroAsset = { code: '7110-001-0001/60', price: 0, date: 'invalid-date' };
  const res = DepreciationEngine.calculateDepreciation(zeroAsset, '2026-11-20');
  assert.equal(Number.isNaN(res.netBookValue), false);
  assert.equal(Number.isNaN(res.accumulatedDepreciation), false);
  assert.equal(res.netBookValue, 0);
  assert.equal(res.accumulatedDepreciation, 0);
  assert.equal(res.ageYears, 0);
});

test('normalizeAssetRecord preserves legacy 6 fields and populates ผท. defaults', () => {
  const raw = {
    code: '6515-070-0002/22',
    name: 'เครื่องวัดความดันโลหิต',
    price: 15000,
    date: '2022-05-01',
    dept: 'OPD',
    status: 'ใช้งานปกติ'
  };
  const norm = DepreciationEngine.normalizeAssetRecord(raw);
  assert.equal(norm.code, raw.code);
  assert.equal(norm.name, raw.name);
  assert.equal(norm.fundSource, 'ไม่ระบุ');
  assert.equal(norm.salvageValue, 1);
  assert.equal(norm.usefulLifeYears, 5);
  assert.equal(norm.isMedicalDevice, true);
  assert.equal(norm.serialNo, '');
  assert.equal(norm.location, '');
  assert.equal(norm.custodian, '');
  assert.ok(Array.isArray(norm.attachments));
});

test('generateNextAssetCode increments sequence for matching prefix and fiscal year', () => {
  const existing = [
    { code: '7440-001-0001/69' },
    { code: '7440-001-0005/69' },
    { code: '7440-001-0012/68' }
  ];
  assert.equal(DepreciationEngine.generateNextAssetCode('7440-001', existing, 2569), '7440-001-0006/69');
  assert.equal(DepreciationEngine.generateNextAssetCode('6515-070', existing, 2569), '6515-070-0001/69');
});

test('buildAssetTimeline aggregates acquisition, transfer, repair, audit, and disposal sorted newest first', () => {
  const asset = { code: '7440-001-0005/56', name: 'com', date: '2020-01-10', price: 9000, dept: 'COM' };
  const transfers = [{ assetCode: '7440-001-0005/56', date: '2022-03-01', fromDept: 'COM', toDept: 'OPD', transferType: 'transfer', requester: 'สมชาย' }];
  const tickets = [{ assetCode: '7440-001-0005/56', date: '2024-06-15', issue: 'เปิดไม่ติด', repairCost: 1500, status: 'ซ่อมเสร็จแล้ว' }];
  const audits = [{ roundName: 'ตรวจนับ 2568', records: { '7440-001-0005/56': { scannedAt: '2025-10-20T09:00:00Z', condition: 'damaged_unrepairable', scannedBy: 'กรรมการ ก.' } } }];
  const disposals = [{ disposalNo: 'จห.2569/001', status: 'completed', completedAt: '2026-02-01T10:00:00Z', method: 'auction', items: [{ code: '7440-001-0005/56' }] }];

  const timeline = DepreciationEngine.buildAssetTimeline(asset, transfers, tickets, audits, disposals);
  assert.equal(timeline.length, 5);
  assert.equal(timeline[0].type, 'disposal');
  assert.equal(timeline[1].type, 'audit');
  assert.equal(timeline[2].type, 'repair');
  assert.equal(timeline[3].type, 'transfer');
  assert.equal(timeline[4].type, 'acquire');
});
