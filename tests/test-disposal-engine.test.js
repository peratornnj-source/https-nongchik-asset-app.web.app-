import test from 'node:test';
import assert from 'node:assert/strict';
import { DISPOSAL_METHODS, DISPOSAL_STATUSES, DisposalEngine } from '../disposal-engine.js';

test('DISPOSAL_METHODS covers all 5 statutory Thai procurement disposal methods', () => {
  assert.deepEqual(
    Object.keys(DISPOSAL_METHODS).sort(),
    ['auction', 'destroy', 'exchange', 'transfer', 'write_off']
  );
  assert.deepEqual(DISPOSAL_STATUSES, ['draft', 'committee_review', 'approved', 'completed']);
});

test('extractCandidates finds damaged/lost assets from master, audit round, and excludes already disposed', () => {
  const assets = [
    { code: 'A1', name: 'Com 1', price: 10000, status: 'ใช้งานปกติ', dept: 'COM' },
    { code: 'A2', name: 'Com 2', price: 12000, status: 'ชำรุด/รอจำหน่าย', dept: 'OPD' },
    { code: 'A3', name: 'Com 3', price: 8000, status: 'จำหน่ายแล้ว', dept: 'ER' },
    { code: 'A4', name: 'BP Monitor', price: 15000, status: 'ใช้งานปกติ', dept: 'IPD' }
  ];
  const auditRound = {
    items: {
      'A4': { code: 'A4', condition: 'damaged_unrepairable', note: 'บอร์ดเสียไม่คุ้มซ่อม' }
    }
  };
  const candidates = DisposalEngine.extractCandidates(assets, auditRound);
  const codes = candidates.map(c => c.code);
  assert.equal(codes.includes('A2'), true);
  assert.equal(codes.includes('A4'), true);
  assert.equal(codes.includes('A3'), false);
  assert.equal(codes.includes('A1'), false);
});

test('createDisposalRequest generates sequential disposalNo and rejects already-disposed items', () => {
  const existing = [{ disposalNo: 'จห.2569/001' }];
  const req = DisposalEngine.createDisposalRequest({
    fiscalYear: 2569,
    method: 'auction',
    reason: 'ชำรุดเสื่อมสภาพจากการใช้งานเกินอายุ',
    items: [{ code: 'A2', name: 'Com 2', price: 12000, status: 'ชำรุด/รอจำหน่าย' }],
    createdBy: 'นางสาวพัสดุ',
    existingDisposals: existing
  });
  assert.equal(req.disposalNo, 'จห.2569/002');
  assert.equal(req.status, 'draft');
  assert.equal(req.method, 'auction');

  assert.throws(() => {
    DisposalEngine.createDisposalRequest({
      fiscalYear: 2569,
      method: 'auction',
      reason: 'test',
      items: [{ code: 'A3', name: 'Com 3', price: 8000, status: 'จำหน่ายแล้ว' }],
      createdBy: 'Admin'
    });
  }, /จำหน่ายแล้ว/);
});

test('transitionStatus enforces sequential 4-step workflow and required statutory fields', () => {
  const req = DisposalEngine.createDisposalRequest({
    fiscalYear: 2569,
    method: 'destroy',
    reason: 'ชำรุดหมดสภาพ',
    items: [{ code: 'A2', name: 'Com 2', price: 12000, status: 'ชำรุด/รอจำหน่าย' }],
    createdBy: 'Admin'
  });

  // Skipping draft -> completed must throw
  assert.throws(() => DisposalEngine.transitionStatus(req, 'completed', {}), /ข้ามขั้นตอน/);

  // draft -> committee_review requires committeeOrderNo
  assert.throws(() => DisposalEngine.transitionStatus(req, 'committee_review', {}), /เลขที่คำสั่ง/);
  const s1 = DisposalEngine.transitionStatus(req, 'committee_review', {
    committeeOrderNo: 'คำสั่ง รพ.หนองจิก ที่ 120/2569',
    committeeMembers: [{ name: 'นาย ก.', position: 'ประธานกรรมการ' }]
  });
  assert.equal(s1.status, 'committee_review');

  // committee_review -> approved requires approvedBy
  assert.throws(() => DisposalEngine.transitionStatus(s1, 'approved', {}), /ผู้อนุมัติ/);
  const s2 = DisposalEngine.transitionStatus(s1, 'approved', { approvedBy: 'ผู้อำนวยการโรงพยาบาลหนองจิก' });
  assert.equal(s2.status, 'approved');
  assert.ok(s2.approvedAt);

  // approved -> completed
  const s3 = DisposalEngine.transitionStatus(s2, 'completed', { completedBy: 'นางสาวพัสดุ' });
  assert.equal(s3.status, 'completed');
  assert.ok(s3.completedAt);

  // buildMasterDisposalPatches works only on completed disposal
  assert.throws(() => DisposalEngine.buildMasterDisposalPatches(s2), /completed/);
  const patches = DisposalEngine.buildMasterDisposalPatches(s3);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].code, 'A2');
  assert.equal(patches[0].status, 'จำหน่ายแล้ว');
  assert.equal(patches[0].disposalId, s3.id);
});
