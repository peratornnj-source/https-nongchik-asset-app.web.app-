import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataImporter } from '../data-importer.js';

test('detectColumns correctly identifies Thai and English column variations', () => {
  const headersThai = ['ลำดับ', 'รหัสครุภัณฑ์', 'รายการครุภัณฑ์', 'ราคาจัดซื้อ', 'วันที่ได้มา', 'หน่วยงานที่ครอบครอง', 'สภาพ'];
  const mapping = DataImporter.detectColumns(headersThai);
  assert.equal(mapping.codeKey, 'รหัสครุภัณฑ์');
  assert.equal(mapping.nameKey, 'รายการครุภัณฑ์');
  assert.equal(mapping.priceKey, 'ราคาจัดซื้อ');
  assert.equal(mapping.dateKey, 'วันที่ได้มา');
  assert.equal(mapping.deptKey, 'หน่วยงานที่ครอบครอง');
  assert.equal(mapping.statusKey, 'สภาพ');
});

test('detectColumns handles English headers', () => {
  const headersEng = ['AssetCode', 'Description', 'PurchaseCost', 'AcquireDate', 'Department', 'Status'];
  const mapping = DataImporter.detectColumns(headersEng);
  assert.equal(mapping.codeKey, 'AssetCode');
  assert.equal(mapping.nameKey, 'Description');
  assert.equal(mapping.priceKey, 'PurchaseCost');
  assert.equal(mapping.dateKey, 'AcquireDate');
  assert.equal(mapping.deptKey, 'Department');
  assert.equal(mapping.statusKey, 'Status');
});

test('normalizePrice handles commas, currency symbols, and invalid strings', () => {
  assert.equal(DataImporter.normalizePrice('24,900.50'), 24900.5);
  assert.equal(DataImporter.normalizePrice(' 1,000,000 ฿ '), 1000000);
  assert.equal(DataImporter.normalizePrice(35000), 35000);
  assert.equal(DataImporter.normalizePrice(''), 0);
  assert.equal(DataImporter.normalizePrice(null), 0);
  assert.equal(DataImporter.normalizePrice('ไม่ระบุ'), 0);
});

test('normalizeRows converts varied raw rows to standard asset structure', () => {
  const rawRows = [
    {
      'หมายเลขครุภัณฑ์': '6515-001-0001/1',
      'ชื่อรายการ': 'เครื่องช่วยหายใจ',
      'ราคา': '150,000',
      'วันที่': '2024-05-10',
      'แผนก': 'ICU',
      'สถานะ': 'ใช้งานปกติ'
    }
  ];
  const normalized = DataImporter.normalizeRows(rawRows);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].code, '6515-001-0001/1');
  assert.equal(normalized[0].name, 'เครื่องช่วยหายใจ');
  assert.equal(normalized[0].price, 150000);
  assert.equal(normalized[0].dept, 'ICU');
  assert.equal(normalized[0].status, 'ใช้งานปกติ');
});

test('mergeAssets in merge mode updates existing items and appends new ones', () => {
  const current = [
    { code: 'A1', name: 'Old Name 1', price: 1000, dept: 'OPD', status: 'ใช้งานปกติ' },
    { code: 'A2', name: 'Item 2', price: 2000, dept: 'IPD', status: 'ใช้งานปกติ' }
  ];
  const incoming = [
    { code: 'A1', name: 'Updated Name 1', price: 1500, dept: 'OPD', status: 'ใช้งานปกติ' },
    { code: 'A3', name: 'New Item 3', price: 3000, dept: 'COM', status: 'ใช้งานปกติ' }
  ];

  const result = DataImporter.mergeAssets(current, incoming, 'merge');
  assert.equal(result.merged.length, 3);
  assert.equal(result.updatedCount, 1);
  assert.equal(result.addedCount, 1);
  const a1 = result.merged.find(a => a.code === 'A1');
  assert.equal(a1.name, 'Updated Name 1');
  assert.equal(a1.price, 1500);
});

test('mergeAssets in replace mode completely overwrites existing dataset', () => {
  const current = [{ code: 'A1', name: 'Item 1' }];
  const incoming = [{ code: 'B1', name: 'New Set' }];
  const result = DataImporter.mergeAssets(current, incoming, 'replace');
  assert.equal(result.merged.length, 1);
  assert.equal(result.merged[0].code, 'B1');
});
