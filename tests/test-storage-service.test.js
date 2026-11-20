import test from 'node:test';
import assert from 'node:assert/strict';
import { StorageService } from '../storage-service.js';

test('buildStoragePath sanitizes slashes in asset codes and normalizes filenames', () => {
  const path = StorageService.buildStoragePath('assets', '7440-001-0005/56', 'my photo (1).jpg', 1700000000000);
  assert.equal(path, 'assets/7440-001-0005_56/1700000000000_my_photo__1_.jpg');

  const auditPath = StorageService.buildStoragePath('audits', 'audit_2569', 'evidence.png', 1700000000001);
  assert.equal(auditPath, 'audits/audit_2569/1700000000001_evidence.png');
});

test('validateFile allows images and PDFs <= 5MB and rejects oversized or unsupported files', () => {
  assert.equal(StorageService.validateFile({ name: 'pic.jpg', size: 500_000, type: 'image/jpeg' }).valid, true);
  assert.equal(StorageService.validateFile({ name: 'cert.pdf', size: 2_000_000, type: 'application/pdf' }).valid, true);

  const tooBig = StorageService.validateFile({ name: 'huge.png', size: 6 * 1024 * 1024, type: 'image/png' });
  assert.equal(tooBig.valid, false);
  assert.ok(tooBig.error.includes('5 MB'));

  const badType = StorageService.validateFile({ name: 'malware.exe', size: 1024, type: 'application/x-msdownload' });
  assert.equal(badType.valid, false);
});
