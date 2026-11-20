// gov-forms.js - Official Thai Government A4 Printable Forms (MOPH / โรงพยาบาลหนองจิก)
// Generates XSS-safe printable A4 HTML documents for:
// 1. ทะเบียนคุมทรัพย์สิน (แบบ ผท.)
// 2. ใบโอนย้ายครุภัณฑ์ / ใบยืม-คืนครุภัณฑ์
// 3. บันทึกข้อความรายงานผลการตรวจสอบพัสดุประจำปี (ข้อ 213)
// 4. แบบขออนุมัติจำหน่ายพัสดุ (ข้อ 215-218)

import { DISPOSAL_METHODS } from './disposal-engine.js';

function esc(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtMoney(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtThaiDate(dateStr) {
  if (!dateStr) return '.......................................';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return esc(dateStr);
  const months = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];
  return `${d.getDate()} ${months[d.getMonth()]} พ.ศ. ${d.getFullYear() + 543}`;
}

function wrapA4Document(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8" />
  <title>${esc(title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>
    @page { size: A4 portrait; margin: 16mm 18mm 16mm 22mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Sarabun', 'TH SarabunPSK', sans-serif; font-size: 14pt; line-height: 1.45; color: #111; margin: 0; padding: 0; }
    h1, h2, h3 { margin: 0; }
    .header-center { text-align: center; margin-bottom: 14px; }
    .org-title { font-size: 16pt; font-weight: 700; }
    .doc-subtitle { font-size: 13pt; color: #333; }
    .meta-grid { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 12.5pt; }
    .meta-grid td { padding: 4px 6px; vertical-align: top; }
    .data-table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 12pt; }
    .data-table th, .data-table td { border: 1px solid #333; padding: 5px 7px; vertical-align: top; }
    .data-table th { background: #f1f5f9; font-weight: 700; text-align: center; }
    .num { text-align: right; white-space: nowrap; }
    .center { text-align: center; }
    .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 22px 28px; margin-top: 26px; page-break-inside: avoid; }
    .sig-box { text-align: center; font-size: 12.5pt; }
    .sig-line { margin-top: 34px; }
    .memo-header { display: flex; align-items: flex-end; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 14px; }
    .memo-title { flex: 1; text-align: center; font-size: 20pt; font-weight: 700; }
    .indent { text-indent: 2.2cm; margin: 8px 0; text-align: justify; }
    @media print { .no-print { display: none !important; } }
  </style>
</head>
<body>
  <div class="no-print" style="background:#0f766e;color:#fff;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;font-family:sans-serif;font-size:13px;">
    <span>ตัวอย่างเอกสารราชการ A4: ${esc(title)}</span>
    <button onclick="window.print()" style="background:#fff;color:#0f766e;border:none;padding:6px 14px;border-radius:6px;font-weight:bold;cursor:pointer;">พิมพ์ / บันทึก PDF</button>
  </div>
  ${bodyHtml}
</body>
</html>`;
}

export const GovForms = {
  /**
   * 1. ทะเบียนคุมทรัพย์สิน (แบบ ผท.)
   */
  renderAssetRegisterCard(asset = {}, depreciation = {}, history = []) {
    const historyRows = (history || []).slice(0, 12).map((ev, idx) => `
      <tr>
        <td class="center">${idx + 1}</td>
        <td class="center">${esc(ev.date ? String(ev.date).slice(0, 10) : '-')}</td>
        <td>${esc(ev.title || '-')}</td>
        <td>${esc(ev.detail || '-')}</td>
        <td>${esc(ev.actor || '-')}</td>
      </tr>`).join('') || `<tr><td colspan="5" class="center">ยังไม่มีประวัติการเคลื่อนไหวเพิ่มเติม</td></tr>`;

    const body = `
      <div class="header-center">
        <div class="org-title">ทะเบียนคุมทรัพย์สิน (แบบ ผท.)</div>
        <div class="doc-subtitle">โรงพยาบาลหนองจิก สำนักงานสาธารณสุขจังหวัดปัตตานี กระทรวงสาธารณสุข</div>
      </div>

      <table class="meta-grid">
        <tr>
          <td style="width:55%"><strong>รหัสครุภัณฑ์:</strong> ${esc(asset.code)}</td>
          <td><strong>สถานะปัจจุบัน:</strong> ${esc(asset.status || 'ใช้งานปกติ')}</td>
        </tr>
        <tr>
          <td><strong>ชื่อครุภัณฑ์:</strong> ${esc(asset.name)}</td>
          <td><strong>ประเภทแหล่งเงิน:</strong> ${esc(asset.fundSource || 'ไม่ระบุ')}</td>
        </tr>
        <tr>
          <td><strong>ยี่ห้อ / รุ่น:</strong> ${esc(asset.brandModel || '-')}</td>
          <td><strong>หมายเลขเครื่อง (S/N):</strong> ${esc(asset.serialNo || '-')}</td>
        </tr>
        <tr>
          <td><strong>หน่วยงาน/แผนกที่ใช้:</strong> ${esc(asset.dept || '-')}</td>
          <td><strong>สถานที่ตั้ง:</strong> ${esc(asset.location || '-')}</td>
        </tr>
        <tr>
          <td><strong>ผู้รับผิดชอบ (Custodian):</strong> ${esc(asset.custodian || '-')}</td>
          <td><strong>เลขที่สัญญา/ใบสั่งซื้อ:</strong> ${esc(asset.contractNo || '-')}</td>
        </tr>
        <tr>
          <td><strong>ชื่อผู้ขาย/ผู้รับจ้าง:</strong> ${esc(asset.vendor || '-')}</td>
          <td><strong>วันหมดประกัน:</strong> ${asset.warrantyExpiry ? fmtThaiDate(asset.warrantyExpiry) : '-'}</td>
        </tr>
        <tr>
          <td colspan="2"><strong>คุณลักษณะเฉพาะ:</strong> ${esc(asset.spec || '-')}</td>
        </tr>
      </table>

      <h3 style="font-size:14pt;margin-top:8px;">ข้อมูลการได้มาและการคำนวณค่าเสื่อมราคา (เกณฑ์กรมบัญชีกลาง)</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>วันที่ได้มา</th>
            <th>ราคาทุน (บาท)</th>
            <th>อายุการใช้งาน (ปี)</th>
            <th>ค่าเสื่อมราคาต่อปี (บาท)</th>
            <th>ค่าเสื่อมราคาสะสม (บาท)</th>
            <th>มูลค่าสุทธิตามบัญชี NBV (บาท)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="center">${fmtThaiDate(asset.date)}</td>
            <td class="num">${fmtMoney(depreciation.purchasePrice ?? asset.price)}</td>
            <td class="center">${esc(depreciation.usefulLifeYears ?? asset.usefulLifeYears ?? 5)}</td>
            <td class="num">${fmtMoney(depreciation.annualDepreciation)}</td>
            <td class="num">${fmtMoney(depreciation.accumulatedDepreciation)}</td>
            <td class="num"><strong>${fmtMoney(depreciation.netBookValue)}</strong></td>
          </tr>
        </tbody>
      </table>

      <h3 style="font-size:14pt;margin-top:12px;">ประวัติการเคลื่อนไหว ซ่อมบำรุง และตรวจสอบประจำปี</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:45px">ลำดับ</th>
            <th style="width:95px">วันที่</th>
            <th style="width:160px">รายการ</th>
            <th>รายละเอียด</th>
            <th style="width:130px">ผู้ดำเนินการ</th>
          </tr>
        </thead>
        <tbody>${historyRows}</tbody>
      </table>

      <div class="sig-grid">
        <div class="sig-box">
          <div class="sig-line">ลงชื่อ ....................................................... ผู้จัดทำทะเบียน</div>
          <div>(.......................................................)</div>
          <div>เจ้าหน้าที่พัสดุ</div>
        </div>
        <div class="sig-box">
          <div class="sig-line">ลงชื่อ ....................................................... ผู้ตรวจสอบ</div>
          <div>(.......................................................)</div>
          <div>หัวหน้าเจ้าหน้าที่</div>
        </div>
      </div>
    `;
    return wrapA4Document(`ทะเบียนคุมทรัพย์สิน_${asset.code || ''}`, body);
  },

  /**
   * 2. ใบโอนย้ายครุภัณฑ์ หรือ ใบยืม-คืนครุภัณฑ์
   */
  renderTransferOrBorrowForm(transfer = {}, asset = {}) {
    const isBorrow = transfer.transferType === 'borrow';
    const docTitle = isBorrow ? 'ใบยืม-คืนครุภัณฑ์' : 'ใบโอนย้ายครุภัณฑ์';

    const body = `
      <div class="header-center">
        <div class="org-title">${docTitle}</div>
        <div class="doc-subtitle">โรงพยาบาลหนองจิก สำนักงานสาธารณสุขจังหวัดปัตตานี</div>
      </div>

      <table class="meta-grid">
        <tr>
          <td style="width:55%"><strong>เลขที่เอกสาร:</strong> ${esc(transfer.docNo || transfer.id || '-')}</td>
          <td><strong>วันที่ทำรายการ:</strong> ${fmtThaiDate(transfer.date || transfer.createdAt)}</td>
        </tr>
        <tr>
          <td><strong>หน่วยงานผู้ส่งมอบ/ให้ยืม:</strong> ${esc(transfer.fromDept || asset.dept || '-')}</td>
          <td><strong>หน่วยงานผู้รับมอบ/ขอยืม:</strong> ${esc(transfer.toDept || '-')}</td>
        </tr>
        ${isBorrow ? `
        <tr>
          <td><strong>กำหนดส่งคืน:</strong> ${esc(transfer.dueDate || '-')}</td>
          <td><strong>สถานะการคืน:</strong> ${transfer.returnedAt ? `คืนแล้ว (${fmtThaiDate(transfer.returnedAt)})` : 'ยังไม่ส่งคืน'}</td>
        </tr>` : ''}
        <tr>
          <td colspan="2"><strong>เหตุผล/วัตถุประสงค์:</strong> ${esc(transfer.reason || transfer.note || 'เพื่อใช้ในราชการ')}</td>
        </tr>
      </table>

      <table class="data-table">
        <thead>
          <tr>
            <th style="width:50px">ลำดับ</th>
            <th style="width:160px">รหัสครุภัณฑ์</th>
            <th>รายการครุภัณฑ์</th>
            <th style="width:120px">หมายเลขเครื่อง</th>
            <th style="width:110px">มูลค่า (บาท)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="center">1</td>
            <td class="center">${esc(asset.code || transfer.assetCode || '-')}</td>
            <td>${esc(asset.name || transfer.assetName || '-')}</td>
            <td class="center">${esc(asset.serialNo || '-')}</td>
            <td class="num">${fmtMoney(asset.price || transfer.price || 0)}</td>
          </tr>
        </tbody>
      </table>

      <div class="sig-grid">
        <div class="sig-box">
          <div class="sig-line">ลงชื่อ ....................................................... ผู้ส่งมอบ</div>
          <div>(.......................................................)</div>
          <div>แผนก ${esc(transfer.fromDept || '-')}</div>
        </div>
        <div class="sig-box">
          <div class="sig-line">ลงชื่อ ....................................................... ผู้รับมอบ</div>
          <div>(${esc(transfer.requester || '.......................................................')})</div>
          <div>แผนก ${esc(transfer.toDept || '-')}</div>
        </div>
        <div class="sig-box">
          <div class="sig-line">ลงชื่อ ....................................................... เจ้าหน้าที่พัสดุ</div>
          <div>(.......................................................)</div>
          <div>งานพัสดุ โรงพยาบาลหนองจิก</div>
        </div>
        <div class="sig-box">
          <div class="sig-line">ลงชื่อ ....................................................... ผู้อนุมัติ</div>
          <div>(.......................................................)</div>
          <div>ผู้อำนวยการโรงพยาบาลหนองจิก</div>
        </div>
      </div>
    `;
    return wrapA4Document(`${docTitle}_${transfer.docNo || asset.code || ''}`, body);
  },

  /**
   * 3. บันทึกข้อความรายงานผลการตรวจสอบพัสดุประจำปี (ระเบียบฯ ข้อ 213)
   */
  renderAnnualAuditMemo(auditRound = {}, reportData = {}) {
    const fy = auditRound.fiscalYear || (new Date().getFullYear() + 543);
    const s = reportData.summary || {};
    const committee = Array.isArray(auditRound.committee) && auditRound.committee.length > 0
      ? auditRound.committee
      : [{ name: '.......................................................', position: 'ประธานกรรมการ' }];

    const committeeSigs = committee.map(c => `
      <div class="sig-box">
        <div class="sig-line">ลงชื่อ .......................................................</div>
        <div>(${esc(c.name || '.......................................................')})</div>
        <div>${esc(c.position || 'กรรมการ')}</div>
      </div>`).join('');

    const body = `
      <div class="memo-header">
        <div style="width:70px;font-weight:700;font-size:11pt;border:1px solid #333;padding:6px;text-align:center;">ครุฑ<br/>ราชการ</div>
        <div class="memo-title">บันทึกข้อความ</div>
        <div style="width:70px;"></div>
      </div>

      <table class="meta-grid" style="margin-bottom:8px;">
        <tr>
          <td style="width:55%"><strong>ส่วนราชการ</strong> คณะกรรมการตรวจสอบพัสดุประจำปี โรงพยาบาลหนองจิก</td>
          <td></td>
        </tr>
        <tr>
          <td><strong>ที่</strong> ปน 0033.301/........................</td>
          <td><strong>วันที่</strong> ${fmtThaiDate(new Date().toISOString())}</td>
        </tr>
        <tr>
          <td colspan="2"><strong>เรื่อง</strong> รายงานผลการตรวจสอบพัสดุประจำปีงบประมาณ พ.ศ. ${esc(fy)} (ตามระเบียบกระทรวงการคลังฯ พ.ศ. 2560 ข้อ 213)</td>
        </tr>
      </table>

      <p><strong>เรียน</strong> ผู้อำนวยการโรงพยาบาลหนองจิก</p>

      <p class="indent">
        ตามคำสั่งโรงพยาบาลหนองจิก ${esc(auditRound.orderNo || 'ที่ ........../..........')}
        ลงวันที่ ${fmtThaiDate(auditRound.orderDate)} ได้แต่งตั้งคณะกรรมการตรวจสอบพัสดุประจำปีงบประมาณ พ.ศ. ${esc(fy)}
        เพื่อดำเนินการตรวจสอบการรับจ่ายพัสดุและตรวจนับพัสดุคงเหลือให้เป็นไปตามระเบียบกระทรวงการคลังว่าด้วยการจัดซื้อจัดจ้างและการบริหารพัสดุภาครัฐ พ.ศ. 2560 ข้อ 213 นั้น
      </p>

      <p class="indent">
        บัดนี้ คณะกรรมการฯ ได้ดำเนินการตรวจสอบพัสดุคงเหลือของโรงพยาบาลหนองจิกเสร็จสิ้นเรียบร้อยแล้ว จึงขอรายงานสรุปผลการตรวจสอบ ดังนี้
      </p>

      <table class="data-table">
        <thead>
          <tr>
            <th>รายการสภาพพัสดุตามผลการตรวจสอบ</th>
            <th style="width:120px">จำนวน (รายการ)</th>
            <th style="width:150px">หมายเหตุ / แนวทางดำเนินการ</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1. พัสดุที่อยู่ในสภาพใช้งานปกติ</td>
            <td class="num">${Number(s.normal || 0).toLocaleString()}</td>
            <td>ใช้งานราชการต่อไป</td>
          </tr>
          <tr>
            <td>2. พัสดุชำรุด (สามารถซ่อมแซมได้)</td>
            <td class="num">${Number(s.damagedRepairable || 0).toLocaleString()}</td>
            <td>แจ้งงานซ่อมบำรุง</td>
          </tr>
          <tr>
            <td>3. พัสดุชำรุด เสื่อมสภาพ หรือไม่จำเป็นต้องใช้ในราชการ</td>
            <td class="num">${Number(s.damagedUnrepairable || 0).toLocaleString()}</td>
            <td>เสนอแต่งตั้งกรรมการจำหน่าย (ข้อ 215)</td>
          </tr>
          <tr>
            <td>4. พัสดุสูญไป / หาไม่พบ</td>
            <td class="num">${Number(s.lost || 0).toLocaleString()}</td>
            <td>เสนอตั้งกรรมการสอบข้อเท็จจริง (ข้อ 214)</td>
          </tr>
          <tr style="font-weight:700;background:#f8fafc;">
            <td>รวมครุภัณฑ์ที่ตรวจสอบทั้งหมด (มูลค่าทุนรวม ${fmtMoney(s.totalValue || 0)} บาท)</td>
            <td class="num">${Number(s.totalActive || 0).toLocaleString()}</td>
            <td>แนบบัญชีรายละเอียดท้ายบันทึกนี้</td>
          </tr>
        </tbody>
      </table>

      <p class="indent">จึงเรียนมาเพื่อโปรดทราบและพิจารณาดำเนินการตามระเบียบฯ ต่อไป</p>

      <div class="sig-grid">${committeeSigs}</div>

      <div style="margin-top:26px;border:1px solid #333;padding:12px;page-break-inside:avoid;">
        <strong>ความเห็น / คำสั่งผู้อำนวยการโรงพยาบาลหนองจิก:</strong>
        <div style="margin-top:10px;">[ &nbsp; ] ทราบ &nbsp;&nbsp;&nbsp; [ &nbsp; ] อนุมัติให้ดำเนินการแต่งตั้งคณะกรรมการสอบหาข้อเท็จจริง / จำหน่ายพัสดุตามระเบียบฯ</div>
        <div style="text-align:right;margin-top:28px;">
          ลงชื่อ .......................................................<br/>
          (.......................................................)<br/>
          ผู้อำนวยการโรงพยาบาลหนองจิก
        </div>
      </div>
    `;
    return wrapA4Document(`บันทึกข้อความ_รายงานผลตรวจพัสดุ_${fy}`, body);
  },

  /**
   * 4. แบบขออนุมัติจำหน่ายพัสดุ (ระเบียบฯ ข้อ 215-218)
   */
  renderDisposalRequestForm(disposal = {}) {
    const methodLabel = DISPOSAL_METHODS[disposal.method]?.label || disposal.method || '-';
    const items = Array.isArray(disposal.items) ? disposal.items : [];
    const totalPurchase = items.reduce((s, i) => s + (Number(i.price) || 0), 0);
    const totalNbv = items.reduce((s, i) => s + (Number(i.nbv) || 0), 0);

    const rows = items.map((item, idx) => `
      <tr>
        <td class="center">${idx + 1}</td>
        <td class="center">${esc(item.code)}</td>
        <td>${esc(item.name)}</td>
        <td>${esc(item.dept || '-')}</td>
        <td class="num">${fmtMoney(item.price)}</td>
        <td class="num">${fmtMoney(item.nbv)}</td>
        <td>${esc(item.condition || '-')}</td>
      </tr>`).join('');

    const body = `
      <div class="header-center">
        <div class="org-title">บัญชีรายการขออนุมัติจำหน่ายพัสดุ (ตามระเบียบฯ ข้อ 215–218)</div>
        <div class="doc-subtitle">โรงพยาบาลหนองจิก สำนักงานสาธารณสุขจังหวัดปัตตานี | เลขที่เอกสาร: ${esc(disposal.disposalNo || '-')}</div>
      </div>

      <table class="meta-grid">
        <tr>
          <td style="width:55%"><strong>ปีงบประมาณ:</strong> พ.ศ. ${esc(disposal.fiscalYear || '-')}</td>
          <td><strong>วิธีจำหน่ายที่เสนอ:</strong> ${esc(methodLabel)}</td>
        </tr>
        <tr>
          <td><strong>คำสั่งแต่งตั้งกรรมการฯ:</strong> ${esc(disposal.committeeOrderNo || '-')}</td>
          <td><strong>วันที่จัดทำ:</strong> ${fmtThaiDate(disposal.createdAt)}</td>
        </tr>
        <tr>
          <td colspan="2"><strong>เหตุผลความจำเป็นในการจำหน่าย:</strong> ${esc(disposal.reason || 'ชำรุดเสื่อมสภาพจากการใช้งาน ไม่คุ้มค่าซ่อม')}</td>
        </tr>
      </table>

      <table class="data-table">
        <thead>
          <tr>
            <th style="width:45px">ลำดับ</th>
            <th style="width:140px">รหัสครุภัณฑ์</th>
            <th>รายการครุภัณฑ์</th>
            <th style="width:110px">แผนก</th>
            <th style="width:100px">ราคาทุน (บาท)</th>
            <th style="width:95px">มูลค่าสุทธิ NBV</th>
            <th style="width:120px">สภาพ/หมายเหตุ</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr style="font-weight:700;background:#f8fafc;">
            <td colspan="4" class="center">รวมทั้งสิ้น ${items.length} รายการ</td>
            <td class="num">${fmtMoney(totalPurchase)}</td>
            <td class="num">${fmtMoney(totalNbv)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>

      <div class="sig-grid">
        <div class="sig-box">
          <div class="sig-line">ลงชื่อ ....................................................... ผู้เสนอขอจำหน่าย</div>
          <div>(${esc(disposal.createdBy || '.......................................................')})</div>
          <div>เจ้าหน้าที่พัสดุ</div>
        </div>
        <div class="sig-box">
          <div class="sig-line">ลงชื่อ ....................................................... ผู้อนุมัติจำหน่าย</div>
          <div>(${esc(disposal.approvedBy || '.......................................................')})</div>
          <div>ผู้อำนวยการโรงพยาบาลหนองจิก</div>
        </div>
      </div>
    `;
    return wrapA4Document(`แบบขออนุมัติจำหน่ายพัสดุ_${disposal.disposalNo || ''}`, body);
  }
};
