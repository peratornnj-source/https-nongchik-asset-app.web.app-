// data-importer.js - Multi-Format Spreadsheet & Database Importer
// Compatible with Node.js and Browser environments

const FIELD_PATTERNS = {
  code: [/รหัสครุภัณฑ์/i, /เลขครุภัณฑ์/i, /หมายเลขครุภัณฑ์/i, /asset_?code/i, /asset_?no/i, /^code$/i, /^id$/i, /รหัส/i, /เลข/i],
  name: [/รายการครุภัณฑ์/i, /ชื่อรายการ/i, /ชื่อครุภัณฑ์/i, /ชื่อทรัพย์สิน/i, /^รายการ$/i, /^name$/i, /^description$/i, /ชื่อ/i, /รายการ/i],
  price: [/ราคาจัดซื้อ/i, /ราคาต่อหน่วย/i, /ราคา/i, /มูลค่า/i, /วงเงิน/i, /price/i, /cost/i, /value/i, /amount/i],
  date: [/วันที่ได้มา/i, /วันที่ตรวจรับ/i, /วันที่จัดซื้อ/i, /^วันที่$/i, /^date$/i, /acquire/i, /received/i, /ปีงบ/i],
  dept: [/หน่วยงานที่ครอบครอง/i, /แผนกที่ครองครอง/i, /^แผนก$/i, /^หน่วยงาน$/i, /^ฝ่าย$/i, /^ตึก$/i, /^ที่ตั้ง$/i, /^dept$/i, /^department$/i, /^location$/i],
  status: [/^สภาพ$/i, /^สถานะ$/i, /^status$/i, /^condition$/i]
};

function matchHeader(header, patterns) {
  if (!header || typeof header !== 'string') return false;
  const clean = header.trim();
  return patterns.some(p => p.test(clean));
}

export const DataImporter = {
  /**
   * Detects the mapping between raw table column headers and standard asset fields.
   */
  detectColumns(headers) {
    if (!Array.isArray(headers)) return {};

    const mapping = {
      codeKey: '',
      nameKey: '',
      priceKey: '',
      dateKey: '',
      deptKey: '',
      statusKey: ''
    };

    headers.forEach(h => {
      if (!h) return;
      if (!mapping.codeKey && matchHeader(h, FIELD_PATTERNS.code)) mapping.codeKey = h;
      else if (!mapping.nameKey && matchHeader(h, FIELD_PATTERNS.name)) mapping.nameKey = h;
      else if (!mapping.priceKey && matchHeader(h, FIELD_PATTERNS.price)) mapping.priceKey = h;
      else if (!mapping.dateKey && matchHeader(h, FIELD_PATTERNS.date)) mapping.dateKey = h;
      else if (!mapping.deptKey && matchHeader(h, FIELD_PATTERNS.dept)) mapping.deptKey = h;
      else if (!mapping.statusKey && matchHeader(h, FIELD_PATTERNS.status)) mapping.statusKey = h;
    });

    return mapping;
  },

  /**
   * Cleans and converts raw price strings/numbers into standard numeric floats.
   */
  normalizePrice(val) {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (typeof val !== 'string') return 0;

    const cleaned = val.replace(/,/g, '').replace(/[฿\sBaht]/gi, '').trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  },

  /**
   * Normalizes raw dates (Excel serial numbers, Thai BE years, standard ISO) into YYYY-MM-DD.
   */
  normalizeDate(val) {
    if (!val) return '';
    if (typeof val === 'number') {
      // Excel serial date number
      try {
        const dateObj = new Date((val - (25567 + 2)) * 86400 * 1000);
        if (!isNaN(dateObj.getTime())) {
          return dateObj.toISOString().slice(0, 10);
        }
      } catch {}
    }

    const str = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
      return str.slice(0, 10);
    }

    return str;
  },

  /**
   * Normalizes raw row objects into standard hospital asset objects.
   */
  normalizeRows(rawRows, customMapping) {
    if (!Array.isArray(rawRows) || rawRows.length === 0) return [];

    const firstRow = rawRows[0] || {};
    const headers = Object.keys(firstRow);
    const mapping = customMapping || this.detectColumns(headers);

    return rawRows.map((row, idx) => {
      const code = mapping.codeKey && row[mapping.codeKey] 
        ? String(row[mapping.codeKey]).trim() 
        : (row.code || `IMPORTED-${idx + 1}`);

      const name = mapping.nameKey && row[mapping.nameKey] 
        ? String(row[mapping.nameKey]).trim() 
        : (row.name || 'ไม่ระบุชื่อรายการ');

      const price = mapping.priceKey && row[mapping.priceKey] !== undefined 
        ? this.normalizePrice(row[mapping.priceKey]) 
        : this.normalizePrice(row.price);

      const date = mapping.dateKey && row[mapping.dateKey] 
        ? this.normalizeDate(row[mapping.dateKey]) 
        : this.normalizeDate(row.date);

      const dept = mapping.deptKey && row[mapping.deptKey] 
        ? String(row[mapping.deptKey]).trim() 
        : (row.dept || 'ยังไม่ระบุแผนก');

      const status = mapping.statusKey && row[mapping.statusKey] 
        ? String(row[mapping.statusKey]).trim() 
        : (row.status || 'ใช้งานปกติ');

      return {
        code,
        name,
        price,
        date,
        dept,
        status
      };
    }).filter(a => Boolean(a.code && a.code !== '-'));
  },

  /**
   * Parses JSON string into normalized asset rows.
   */
  parseJSON(text) {
    if (!text || typeof text !== 'string') return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return this.normalizeRows(parsed);
      } else if (parsed && Array.isArray(parsed.assets)) {
        return this.normalizeRows(parsed.assets);
      }
      return [];
    } catch {
      return [];
    }
  },

  /**
   * Merges incoming imported assets with current dataset.
   * Mode:
   * - 'replace': completely replaces current assets with imported ones.
   * - 'merge': updates existing matching codes, appends new codes (Upsert).
   */
  mergeAssets(currentAssets = [], importedAssets = [], mode = 'merge') {
    if (!Array.isArray(importedAssets)) {
      return { merged: currentAssets, addedCount: 0, updatedCount: 0 };
    }

    if (mode === 'replace') {
      return {
        merged: [...importedAssets],
        addedCount: importedAssets.length,
        updatedCount: 0
      };
    }

    const currentMap = new Map();
    (currentAssets || []).forEach(a => currentMap.set(a.code, { ...a }));

    let addedCount = 0;
    let updatedCount = 0;

    importedAssets.forEach(incoming => {
      if (!incoming.code) return;
      if (currentMap.has(incoming.code)) {
        const existing = currentMap.get(incoming.code);
        currentMap.set(incoming.code, {
          ...existing,
          ...incoming
        });
        updatedCount++;
      } else {
        currentMap.set(incoming.code, incoming);
        addedCount++;
      }
    });

    return {
      merged: Array.from(currentMap.values()),
      addedCount,
      updatedCount
    };
  }
};

// Expose globally for browser
if (typeof window !== 'undefined') {
  window.DataImporter = DataImporter;
}
