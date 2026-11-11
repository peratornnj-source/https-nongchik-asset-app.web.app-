import { test } from 'node:test';
import assert from 'node:assert/strict';
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
});
