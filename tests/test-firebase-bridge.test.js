import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FirebaseBridge } from '../firebase-bridge.js';

test('sanitizeCode replaces forward slashes with underscores and trims', () => {
  assert.equal(FirebaseBridge.sanitizeCode('6515-070-0002/22'), '6515-070-0002_22');
  assert.equal(FirebaseBridge.sanitizeCode('7440-001-0005/100'), '7440-001-0005_100');
  assert.equal(FirebaseBridge.sanitizeCode('  2310-001-0002/6  '), '2310-001-0002_6');
  assert.equal(FirebaseBridge.sanitizeCode(''), '');
});

test('parseConfig handles valid JSON string, JS object snippet, and invalid inputs', () => {
  const jsonStr = '{"apiKey": "AIzaSyFakeKey", "projectId": "nongchik-pms"}';
  const parsed = FirebaseBridge.parseConfig(jsonStr);
  assert.equal(parsed.projectId, 'nongchik-pms');

  const jsSnippet = 'const firebaseConfig = {\n  apiKey: "AIza123",\n  projectId: "test-proj"\n};';
  const parsedSnippet = FirebaseBridge.parseConfig(jsSnippet);
  assert.equal(parsedSnippet.projectId, 'test-proj');

  assert.equal(FirebaseBridge.parseConfig('invalid plain string'), null);
  assert.equal(FirebaseBridge.parseConfig(''), null);
});

test('fallback to localStorage when Firebase is not configured', () => {
  FirebaseBridge.reset();
  assert.equal(FirebaseBridge.getStatus(), 'local_storage');
  assert.equal(FirebaseBridge.isCloudActive(), false);
});

test('extractQrAssetCode correctly parses URL containing slashes in asset code', () => {
  const url1 = 'https://nongchik-asset.web.app/scan/6515-070-0002/22';
  assert.equal(FirebaseBridge.extractQrAssetCode(url1), '6515-070-0002/22');

  const url2 = 'https://nongchik-asset.web.app/scan/7440-001-0005/100';
  assert.equal(FirebaseBridge.extractQrAssetCode(url2), '7440-001-0005/100');

  const rawCode = '6520-004-0001/3';
  assert.equal(FirebaseBridge.extractQrAssetCode(rawCode), '6520-004-0001/3');
});

test('extended FirebaseBridge methods exist and safely fallback in local mode', async () => {
  FirebaseBridge.reset();
  assert.equal(typeof FirebaseBridge.saveUserProfile, 'function');
  assert.equal(typeof FirebaseBridge.getUserProfile, 'function');
  assert.equal(typeof FirebaseBridge.listUserProfiles, 'function');
  assert.equal(typeof FirebaseBridge.appendAuditLog, 'function');
  assert.equal(typeof FirebaseBridge.listenAuditLogs, 'function');
  assert.equal(typeof FirebaseBridge.saveDisposal, 'function');
  assert.equal(typeof FirebaseBridge.listenDisposals, 'function');
  assert.equal(typeof FirebaseBridge.savePmSchedule, 'function');
  assert.equal(typeof FirebaseBridge.listenPmSchedules, 'function');

  assert.equal(await FirebaseBridge.saveUserProfile('u1', { role: 'admin' }), false);
  assert.equal(await FirebaseBridge.getUserProfile('u1'), null);
  assert.deepEqual(await FirebaseBridge.listUserProfiles(), []);
  assert.equal(await FirebaseBridge.appendAuditLog({ id: 'LOG-1', action: 'TEST' }), false);
  assert.equal(await FirebaseBridge.saveDisposal({ id: 'DISP-1' }), false);
  assert.equal(await FirebaseBridge.savePmSchedule({ id: 'PM-1' }), false);
});

test('firestore.rules and storage.rules define RBAC rules for all 5 hospital roles', () => {
  const fsRules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  const stRules = fs.readFileSync(new URL('../storage.rules', import.meta.url), 'utf8');

  assert.ok(fsRules.includes("match /assets/{assetId}"));
  assert.ok(fsRules.includes("match /audit_logs/{logId}"));
  assert.ok(fsRules.includes("match /disposals/{disposalId}"));
  assert.ok(fsRules.includes("match /pm_schedules/{scheduleId}"));
  assert.ok(fsRules.includes("'admin'") && fsRules.includes("'auditor'") && fsRules.includes("'technician'") && fsRules.includes("'executive'"));

  assert.ok(stRules.includes("match /assets/{allPaths=**}"));
  assert.ok(stRules.includes("match /audits/{allPaths=**}"));
  assert.ok(stRules.includes("match /pm/{allPaths=**}"));
});
