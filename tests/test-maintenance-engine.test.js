import test from 'node:test';
import assert from 'node:assert/strict';
import { MaintenanceEngine } from '../maintenance-engine.js';

test('evaluateRepairEconomics detects uneconomical repair when cost >= 50% or >= 3 repairs/year', () => {
  const asset = { code: '6515-070-0001/65', price: 10000 };
  const tickets = [
    { assetCode: '6515-070-0001/65', date: '2026-06-01', repairCost: 3000 },
    { assetCode: '6515-070-0001/65', date: '2026-09-01', repairCost: 2500 },
    { assetCode: 'OTHER', date: '2026-09-01', repairCost: 99999 }
  ];
  const res = MaintenanceEngine.evaluateRepairEconomics(asset, tickets, undefined, '2026-11-20');
  assert.equal(res.totalRepairCost, 5500);
  assert.equal(res.costRatioPercent, 55);
  assert.equal(res.repairCount, 2);
  assert.equal(res.isUneconomical, true);

  // 3 repairs within 12 months even with small cost
  const freqTickets = [
    { assetCode: '6515-070-0001/65', date: '2026-02-01', repairCost: 500 },
    { assetCode: '6515-070-0001/65', date: '2026-05-01', repairCost: 500 },
    { assetCode: '6515-070-0001/65', date: '2026-10-01', repairCost: 500 }
  ];
  const freqRes = MaintenanceEngine.evaluateRepairEconomics(asset, freqTickets, undefined, '2026-11-20');
  assert.equal(freqRes.repairsLast12Months, 3);
  assert.equal(freqRes.isUneconomical, true);

  // Zero price guard (no NaN / Infinity)
  const zeroAsset = { code: 'Z1', price: 0 };
  const zeroRes = MaintenanceEngine.evaluateRepairEconomics(zeroAsset, [{ assetCode: 'Z1', date: '2026-10-01', repairCost: 500 }], undefined, '2026-11-20');
  assert.equal(zeroRes.costRatioPercent, 0);
  assert.equal(Number.isFinite(zeroRes.costRatioPercent), true);
});

test('calculateNextDueDate adds intervalMonths cleanly', () => {
  assert.equal(MaintenanceEngine.calculateNextDueDate('2026-01-15', 6), '2026-07-15');
  assert.equal(MaintenanceEngine.calculateNextDueDate('2026-05-20', 12), '2027-05-20');
});

test('classifyPmStatus and summarizePmCompliance classify overdue, due_soon, and normal accurately', () => {
  const schedules = [
    { id: 'PM1', assetCode: 'A1', nextDueDate: '2026-11-01' }, // overdue
    { id: 'PM2', assetCode: 'A2', nextDueDate: '2026-12-05' }, // due_soon (15 days)
    { id: 'PM3', assetCode: 'A3', nextDueDate: '2027-04-01' }  // normal
  ];
  assert.equal(MaintenanceEngine.classifyPmStatus(schedules[0], '2026-11-20').status, 'overdue');
  assert.equal(MaintenanceEngine.classifyPmStatus(schedules[1], '2026-11-20').status, 'due_soon');
  assert.equal(MaintenanceEngine.classifyPmStatus(schedules[2], '2026-11-20').status, 'normal');

  const summary = MaintenanceEngine.summarizePmCompliance(schedules, '2026-11-20');
  assert.equal(summary.total, 3);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.dueSoon, 1);
  assert.equal(summary.normal, 1);
  assert.equal(summary.compliancePercent, 67);
});

test('findOverdueBorrows returns only unreturned borrows past dueDate', () => {
  const transfers = [
    { id: 'T1', transferType: 'borrow', dueDate: '2026-11-10', returnedAt: '' },
    { id: 'T2', transferType: 'borrow', dueDate: '2026-11-10', returnedAt: '2026-11-09' },
    { id: 'T3', transferType: 'borrow', dueDate: '2026-12-10', returnedAt: '' },
    { id: 'T4', transferType: 'transfer', dueDate: '2026-11-01', returnedAt: '' }
  ];
  const overdue = MaintenanceEngine.findOverdueBorrows(transfers, '2026-11-20');
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].id, 'T1');
});
