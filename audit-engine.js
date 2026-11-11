// audit-engine.js - Annual Audit State, Fast Scan & Reconciliation Engine
// Compatible with Node.js and Browser environments

import { FirebaseBridge } from './firebase-bridge.js';

const sanitize = (code) => {
  if (typeof FirebaseBridge !== 'undefined' && FirebaseBridge.sanitizeCode) {
    return FirebaseBridge.sanitizeCode(code);
  }
  return (code || '').trim().replace(/\//g, '_');
};

export const AuditEngine = {
  /**
   * Filters out historically written-off/disposed assets from the audit denominator.
   * Regulation specifies that assets already disposed in prior years are no longer active inventory.
   */
  filterActiveAssets(allAssets) {
    if (!Array.isArray(allAssets)) return [];
    return allAssets.filter(asset => {
      const status = (asset.status || '').trim();
      return status !== 'จำหน่ายแล้ว/ยกเลิกการใช้' && status !== 'จำหน่ายแล้ว';
    });
  },

  /**
   * Creates a new annual audit round data structure.
   */
  createRound(fiscalYear, orderNo = '', orderDate = '', committee = []) {
    return {
      fiscalYear: String(fiscalYear || new Date().getFullYear() + 543),
      orderNo: orderNo || '',
      orderDate: orderDate || '',
      committee: Array.isArray(committee) ? committee : [],
      status: 'in_progress', // 'in_progress' | 'finalized'
      items: {}, // Keyed by sanitized asset code
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString()
    };
  },

  /**
   * Records a scan during continuous audit.
   * Default condition is 'normal' for fast continuous operation.
   */
  recordScan(round, assetCode, auditorName, condition = 'normal', notes = '') {
    if (!round) throw new Error('Round is required');
    if (round.status === 'finalized') {
      throw new Error('This annual audit round is finalized and locked.');
    }
    if (!assetCode) throw new Error('Asset code is required');

    const sanitized = sanitize(assetCode);
    const isNewScan = !round.items || !round.items[sanitized];

    if (!round.items) round.items = {};

    const itemRecord = {
      code: assetCode,
      condition: condition || 'normal', // 'normal' | 'damaged_repairable' | 'deteriorated_unusable' | 'lost'
      notes: notes || '',
      auditorName: auditorName || 'ผู้ตรวจนับ',
      auditedAt: new Date().toISOString()
    };

    round.items[sanitized] = itemRecord;
    round.lastUpdated = new Date().toISOString();

    return { round, item: itemRecord, isNewScan };
  },

  /**
   * Explicitly marks a missing/unscanned asset as lost with a reason.
   */
  markExplicitLost(round, assetCode, auditorName, reason = '') {
    const res = this.recordScan(round, assetCode, auditorName, 'lost', reason);
    return res.round;
  },

  /**
   * Computes comprehensive statistics for the audit round against active master assets.
   */
  computeSummary(round, activeAssets) {
    const assets = this.filterActiveAssets(activeAssets);
    const totalCount = assets.length;
    let totalValue = 0;

    const assetsMap = new Map();
    assets.forEach(a => {
      const sanitized = sanitize(a.code);
      assetsMap.set(sanitized, a);
      totalValue += Number(a.price) || 0;
    });

    const items = round && round.items ? round.items : {};
    let scannedCount = 0;
    let normalCount = 0;
    let damagedRepairableCount = 0;
    let deterioratedUnusableCount = 0;
    let lostCount = 0;

    let normalValue = 0;
    let damagedRepairableValue = 0;
    let deterioratedUnusableValue = 0;
    let lostValue = 0;

    Object.entries(items).forEach(([key, rec]) => {
      // Only count items that are part of the active inventory denominator
      if (!assetsMap.has(key)) return;

      scannedCount++;
      const asset = assetsMap.get(key);
      const price = asset ? (Number(asset.price) || 0) : 0;

      switch (rec.condition) {
        case 'normal':
          normalCount++;
          normalValue += price;
          break;
        case 'damaged_repairable':
          damagedRepairableCount++;
          damagedRepairableValue += price;
          break;
        case 'deteriorated_unusable':
          deterioratedUnusableCount++;
          deterioratedUnusableValue += price;
          break;
        case 'lost':
          lostCount++;
          lostValue += price;
          break;
        default:
          normalCount++;
          normalValue += price;
      }
    });

    const scannedTotalValue = normalValue + damagedRepairableValue + deterioratedUnusableValue + lostValue;
    const pendingCount = Math.max(0, totalCount - scannedCount);
    const progressPercent = totalCount > 0 ? Math.round((scannedCount / totalCount) * 100) : 0;

    return {
      totalCount,
      totalValue,
      scannedCount,
      scannedTotalValue,
      pendingCount,
      progressPercent,
      normalCount,
      normalValue,
      damagedRepairableCount,
      damagedRepairableValue,
      deterioratedUnusableCount,
      deterioratedUnusableValue,
      lostCount,
      lostValue
    };
  },

  /**
   * Identifies pending assets grouped by department for reconciliation.
   */
  getPendingAssetsByDept(round, activeAssets) {
    const assets = this.filterActiveAssets(activeAssets);
    const scannedSet = new Set(Object.keys(round?.items || {}));

    const deptMap = new Map();

    assets.forEach(asset => {
      const sanitized = sanitize(asset.code);
      if (!scannedSet.has(sanitized)) {
        const dept = asset.dept || 'ยังไม่ระบุแผนก';
        if (!deptMap.has(dept)) {
          deptMap.set(dept, []);
        }
        deptMap.get(dept).push(asset);
      }
    });

    return deptMap;
  },

  /**
   * Finalizes and locks the audit round.
   */
  finalizeRound(round) {
    if (!round) throw new Error('Round is required');
    return {
      ...round,
      status: 'finalized',
      finalizedAt: new Date().toISOString()
    };
  },

  /**
   * Generates master ledger updates based on audit findings.
   */
  generateMasterUpdates(round, activeAssets) {
    const assets = this.filterActiveAssets(activeAssets);
    const items = round?.items || {};
    const updates = [];

    assets.forEach(asset => {
      const sanitized = sanitize(asset.code);
      const auditRec = items[sanitized];
      if (!auditRec) return;

      let newStatus = null;
      if (auditRec.condition === 'deteriorated_unusable') {
        newStatus = 'รอจำหน่าย';
      } else if (auditRec.condition === 'lost') {
        newStatus = 'สูญไป/หาไม่พบ';
      } else if (auditRec.condition === 'damaged_repairable') {
        newStatus = 'รอซ่อมแซม';
      }

      if (newStatus && newStatus !== asset.status) {
        updates.push({
          code: asset.code,
          name: asset.name,
          oldStatus: asset.status,
          newStatus: newStatus,
          condition: auditRec.condition,
          notes: auditRec.notes || ''
        });
      }
    });

    return updates;
  }
};

// Expose globally for browser
if (typeof window !== 'undefined') {
  window.AuditEngine = AuditEngine;
}
