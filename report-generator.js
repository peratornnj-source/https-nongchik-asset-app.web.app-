// report-generator.js - Statutory Annual Audit Report Generator & Exporter
// Compliant with Thai MoF Procurement Regulation B.E. 2560 (Clause 213)
// Compatible with Node.js and Browser environments

import { AuditEngine } from './audit-engine.js';
import { FirebaseBridge } from './firebase-bridge.js';

const sanitize = (code) => {
  if (typeof FirebaseBridge !== 'undefined' && FirebaseBridge.sanitizeCode) {
    return FirebaseBridge.sanitizeCode(code);
  }
  return (code || '').trim().replace(/\//g, '_');
};

const CONDITION_LABELS = {
  normal: 'ใช้งานได้ตามปกติ',
  damaged_repairable: 'ชำรุดซ่อมแซมได้ (เสนอส่งซ่อม)',
  deteriorated_unusable: 'ชำรุด/เสื่อมสภาพไม่คุ้มค่าซ่อม (เสนอขอจำหน่าย)',
  lost: 'สูญไป/หาไม่พบ (เสนอดำเนินการสืบหา/จำหน่าย)'
};

export const ReportGenerator = {
  /**
   * Prepares statutory report data matching Regulation Clause 213.
   */
  buildStatutoryReportData(round, activeAssets, options = {}) {
    const summary = AuditEngine.computeSummary(round, activeAssets);
    const active = AuditEngine.filterActiveAssets(activeAssets);
    const assetsMap = new Map();
    active.forEach(a => assetsMap.set(sanitize(a.code), a));

    const items = round?.items || {};
    const defectiveItems = [];
    let counter = 1;

    Object.entries(items).forEach(([key, rec]) => {
      if (rec.condition && rec.condition !== 'normal') {
        const asset = assetsMap.get(key) || {};
        defectiveItems.push({
          no: counter++,
          code: rec.code || asset.code || key,
          name: asset.name || 'ไม่ระบุชื่อ',
          dept: asset.dept || 'ไม่ระบุแผนก',
          price: Number(asset.price) || 0,
          date: asset.date || '-',
          condition: rec.condition,
          conditionLabel: CONDITION_LABELS[rec.condition] || rec.condition,
          notes: rec.notes || '-',
          auditorName: rec.auditorName || '',
          auditedAt: rec.auditedAt || ''
        });
      }
    });

    return {
      hospitalName: options.hospitalName || 'โรงพยาบาลหนองจิก',
      province: options.province || 'จังหวัดปัตตานี',
      fiscalYear: String(round?.fiscalYear || new Date().getFullYear() + 543),
      orderNo: round?.orderNo || 'คำสั่งโรงพยาบาลหนองจิก',
      orderDate: round?.orderDate || '-',
      committee: Array.isArray(round?.committee) ? round.committee : [],
      summary,
      defectiveItems,
      generatedAt: new Date().toISOString()
    };
  },

  /**
   * Generates official A4 print-ready HTML conforming to Thai government document styling.
   */
  renderPrintableHTML(reportData) {
    const s = reportData.summary || {};
    const comm = reportData.committee || [];
    const defectives = reportData.defectiveItems || [];

    const formatCurrency = (val) => Number(val || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formatNumber = (val) => Number(val || 0).toLocaleString('th-TH');

    const totalCount = s.totalCount || 1;
    const calcPct = (cnt) => ((Number(cnt || 0) / totalCount) * 100).toFixed(1);

    const defectiveRows = defectives.length > 0 
      ? defectives.map(item => `
          <tr>
            <td style="text-align: center; padding: 6px; border: 1px solid #475569;">${item.no}</td>
            <td style="padding: 6px; border: 1px solid #475569; font-family: monospace;">${item.code}</td>
            <td style="padding: 6px; border: 1px solid #475569;">${item.name}</td>
            <td style="padding: 6px; border: 1px solid #475569;">${item.dept}</td>
            <td style="text-align: right; padding: 6px; border: 1px solid #475569;">${formatCurrency(item.price)}</td>
            <td style="padding: 6px; border: 1px solid #475569;">${item.conditionLabel}</td>
            <td style="padding: 6px; border: 1px solid #475569;">${item.notes}</td>
          </tr>
        `).join('')
      : `<tr><td colspan="7" style="text-align: center; padding: 12px; border: 1px solid #475569; color: #64748b;">- ไม่พบครุภัณฑ์ชำรุด เสื่อมสภาพ หรือสูญไป -</td></tr>`;

    const committeeSignatures = comm.map(c => `
      <div style="flex: 1; min-width: 200px; text-align: center; margin: 15px 0; page-break-inside: avoid;">
        <div style="margin-bottom: 45px;">ลงชื่อ...................................................</div>
        <div style="font-weight: bold;">(${c.name || '...................................................'})</div>
        <div style="font-size: 13px; color: #334155;">${c.position || 'ตำแหน่ง'}</div>
        <div style="font-size: 13px; font-weight: bold; color: #0f766e; margin-top: 4px;">${c.role || 'กรรมการ'}</div>
      </div>
    `).join('');

    return `
      <div class="gov-report-container" style="font-family: 'Sarabun', sans-serif; color: #0f172a; line-height: 1.6; max-width: 210mm; margin: 0 auto; background: #ffffff; padding: 20mm 15mm;">
        <style>
          @page { size: A4; margin: 15mm; }
          @media print {
            body { background: transparent !important; }
            .gov-report-container { padding: 0 !important; width: 100% !important; max-width: none !important; }
            .no-print { display: none !important; }
            tr, .avoid-break { page-break-inside: avoid !important; }
          }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
          th { background-color: #f1f5f9; padding: 8px 6px; border: 1px solid #475569; font-weight: 600; text-align: center; }
        </style>

        <!-- Official Header -->
        <div style="text-align: center; margin-bottom: 25px;">
          <h2 style="font-size: 20px; font-weight: bold; margin: 0 0 5px 0;">รายงานผลการตรวจสอบพัสดุประจำปีงบประมาณ พ.ศ. ${reportData.fiscalYear}</h2>
          <h3 style="font-size: 16px; font-weight: 600; margin: 0 0 5px 0;">${reportData.hospitalName} ${reportData.province}</h3>
          <p style="font-size: 13px; color: #475569; margin: 0;">
            ตามระเบียบกระทรวงการคลังว่าด้วยการจัดซื้อจัดจ้างและการบริหารพัสดุภาครัฐ พ.ศ. 2560 ข้อ 213<br>
            อ้างอิงคำสั่ง: ${reportData.orderNo} ลงวันที่ ${reportData.orderDate}
          </p>
        </div>

        <!-- Section 1: Summary Statement -->
        <div style="margin-bottom: 20px; font-size: 14px; text-align: justify; text-indent: 2.5em;">
          คณะกรรมการตรวจสอบพัสดุประจำปี ได้ร่วมกันดำเนินการตรวจสอบการรับ-จ่ายพัสดุและตรวจนับพัสดุคงเหลือที่มีตัวอยู่จริง 
          ณ วันที่สิ้นปีงบประมาณของ ${reportData.hospitalName} มีรายการครุภัณฑ์ทั้งหมดจำนวน 
          <strong>${formatNumber(s.totalCount)}</strong> รายการ รวมมูลค่าจัดซื้อทั้งสิ้น 
          <strong>${formatCurrency(s.totalValue)}</strong> บาท โดยผลการตรวจนับปรากฏรายละเอียดดังนี้
        </div>

        <!-- Section 2: Summary Table -->
        <div class="avoid-break" style="margin-bottom: 25px;">
          <h4 style="font-size: 14px; font-weight: bold; margin: 0 0 5px 0;">1. สรุปภาพรวมสถานะพัสดุ-ครุภัณฑ์</h4>
          <table>
            <thead>
              <tr>
                <th style="width: 50px;">ลำดับ</th>
                <th>สภาพของพัสดุ/ครุภัณฑ์</th>
                <th style="width: 100px;">จำนวน (รายการ)</th>
                <th style="width: 80px;">ร้อยละ</th>
                <th style="width: 130px;">มูลค่ารวม (บาท)</th>
                <th style="width: 150px;">ข้อเสนอแนะคณะกรรมการ</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="text-align: center; padding: 6px; border: 1px solid #475569;">1</td>
                <td style="padding: 6px; border: 1px solid #475569;">ครบถ้วน ใช้งานได้ตามปกติ</td>
                <td style="text-align: right; padding: 6px; border: 1px solid #475569;">${formatNumber(s.normalCount)}</td>
                <td style="text-align: right; padding: 6px; border: 1px solid #475569;">${calcPct(s.normalCount)}%</td>
                <td style="text-align: right; padding: 6px; border: 1px solid #475569;">${formatCurrency(s.normalValue)}</td>
                <td style="padding: 6px; border: 1px solid #475569;">ใช้งานตามปกติต่อไป</td>
              </tr>
              <tr>
                <td style="text-align: center; padding: 6px; border: 1px solid #475569;">2</td>
                <td style="padding: 6px; border: 1px solid #475569;">ชำรุด สามารถซ่อมแซมได้</td>
                <td style="text-align: right; padding: 6px; border: 1px solid #475569;">${formatNumber(s.damagedRepairableCount)}</td>
                <td style="text-align: right; padding: 6px; border: 1px solid #475569;">${calcPct(s.damagedRepairableCount)}%</td>
                <td style="text-align: right; padding: 6px; border: 1px solid #475569;">${formatCurrency(s.damagedRepairableValue)}</td>
                <td style="padding: 6px; border: 1px solid #475569;">จัดสรรงบประมาณส่งซ่อม</td>
              </tr>
              <tr>
                <td style="text-align: center; padding: 6px; border: 1px solid #475569;">3</td>
                <td style="padding: 6px; border: 1px solid #475569;">ชำรุด/เสื่อมสภาพไม่คุ้มค่าซ่อม</td>
                <td style="text-align: right; padding: 6px; border: 1px solid #475569;">${formatNumber(s.deterioratedUnusableCount)}</td>
                <td style="text-align: right; padding: 6px; border: 1px solid #475569;">${calcPct(s.deterioratedUnusableCount)}%</td>
                <td style="text-align: right; padding: 6px; border: 1px solid #475569;">${formatCurrency(s.deterioratedUnusableValue)}</td>
                <td style="padding: 6px; border: 1px solid #475569;">เสนอขออนุมัติจำหน่ายออกจากบัญชี</td>
              </tr>
              <tr>
                <td style="text-align: center; padding: 6px; border: 1px solid #475569;">4</td>
                <td style="padding: 6px; border: 1px solid #475569;">สูญไป/หาตัวไม่พบ</td>
                <td style="text-align: right; padding: 6px; border: 1px solid #475569;">${formatNumber(s.lostCount)}</td>
                <td style="text-align: right; padding: 6px; border: 1px solid #475569;">${calcPct(s.lostCount)}%</td>
                <td style="text-align: right; padding: 6px; border: 1px solid #475569;">${formatCurrency(s.lostValue)}</td>
                <td style="padding: 6px; border: 1px solid #475569;">เสนอดำเนินการทางละเมิด/จำหน่าย</td>
              </tr>
              <tr style="font-weight: bold; background-color: #f8fafc;">
                <td colspan="2" style="text-align: center; padding: 8px; border: 1px solid #475569;">รวมที่ตรวจนับแล้วทั้งสิ้น</td>
                <td style="text-align: right; padding: 8px; border: 1px solid #475569;">${formatNumber(s.scannedCount)}</td>
                <td style="text-align: right; padding: 8px; border: 1px solid #475569;">${calcPct(s.scannedCount)}%</td>
                <td style="text-align: right; padding: 8px; border: 1px solid #475569;">${formatCurrency(s.scannedTotalValue || s.totalValue)}</td>
                <td style="text-align: center; padding: 8px; border: 1px solid #475569;">(มูลค่าพัสดุตามบัญชีทั้งสิ้น: ${formatCurrency(s.totalValue)} บาท)</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Section 3: Defective Items Breakdown Table -->
        <div style="margin-top: 25px; margin-bottom: 25px;">
          <h4 style="font-size: 14px; font-weight: bold; margin: 0 0 5px 0;">2. บัญชีรายละเอียดครุภัณฑ์ที่ชำรุด เสื่อมสภาพ หรือสูญไป (แนบท้าย)</h4>
          <table>
            <thead>
              <tr style="break-inside: avoid; page-break-inside: avoid;">
                <th style="width: 40px;">ลำดับ</th>
                <th style="width: 120px;">เลขครุภัณฑ์</th>
                <th>รายการครุภัณฑ์</th>
                <th style="width: 130px;">หน่วยงานที่ครอบครอง</th>
                <th style="width: 90px;">ราคาจัดซื้อ (บาท)</th>
                <th style="width: 140px;">สภาพความชำรุด</th>
                <th style="width: 130px;">ข้อเสนอแนะ/หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>
              ${defectiveRows}
            </tbody>
          </table>
        </div>

        <!-- Section 4: Signatures -->
        <div class="avoid-break" style="margin-top: 35px; border-top: 1px dashed #cbd5e1; padding-top: 25px;">
          <p style="text-align: center; font-size: 14px; font-weight: bold; margin-bottom: 15px;">คณะกรรมการตรวจสอบพัสดุประจำปี ได้ตรวจสอบความถูกต้องและขอรับรองรายงานฉบับนี้</p>
          <div style="display: flex; flex-wrap: wrap; justify-content: space-around; gap: 20px;">
            ${committeeSignatures}
          </div>
        </div>
      </div>
    `;
  },

  /**
   * Generates SheetJS workbook data structure for Excel export.
   */
  generateExcelWorkbook(reportData) {
    const s = reportData.summary || {};
    const defectives = reportData.defectiveItems || [];

    // Sheet 1: สรุปผล
    const summarySheetData = [
      [`รายงานผลการตรวจสอบพัสดุประจำปีงบประมาณ พ.ศ. ${reportData.fiscalYear}`],
      [`${reportData.hospitalName || 'โรงพยาบาลหนองจิก'}`],
      [`อ้างอิงคำสั่ง: ${reportData.orderNo || '-'} ลงวันที่ ${reportData.orderDate || '-'}`],
      [],
      ['ลำดับ', 'สภาพของพัสดุ/ครุภัณฑ์', 'จำนวน (รายการ)', 'ร้อยละ', 'มูลค่ารวม (บาท)', 'ข้อเสนอแนะคณะกรรมการ'],
      [1, 'ครบถ้วน ใช้งานได้ตามปกติ', s.normalCount || 0, `${((s.normalCount || 0) / (s.totalCount || 1) * 100).toFixed(1)}%`, s.normalValue || 0, 'ใช้งานตามปกติต่อไป'],
      [2, 'ชำรุด สามารถซ่อมแซมได้', s.damagedRepairableCount || 0, `${((s.damagedRepairableCount || 0) / (s.totalCount || 1) * 100).toFixed(1)}%`, s.damagedRepairableValue || 0, 'จัดสรรงบประมาณส่งซ่อม'],
      [3, 'ชำรุด/เสื่อมสภาพไม่คุ้มค่าซ่อม', s.deterioratedUnusableCount || 0, `${((s.deterioratedUnusableCount || 0) / (s.totalCount || 1) * 100).toFixed(1)}%`, s.deterioratedUnusableValue || 0, 'เสนอขออนุมัติจำหน่ายออกจากบัญชี'],
      [4, 'สูญไป/หาตัวไม่พบ', s.lostCount || 0, `${((s.lostCount || 0) / (s.totalCount || 1) * 100).toFixed(1)}%`, s.lostValue || 0, 'เสนอดำเนินการทางละเมิด/จำหน่าย'],
      ['รวมที่ตรวจนับแล้ว', '', s.scannedCount || 0, `${((s.scannedCount || 0) / (s.totalCount || 1) * 100).toFixed(1)}%`, s.scannedTotalValue || s.totalValue || 0, ''],
      ['คงเหลือยังไม่ตรวจนับ', '', s.pendingCount || 0, `${((s.pendingCount || 0) / (s.totalCount || 1) * 100).toFixed(1)}%`, '-', '']
    ];

    // Sheet 2: รายการชำรุด/สูญไป
    const defectiveSheetData = [
      ['ลำดับ', 'เลขครุภัณฑ์', 'ชื่อรายการครุภัณฑ์', 'หน่วยงานที่ครอบครอง', 'ราคาจัดซื้อ (บาท)', 'สภาพความชำรุด', 'ข้อเสนอแนะ/หมายเหตุ']
    ];

    defectives.forEach(item => {
      defectiveSheetData.push([
        item.no,
        item.code,
        item.name,
        item.dept,
        item.price,
        item.conditionLabel,
        item.notes
      ]);
    });

    return {
      sheets: [
        { name: 'สรุปผลการตรวจสอบ', data: summarySheetData },
        { name: 'บัญชีครุภัณฑ์ชำรุด-สูญไป', data: defectiveSheetData }
      ]
    };
  },

  /**
   * Browser-specific export helper using SheetJS CDN.
   */
  exportToExcelFile(reportData, filename) {
    if (typeof window === 'undefined' || !window.XLSX) {
      alert('ไม่พบไลบรารี SheetJS (XLSX) สำหรับสร้างไฟล์ Excel');
      return;
    }

    const wbPayload = this.generateExcelWorkbook(reportData);
    const wb = window.XLSX.utils.book_new();

    wbPayload.sheets.forEach(sheetInfo => {
      const ws = window.XLSX.utils.aoa_to_sheet(sheetInfo.data);
      window.XLSX.utils.book_append_sheet(wb, ws, sheetInfo.name);
    });

    const outName = filename || `รายงานผลการตรวจสอบพัสดุ_ปี_${reportData.fiscalYear}_รพ_หนองจิก.xlsx`;
    window.XLSX.writeFile(wb, outName);
  }
};

// Expose globally for browser
if (typeof window !== 'undefined') {
  window.ReportGenerator = ReportGenerator;
}
