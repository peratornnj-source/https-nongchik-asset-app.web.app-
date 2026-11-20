// disposal-engine.js - Statutory Disposal Workflow per Thai Procurement Regulation (2560) Clauses 215-218

export const DISPOSAL_METHODS = {
  auction: { key: 'auction', label: 'ขายทอดตลาด (ข้อ 215(1))' },
  exchange: { key: 'exchange', label: 'แลกเปลี่ยน (ข้อ 215(2))' },
  transfer: { key: 'transfer', label: 'โอนให้หน่วยงานอื่น (ข้อ 215(3))' },
  destroy: { key: 'destroy', label: 'แปรสภาพหรือทำลาย (ข้อ 215(4))' },
  write_off: { key: 'write_off', label: 'จำหน่ายเป็นสูญ (ข้อ 217)' }
};

export const DISPOSAL_STATUSES = ['draft', 'committee_review', 'approved', 'completed'];

export const DISPOSAL_STATUS_LABELS = {
  draft: '1. ร่างเสนอขอจำหน่าย',
  committee_review: '2. ตั้งกรรมการสอบข้อเท็จจริง/ประเมินราคา',
  approved: '3. ผู้อำนวยการอนุมัติจำหน่ายแล้ว',
  completed: '4. ดำเนินการจำหน่ายและลงจ่ายออกจากทะเบียนแล้ว'
};

function isAlreadyDisposed(status) {
  const s = String(status || '').trim();
  return s.includes('จำหน่ายแล้ว') || s.includes('ยกเลิกการใช้');
}

export const DisposalEngine = {
  /**
   * Extracts non-disposed candidate assets eligible for disposal from master status,
   * annual audit results, or uneconomical repair flags.
   */
  extractCandidates(assets = [], auditRound = null, uneconomicalCodes = new Set()) {
    const auditMap = {};
    const rawItems = auditRound?.items || auditRound?.records || {};
    Object.values(rawItems).forEach(rec => {
      if (rec && rec.code) auditMap[String(rec.code).trim()] = rec;
    });

    const uneconSet = uneconomicalCodes instanceof Set ? uneconomicalCodes : new Set(uneconomicalCodes || []);
    const candidates = [];

    (assets || []).forEach(asset => {
      if (!asset || !asset.code) return;
      if (isAlreadyDisposed(asset.status)) return;

      const code = String(asset.code).trim();
      const status = String(asset.status || '');
      const auditRec = auditMap[code];
      const reasons = [];

      if (status.includes('ชำรุด') || status.includes('รอจำหน่าย') || status.includes('เสื่อมสภาพ')) {
        reasons.push(`สถานะทะเบียน: ${status}`);
      }
      if (status.includes('สูญ')) {
        reasons.push('สถานะทะเบียน: สูญหาย');
      }
      if (auditRec && (auditRec.condition === 'damaged_unrepairable' || auditRec.condition === 'lost')) {
        reasons.push(auditRec.condition === 'lost' ? 'ผลตรวจนับประจำปี: สูญหาย' : 'ผลตรวจนับประจำปี: ชำรุดไม่คุ้มซ่อม');
      }
      if (uneconSet.has(code)) {
        reasons.push('ค่าซ่อมสะสมเกินเกณฑ์ไม่คุ้มซ่อม');
      }

      if (reasons.length > 0) {
        candidates.push({
          ...asset,
          candidateReasons: reasons,
          auditPhotoUrl: auditRec?.photoUrl || asset.photoUrl || ''
        });
      }
    });

    return candidates;
  },

  /**
   * Generates next sequential disposal document number: จห.<FY>/<NNN>
   */
  generateDisposalNo(fiscalYear, existingDisposals = []) {
    const fy = Number(fiscalYear) || (new Date().getFullYear() + 543);
    const prefix = `จห.${fy}/`;
    let maxSeq = 0;

    (existingDisposals || []).forEach(d => {
      const no = String(d?.disposalNo || '');
      if (no.startsWith(prefix)) {
        const num = parseInt(no.slice(prefix.length), 10);
        if (Number.isFinite(num) && num > maxSeq) maxSeq = num;
      }
    });

    return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
  },

  /**
   * Creates a new draft disposal request. Rejects empty item lists or already-disposed items.
   */
  createDisposalRequest({ fiscalYear, method = 'auction', reason = '', items = [], createdBy = 'เจ้าหน้าที่พัสดุ', existingDisposals = [] } = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('กรุณาเลือกครุภัณฑ์อย่างน้อย 1 รายการเพื่อขอจำหน่าย');
    }
    if (!DISPOSAL_METHODS[method]) {
      throw new Error('วิธีจำหน่ายไม่ถูกต้องตามระเบียบกระทรวงการคลังฯ');
    }

    const disposedItem = items.find(i => isAlreadyDisposed(i.status));
    if (disposedItem) {
      throw new Error(`ครุภัณฑ์รหัส ${disposedItem.code} อยู่ในสถานะจำหน่ายแล้ว ไม่สามารถขอจำหน่ายซ้ำได้`);
    }

    const now = new Date().toISOString();
    const fy = Number(fiscalYear) || (new Date().getFullYear() + 543);
    const disposalNo = this.generateDisposalNo(fy, existingDisposals);
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();

    return {
      id: `DISP-${Date.now()}-${rand}`,
      disposalNo,
      fiscalYear: fy,
      status: 'draft',
      method,
      reason: String(reason || '').trim(),
      committeeOrderNo: '',
      committeeOrderDate: '',
      committeeMembers: [],
      items: items.map(i => ({
        code: String(i.code || '').trim(),
        name: String(i.name || '').trim(),
        dept: String(i.dept || '-').trim(),
        price: Number(i.price) || 0,
        nbv: Number.isFinite(Number(i.nbv)) ? Number(i.nbv) : 1,
        condition: i.condition || i.status || 'ชำรุด/เสื่อมสภาพ',
        photoUrl: i.photoUrl || i.auditPhotoUrl || '',
        estimatedValue: Number(i.estimatedValue) || 0
      })),
      approvedBy: '',
      approvedAt: '',
      completedBy: '',
      completedAt: '',
      createdBy: String(createdBy || 'เจ้าหน้าที่พัสดุ'),
      createdAt: now,
      updatedAt: now
    };
  },

  /**
   * Enforces strict sequential statutory workflow: draft -> committee_review -> approved -> completed
   */
  transitionStatus(disposal, nextStatus, metadata = {}) {
    if (!disposal || !disposal.status) {
      throw new Error('ข้อมูลคำขอจำหน่ายไม่ถูกต้อง');
    }
    const currentIdx = DISPOSAL_STATUSES.indexOf(disposal.status);
    const nextIdx = DISPOSAL_STATUSES.indexOf(nextStatus);

    if (nextIdx === -1) {
      throw new Error(`สถานะเป้าหมายไม่ถูกต้อง: ${nextStatus}`);
    }
    if (nextIdx !== currentIdx + 1) {
      throw new Error(`ไม่สามารถข้ามขั้นตอนจาก ${disposal.status} ไปยัง ${nextStatus} ได้ตามระเบียบฯ`);
    }

    const now = new Date().toISOString();
    const updated = { ...disposal, status: nextStatus, updatedAt: now };

    if (nextStatus === 'committee_review') {
      if (!metadata.committeeOrderNo || !String(metadata.committeeOrderNo).trim()) {
        throw new Error('กรุณาระบุเลขที่คำสั่งแต่งตั้งคณะกรรมการสอบหาข้อเท็จจริง/ประเมินราคา');
      }
      updated.committeeOrderNo = String(metadata.committeeOrderNo).trim();
      updated.committeeOrderDate = metadata.committeeOrderDate || now.slice(0, 10);
      updated.committeeMembers = Array.isArray(metadata.committeeMembers) ? metadata.committeeMembers : [];
    } else if (nextStatus === 'approved') {
      if (!metadata.approvedBy || !String(metadata.approvedBy).trim()) {
        throw new Error('กรุณาระบุชื่อ/ตำแหน่งผู้อนุมัติจำหน่าย (ผู้อำนวยการ)');
      }
      updated.approvedBy = String(metadata.approvedBy).trim();
      updated.approvedAt = now;
    } else if (nextStatus === 'completed') {
      updated.completedBy = String(metadata.completedBy || 'เจ้าหน้าที่พัสดุ').trim();
      updated.completedAt = now;
      updated.saleProceeds = Number(metadata.saleProceeds) || 0;
      updated.completionNote = String(metadata.completionNote || '').trim();
    }

    return updated;
  },

  /**
   * Generates soft-disposal master asset updates once disposal reaches 'completed'.
   */
  buildMasterDisposalPatches(disposal) {
    if (!disposal || disposal.status !== 'completed') {
      throw new Error('สามารถลงจ่ายออกจากทะเบียนได้เฉพาะคำขอที่อยู่ในสถานะ completed เท่านั้น');
    }
    const methodLabel = DISPOSAL_METHODS[disposal.method]?.label || disposal.method;
    return (disposal.items || []).map(item => ({
      code: item.code,
      status: 'จำหน่ายแล้ว',
      disposalId: disposal.id,
      disposalNo: disposal.disposalNo,
      disposalMethod: methodLabel,
      disposedAt: disposal.completedAt || new Date().toISOString()
    }));
  }
};
