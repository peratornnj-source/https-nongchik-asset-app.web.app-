import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, AuthRBAC, AuditLogger } from '../auth-rbac.js';

test('ROLES defines all 5 MOPH hospital roles with Thai labels', () => {
  assert.deepEqual(Object.keys(ROLES).sort(), ['admin', 'auditor', 'dept_user', 'executive', 'technician']);
  assert.ok(ROLES.admin.label.includes('พัสดุ'));
  assert.ok(ROLES.auditor.label.includes('ตรวจนับ'));
});

test('AuthRBAC.can enforces strict permission matrix across all 5 roles', () => {
  // Admin has full permissions
  assert.equal(AuthRBAC.can('admin', 'asset:write'), true);
  assert.equal(AuthRBAC.can('admin', 'user:manage'), true);
  assert.equal(AuthRBAC.can('admin', 'disposal:approve'), true);
  assert.equal(AuthRBAC.can('admin', 'auditlog:view'), true);

  // Auditor can scan and generate audit report, but cannot write master assets or manage users
  assert.equal(AuthRBAC.can('auditor', 'audit:scan'), true);
  assert.equal(AuthRBAC.can('auditor', 'audit:report'), true);
  assert.equal(AuthRBAC.can('auditor', 'asset:write'), false);
  assert.equal(AuthRBAC.can('auditor', 'user:manage'), false);
  assert.equal(AuthRBAC.can('auditor', 'disposal:approve'), false);

  // Dept user can request transfer/repair only
  assert.equal(AuthRBAC.can('dept_user', 'transfer:request'), true);
  assert.equal(AuthRBAC.can('dept_user', 'repair:request'), true);
  assert.equal(AuthRBAC.can('dept_user', 'asset:write'), false);
  assert.equal(AuthRBAC.can('dept_user', 'audit:finalize'), false);
  assert.equal(AuthRBAC.can('dept_user', 'disposal:manage'), false);

  // Technician can manage repair & PM/calibration, but cannot write assets or approve disposal
  assert.equal(AuthRBAC.can('technician', 'repair:manage'), true);
  assert.equal(AuthRBAC.can('technician', 'pm:manage'), true);
  assert.equal(AuthRBAC.can('technician', 'asset:write'), false);
  assert.equal(AuthRBAC.can('technician', 'disposal:approve'), false);

  // Executive can view executive dashboard, approve disposal, view audit logs, but not edit assets
  assert.equal(AuthRBAC.can('executive', 'dashboard:executive'), true);
  assert.equal(AuthRBAC.can('executive', 'disposal:approve'), true);
  assert.equal(AuthRBAC.can('executive', 'auditlog:view'), true);
  assert.equal(AuthRBAC.can('executive', 'asset:write'), false);
  assert.equal(AuthRBAC.can('executive', 'user:manage'), false);

  // Unknown role denied
  assert.equal(AuthRBAC.can('guest', 'asset:write'), false);
});

test('resolveBootstrapRole grants admin to first registered user and dept_user thereafter', () => {
  assert.equal(AuthRBAC.resolveBootstrapRole(0), 'admin');
  assert.equal(AuthRBAC.resolveBootstrapRole(1), 'dept_user');
  assert.equal(AuthRBAC.resolveBootstrapRole(5, 'auditor'), 'auditor');
});

test('filterAssetsForUser scopes dept_user to own department when scoped flag is enabled', () => {
  const assets = [
    { code: 'A1', dept: 'OPD' },
    { code: 'A2', dept: 'ER' }
  ];
  const deptUser = { role: 'dept_user', dept: 'OPD' };
  const adminUser = { role: 'admin', dept: 'พัสดุ' };

  assert.equal(AuthRBAC.filterAssetsForUser(assets, deptUser, true).length, 1);
  assert.equal(AuthRBAC.filterAssetsForUser(assets, deptUser, true)[0].code, 'A1');
  assert.equal(AuthRBAC.filterAssetsForUser(assets, adminUser, true).length, 2);
});

test('AuditLogger creates normalized entries and filters by action, targetType, and keyword', () => {
  const e1 = AuditLogger.createEntry({
    actor: { uid: 'u1', fullName: 'นางสาวสมหญิง', role: 'admin' },
    action: 'ASSET_CREATE',
    targetType: 'asset',
    targetId: '7440-001-0001/69',
    summary: 'เพิ่มครุภัณฑ์คอมพิวเตอร์ใหม่',
    changes: { price: 25000 }
  });
  const e2 = AuditLogger.createEntry({
    actor: { uid: 'u2', fullName: 'นายช่างใหญ่', role: 'technician' },
    action: 'PM_RECORD',
    targetType: 'pm',
    targetId: 'PM-01',
    summary: 'สอบเทียบเครื่องวัดความดัน'
  });

  assert.ok(e1.id.startsWith('LOG-'));
  assert.ok(e1.timestamp);
  assert.equal(e1.actorRole, 'admin');

  const logs = [e1, e2];
  assert.equal(AuditLogger.filterLogs(logs, { action: 'PM_RECORD' }).length, 1);
  assert.equal(AuditLogger.filterLogs(logs, { targetType: 'asset' }).length, 1);
  assert.equal(AuditLogger.filterLogs(logs, { query: 'ความดัน' }).length, 1);
  assert.equal(AuditLogger.filterLogs(logs, { query: 'สมหญิง' }).length, 1);
});
