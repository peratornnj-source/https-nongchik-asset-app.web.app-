// maintenance-engine.js - Hospital Maintenance Economics, HA PM/Calibration Scheduler & Overdue Borrow Detector

export const DEFAULT_THRESHOLDS = {
  costRatioPercent: 50,
  maxRepairsPerYear: 3,
  pmDueSoonDays: 30
};

function parseDateOnly(input) {
  if (!input) return null;
  const d = input instanceof Date ? new Date(input.getTime()) : new Date(String(input).trim());
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

export const MaintenanceEngine = {
  DEFAULT_THRESHOLDS,

  /**
   * Evaluates cumulative repair cost and frequency for an asset to flag uneconomical repairs
   * (supporting disposal justification under Thai Procurement Regulations).
   */
  evaluateRepairEconomics(asset = {}, tickets = [], thresholds = DEFAULT_THRESHOLDS, asOfDate = new Date()) {
    const t = { ...DEFAULT_THRESHOLDS, ...(thresholds || {}) };
    const code = String(asset.code || '').trim();
    const price = Number.isFinite(Number(asset.price)) && Number(asset.price) > 0 ? Number(asset.price) : 0;
    const refDate = parseDateOnly(asOfDate) || parseDateOnly(new Date());
    const oneYearAgo = new Date(refDate.getTime() - 365 * 24 * 60 * 60 * 1000);

    const related = (tickets || []).filter(tk => String(tk?.assetCode || tk?.code || '').trim() === code);

    let totalRepairCost = 0;
    let repairsLast12Months = 0;

    related.forEach(tk => {
      const cost = Number(tk.repairCost);
      if (Number.isFinite(cost) && cost > 0) totalRepairCost += cost;
      const dt = parseDateOnly(tk.completedAt || tk.date || tk.createdAt);
      if (dt && dt >= oneYearAgo && dt <= refDate) {
        repairsLast12Months += 1;
      }
    });

    const costRatioPercent = price > 0 ? Math.round(((totalRepairCost / price) * 100) * 10) / 10 : 0;
    const reasons = [];
    if (price > 0 && costRatioPercent >= t.costRatioPercent) {
      reasons.push(`ค่าซ่อมสะสม ${costRatioPercent}% เกินเกณฑ์ ${t.costRatioPercent}% ของราคาซื้อ`);
    }
    if (repairsLast12Months >= t.maxRepairsPerYear) {
      reasons.push(`ซ่อมบ่อย ${repairsLast12Months} ครั้งในรอบ 12 เดือน (เกณฑ์ ${t.maxRepairsPerYear} ครั้ง)`);
    }

    return {
      totalRepairCost: Math.round(totalRepairCost * 100) / 100,
      repairCount: related.length,
      repairsLast12Months,
      costRatioPercent,
      isUneconomical: reasons.length > 0,
      reasons
    };
  },

  /**
   * Computes next due date (YYYY-MM-DD) by adding intervalMonths to lastDoneDate.
   */
  calculateNextDueDate(lastDoneDate, intervalMonths = 12) {
    const base = parseDateOnly(lastDoneDate) || parseDateOnly(new Date());
    const months = Number(intervalMonths) > 0 ? Number(intervalMonths) : 12;
    const next = new Date(base.getFullYear(), base.getMonth() + months, base.getDate());
    const y = next.getFullYear();
    const m = String(next.getMonth() + 1).padStart(2, '0');
    const d = String(next.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  /**
   * Classifies a PM/Calibration schedule as 'overdue', 'due_soon', or 'normal'.
   */
  classifyPmStatus(schedule = {}, today = new Date(), dueSoonDays = DEFAULT_THRESHOLDS.pmDueSoonDays) {
    const ref = parseDateOnly(today) || parseDateOnly(new Date());
    const due = parseDateOnly(schedule.nextDueDate);
    if (!due) return { status: 'normal', daysRemaining: 999 };

    const daysRemaining = Math.round((due.getTime() - ref.getTime()) / (24 * 60 * 60 * 1000));
    if (daysRemaining < 0) return { status: 'overdue', daysRemaining };
    if (daysRemaining <= dueSoonDays) return { status: 'due_soon', daysRemaining };
    return { status: 'normal', daysRemaining };
  },

  /**
   * Summarizes overall HA PM/Calibration compliance across all schedules.
   */
  summarizePmCompliance(schedules = [], today = new Date(), dueSoonDays = DEFAULT_THRESHOLDS.pmDueSoonDays) {
    let overdue = 0;
    let dueSoon = 0;
    let normal = 0;

    (schedules || []).forEach(sc => {
      const { status } = this.classifyPmStatus(sc, today, dueSoonDays);
      if (status === 'overdue') overdue++;
      else if (status === 'due_soon') dueSoon++;
      else normal++;
    });

    const total = (schedules || []).length;
    const compliant = total - overdue;
    const compliancePercent = total > 0 ? Math.round((compliant / total) * 100) : 100;

    return { total, overdue, dueSoon, normal, compliancePercent };
  },

  /**
   * Finds unreturned borrow transfers whose dueDate has passed.
   */
  findOverdueBorrows(transfers = [], today = new Date()) {
    const ref = parseDateOnly(today) || parseDateOnly(new Date());
    return (transfers || []).filter(tr => {
      if (!tr || tr.transferType !== 'borrow') return false;
      if (tr.returnedAt || tr.status === 'คืนแล้ว') return false;
      const due = parseDateOnly(tr.dueDate);
      return Boolean(due && due < ref);
    });
  }
};
