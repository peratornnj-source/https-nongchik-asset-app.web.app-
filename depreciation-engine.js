// depreciation-engine.js - Government Asset Register Normalizer, Depreciation (CGD Standard), 13-Digit Code Generator & Timeline
// Compliant with Thai Comptroller General's Department (กรมบัญชีกลาง) straight-line asset accounting.

const USEFUL_LIFE_BY_PREFIX = {
  '7440': 3, // คอมพิวเตอร์และอุปกรณ์ IT
  '6515': 5, // เครื่องมือแพทย์และศัลยกรรม
  '6520': 5, // เครื่องมือทันตกรรม
  '6525': 5, // เครื่องมือรังสีวิทยา
  '7110': 5, // ครุภัณฑ์สำนักงาน
  '7490': 5, // เครื่องใช้สำนักงานอื่นๆ
  '4110': 5, // เครื่องทำความเย็น
  '4120': 5, // เครื่องปรับอากาศ
  '2310': 5, // ยานพาหนะโดยสาร
  '2320': 5  // รถบรรทุก/รถพยาบาล
};

const MEDICAL_PREFIXES = ['6515', '6520', '6525', '6530', '6630', '6640'];

export const FUND_SOURCES = ['งบประมาณ', 'เงินบำรุง', 'เงินบริจาค', 'อื่นๆ', 'ไม่ระบุ'];

function round2(val) {
  return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
}

function parseSafeDate(input) {
  if (!input) return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  const str = String(input).trim();
  if (!str) return null;
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const DepreciationEngine = {
  /**
   * Returns standard useful life (years) based on 4-digit Thai government asset category prefix.
   */
  getDefaultUsefulLife(code) {
    if (!code || typeof code !== 'string') return 5;
    const prefix = code.trim().slice(0, 4);
    return USEFUL_LIFE_BY_PREFIX[prefix] || 5;
  },

  /**
   * Detects whether an asset code belongs to medical/laboratory device classes (65xx/66xx).
   */
  isMedicalCode(code) {
    if (!code || typeof code !== 'string') return false;
    const prefix = code.trim().slice(0, 4);
    return MEDICAL_PREFIXES.includes(prefix);
  },

  /**
   * Backward-compatible normalizer: preserves existing 6 fields and populates standard ผท. fields.
   */
  normalizeAssetRecord(raw = {}) {
    const code = String(raw.code || '').trim();
    const price = Number(raw.price);
    const safePrice = Number.isFinite(price) && price >= 0 ? price : 0;
    const usefulLife = Number(raw.usefulLifeYears);
    const salvage = Number(raw.salvageValue);

    return {
      ...raw,
      code,
      name: String(raw.name || '').trim(),
      price: safePrice,
      date: raw.date ? String(raw.date).trim() : '',
      dept: String(raw.dept || 'ยังไม่ระบุแผนก').trim(),
      status: String(raw.status || 'ใช้งานปกติ').trim(),
      fundSource: raw.fundSource ? String(raw.fundSource).trim() : 'ไม่ระบุ',
      contractNo: raw.contractNo ? String(raw.contractNo).trim() : '',
      vendor: raw.vendor ? String(raw.vendor).trim() : '',
      warrantyExpiry: raw.warrantyExpiry ? String(raw.warrantyExpiry).trim() : '',
      brandModel: raw.brandModel ? String(raw.brandModel).trim() : '',
      serialNo: raw.serialNo ? String(raw.serialNo).trim() : '',
      spec: raw.spec ? String(raw.spec).trim() : '',
      location: raw.location ? String(raw.location).trim() : '',
      custodian: raw.custodian ? String(raw.custodian).trim() : '',
      usefulLifeYears: Number.isFinite(usefulLife) && usefulLife > 0 ? usefulLife : this.getDefaultUsefulLife(code),
      salvageValue: Number.isFinite(salvage) && salvage >= 0 ? salvage : 1,
      photoUrl: raw.photoUrl ? String(raw.photoUrl).trim() : '',
      attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
      isMedicalDevice: typeof raw.isMedicalDevice === 'boolean' ? raw.isMedicalDevice : this.isMedicalCode(code),
      disposalId: raw.disposalId || ''
    };
  },

  /**
   * Straight-line depreciation calculation per Comptroller General's Department standard.
   * Floors NBV at salvageValue (1 THB) when fully depreciated and purchasePrice > salvageValue.
   */
  calculateDepreciation(asset = {}, asOfDate = new Date()) {
    const purchasePrice = Number.isFinite(Number(asset.price)) && Number(asset.price) > 0 ? Number(asset.price) : 0;
    const usefulLifeYears = Number(asset.usefulLifeYears) > 0
      ? Number(asset.usefulLifeYears)
      : this.getDefaultUsefulLife(asset.code);
    const salvageValue = Number.isFinite(Number(asset.salvageValue)) && Number(asset.salvageValue) >= 0
      ? Number(asset.salvageValue)
      : 1;

    if (purchasePrice === 0) {
      return {
        purchasePrice: 0,
        usefulLifeYears,
        salvageValue: 0,
        ageYears: 0,
        annualDepreciation: 0,
        accumulatedDepreciation: 0,
        netBookValue: 0,
        isFullyDepreciated: false
      };
    }

    const effectiveSalvage = purchasePrice > salvageValue ? salvageValue : purchasePrice;
    const depreciableBase = Math.max(0, purchasePrice - effectiveSalvage);
    const annualDepreciation = round2(depreciableBase / usefulLifeYears);

    const acquired = parseSafeDate(asset.date);
    const target = parseSafeDate(asOfDate) || new Date();

    if (!acquired || target <= acquired) {
      return {
        purchasePrice,
        usefulLifeYears,
        salvageValue: effectiveSalvage,
        ageYears: 0,
        annualDepreciation,
        accumulatedDepreciation: 0,
        netBookValue: round2(purchasePrice),
        isFullyDepreciated: false
      };
    }

    const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
    const ageYears = round2((target.getTime() - acquired.getTime()) / msPerYear);

    if (ageYears >= usefulLifeYears) {
      return {
        purchasePrice,
        usefulLifeYears,
        salvageValue: effectiveSalvage,
        ageYears,
        annualDepreciation,
        accumulatedDepreciation: round2(depreciableBase),
        netBookValue: round2(effectiveSalvage),
        isFullyDepreciated: true
      };
    }

    const accumulatedDepreciation = round2(Math.min(depreciableBase, (depreciableBase / usefulLifeYears) * ageYears));
    const netBookValue = round2(Math.max(effectiveSalvage, purchasePrice - accumulatedDepreciation));

    return {
      purchasePrice,
      usefulLifeYears,
      salvageValue: effectiveSalvage,
      ageYears,
      annualDepreciation,
      accumulatedDepreciation,
      netBookValue,
      isFullyDepreciated: false
    };
  },

  /**
   * Generates next 13-digit government asset code: XXXX-XXX-NNNN/YY
   * @param {string} categoryPrefix e.g. '7440-001'
   * @param {Array} existingAssets
   * @param {number} [fiscalYearBE] e.g. 2569 (defaults to current Thai fiscal year)
   */
  generateNextAssetCode(categoryPrefix, existingAssets = [], fiscalYearBE) {
    const cleanPrefix = String(categoryPrefix || '7440-001').trim().replace(/-+$/, '');
    const now = new Date();
    const defaultFY = (now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear()) + 543;
    const fy = Number(fiscalYearBE) || defaultFY;
    const fySuffix = String(fy).slice(-2);

    let maxSeq = 0;
    const escapedPrefix = cleanPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^${escapedPrefix}-(\\d+)\\/${fySuffix}$`);

    (existingAssets || []).forEach(item => {
      const code = String(item?.code || '').trim();
      const match = code.match(regex);
      if (match) {
        const seq = parseInt(match[1], 10);
        if (seq > maxSeq) maxSeq = seq;
      }
    });

    const nextSeq = String(maxSeq + 1).padStart(4, '0');
    return `${cleanPrefix}-${nextSeq}/${fySuffix}`;
  },

  /**
   * Aggregates chronological Asset Movement Timeline (newest first) across all modules.
   */
  buildAssetTimeline(asset, transfers = [], tickets = [], audits = [], disposals = []) {
    if (!asset || !asset.code) return [];
    const code = String(asset.code).trim();
    const events = [];

    if (asset.date) {
      events.push({
        date: asset.date,
        type: 'acquire',
        title: 'รับเข้าทะเบียนคุมทรัพย์สิน',
        detail: `มูลค่า ${Number(asset.price || 0).toLocaleString()} บาท | แหล่งเงิน: ${asset.fundSource || 'ไม่ระบุ'} | แผนก: ${asset.dept || '-'}`,
        actor: asset.vendor || 'งานพัสดุ'
      });
    }

    (transfers || []).forEach(tr => {
      if (tr && String(tr.assetCode || tr.code || '').trim() === code) {
        const isBorrow = tr.transferType === 'borrow';
        events.push({
          date: tr.date || tr.createdAt || '',
          type: 'transfer',
          title: isBorrow ? 'ยืมใช้งานครุภัณฑ์' : 'โอนย้ายแผนก',
          detail: `${tr.fromDept || '-'} → ${tr.toDept || '-'}${tr.dueDate ? ` (กำหนดคืน ${tr.dueDate})` : ''}${tr.returnedAt ? ' [คืนแล้ว]' : ''}`,
          actor: tr.requester || tr.approvedBy || '-'
        });
      }
    });

    (tickets || []).forEach(tk => {
      if (tk && String(tk.assetCode || tk.code || '').trim() === code) {
        const costText = Number(tk.repairCost) > 0 ? ` | ค่าซ่อม ${Number(tk.repairCost).toLocaleString()} บาท` : '';
        events.push({
          date: tk.completedAt || tk.date || tk.createdAt || '',
          type: 'repair',
          title: `แจ้งซ่อม (${tk.status || 'รอดำเนินการ'})`,
          detail: `${tk.issue || tk.description || '-'}${costText}`,
          actor: tk.technicianName || tk.reporter || '-'
        });
      }
    });

    (audits || []).forEach(round => {
      const rec = round?.records?.[code];
      if (rec) {
        events.push({
          date: rec.scannedAt || round.createdAt || '',
          type: 'audit',
          title: `ตรวจนับประจำปี (${round.roundName || round.fiscalYear || '-'})`,
          detail: `ผลตรวจ: ${rec.condition || 'normal'}${rec.notes ? ` (${rec.notes})` : ''}`,
          actor: rec.scannedBy || 'คณะกรรมการตรวจนับ'
        });
      }
    });

    (disposals || []).forEach(disp => {
      const found = Array.isArray(disp?.items) && disp.items.some(i => String(i.code || '').trim() === code);
      if (found) {
        events.push({
          date: disp.completedAt || disp.approvedAt || disp.createdAt || '',
          type: 'disposal',
          title: `ดำเนินการจำหน่าย (${disp.disposalNo || disp.id || '-'})`,
          detail: `สถานะ: ${disp.status || '-'} | วิธี: ${disp.method || '-'}`,
          actor: disp.approvedBy || disp.createdBy || 'งานพัสดุ'
        });
      }
    });

    return events.sort((a, b) => {
      const ta = parseSafeDate(a.date)?.getTime() || 0;
      const tb = parseSafeDate(b.date)?.getTime() || 0;
      return tb - ta;
    });
  }
};
