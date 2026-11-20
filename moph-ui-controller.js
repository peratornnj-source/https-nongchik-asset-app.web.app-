// moph-ui-controller.js - Phase 1-3 UI Controller for MOPH Government Asset Management System
// Connects DepreciationEngine, AuthRBAC, AuditLogger, DisposalEngine, GovForms, MaintenanceEngine, StorageService & FirebaseBridge.

import { FirebaseBridge } from './firebase-bridge.js';
import { DepreciationEngine, FUND_SOURCES } from './depreciation-engine.js';
import { ROLES, AuthRBAC, AuditLogger } from './auth-rbac.js';
import { DISPOSAL_METHODS, DISPOSAL_STATUS_LABELS, DisposalEngine } from './disposal-engine.js';
import { GovForms } from './gov-forms.js';
import { MaintenanceEngine } from './maintenance-engine.js';
import { StorageService } from './storage-service.js';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getAppState() {
  return {
    assets: window.assetsData || [],
    transfers: window.assetTransfers || [],
    tickets: window.repairTickets || [],
    auditRound: window.currentAuditRound || null,
    user: window.currentUser || null
  };
}

let disposalsData = JSON.parse(localStorage.getItem('nongchik_disposals') || '[]');
let pmSchedulesData = JSON.parse(localStorage.getItem('nongchik_pm_schedules') || '[]');
let auditLogsData = JSON.parse(localStorage.getItem('nongchik_audit_logs') || '[]');
let registeredUsersData = JSON.parse(localStorage.getItem('nongchik_users') || '[]');
let editingAssetCode = null;
let editingTicketId = null;
let completingPmId = null;

function persistLocal(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

function toast(msg, type = 'info') {
  if (typeof window.showNotificationToast === 'function') {
    window.showNotificationToast(msg, type);
  } else {
    alert(msg);
  }
}

function openPrintWindow(html) {
  const win = window.open('', '_blank', 'width=900,height=780');
  if (!win) {
    toast('กรุณาอนุญาต Pop-up เพื่อพิมพ์เอกสารราชการ', 'warning');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

export const MophUI = {
  /**
   * Initializes listeners, normalizes legacy assets, and binds Firebase Auth state.
   */
  init() {
    // Normalize existing 845 assets with ผท. defaults (non-destructive)
    if (Array.isArray(window.assetsData)) {
      window.assetsData = window.assetsData.map(a => DepreciationEngine.normalizeAssetRecord(a));
    }

    // Ensure currentUser has a valid role
    if (window.currentUser && !window.currentUser.role) {
      window.currentUser.role = 'admin';
      persistLocal('nongchik_user', window.currentUser);
    }

    this.initCloudListeners();
    this.initAuthListener();
    this.applyRoleGuards();
    this.renderExecutiveSummary();
  },

  initCloudListeners() {
    if (!FirebaseBridge.isCloudActive()) return;
    FirebaseBridge.listenDisposals(items => {
      if (items.length > 0) {
        disposalsData = items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        persistLocal('nongchik_disposals', disposalsData);
        this.renderDisposals();
      }
    });
    FirebaseBridge.listenPmSchedules(items => {
      if (items.length > 0) {
        pmSchedulesData = items;
        persistLocal('nongchik_pm_schedules', pmSchedulesData);
        this.renderPmView();
      }
    });
    FirebaseBridge.listenAuditLogs(items => {
      if (items.length > 0) {
        auditLogsData = items;
        persistLocal('nongchik_audit_logs', auditLogsData);
        this.renderAuditLogTable();
      }
    });
  },

  initAuthListener() {
    AuthRBAC.initFirebaseAuth(async fbUser => {
      if (!fbUser) return;
      let profile = await FirebaseBridge.getUserProfile(fbUser.uid);
      if (!profile) {
        const allUsers = await FirebaseBridge.listUserProfiles();
        const role = AuthRBAC.resolveBootstrapRole(allUsers.length);
        profile = {
          uid: fbUser.uid,
          email: fbUser.email || '',
          name: fbUser.displayName || fbUser.email || 'ผู้ใช้งาน',
          fullName: fbUser.displayName || fbUser.email || 'ผู้ใช้งาน',
          dept: 'พัสดุ-งานพัสดุ',
          role,
          active: true,
          authMode: 'firebase'
        };
        await FirebaseBridge.saveUserProfile(fbUser.uid, profile);
      }
      window.currentUser = { ...profile, name: profile.fullName || profile.name || profile.email };
      persistLocal('nongchik_user', window.currentUser);
      if (typeof window.updateUserUI === 'function') window.updateUserUI();
      this.applyRoleGuards();
    });
  },

  getCurrentRole() {
    return window.currentUser?.role || 'dept_user';
  },

  requirePermission(permission, actionName = 'ดำเนินการนี้') {
    const role = this.getCurrentRole();
    if (!window.currentUser) {
      toast(`กรุณาเข้าสู่ระบบก่อน${actionName}`, 'warning');
      if (typeof window.openAuthModal === 'function') window.openAuthModal();
      return false;
    }
    if (!AuthRBAC.can(role, permission)) {
      const meta = AuthRBAC.getRoleMeta(role);
      toast(`สิทธิ์ของคุณ (${meta.shortLabel}) ไม่สามารถ${actionName}ได้`, 'error');
      return false;
    }
    return true;
  },

  logAction(action, targetType, targetId, summary, changes = null) {
    const actor = window.currentUser || { uid: 'local', fullName: 'ผู้ใช้ Local', role: 'admin' };
    const entry = AuditLogger.createEntry({ actor, action, targetType, targetId, summary, changes });
    auditLogsData.unshift(entry);
    if (auditLogsData.length > 500) auditLogsData = auditLogsData.slice(0, 500);
    persistLocal('nongchik_audit_logs', auditLogsData);
    FirebaseBridge.appendAuditLog(entry);
    return entry;
  },

  applyRoleGuards() {
    const user = window.currentUser;
    const role = user?.role || null;
    const badgeEl = document.getElementById('userRoleBadge');
    if (badgeEl) {
      if (user && role) {
        const meta = AuthRBAC.getRoleMeta(role);
        badgeEl.innerText = meta.shortLabel;
        badgeEl.className = `text-[10px] px-2 py-0.5 rounded-full font-bold border ${meta.badgeClass}`;
        badgeEl.classList.remove('hidden');
      } else {
        badgeEl.classList.add('hidden');
      }
    }

    const addBtn = document.getElementById('btnAddAsset');
    if (addBtn) {
      addBtn.classList.toggle('hidden', Boolean(user && !AuthRBAC.can(role, 'asset:write')));
    }
    const adminTabBtn = document.getElementById('tabBtn-admin');
    if (adminTabBtn) {
      const canSeeAdmin = !user || AuthRBAC.can(role, 'user:manage') || AuthRBAC.can(role, 'auditlog:view');
      adminTabBtn.classList.toggle('hidden', !canSeeAdmin);
    }
  },

  // ================= AUTH & RBAC HANDLERS =================
  switchAuthMode(mode) {
    const fbPane = document.getElementById('authPaneFirebase');
    const localPane = document.getElementById('authPaneLocal');
    const fbBtn = document.getElementById('authTabFirebase');
    const localBtn = document.getElementById('authTabLocal');
    if (!fbPane || !localPane) return;

    const isFb = mode === 'firebase';
    fbPane.classList.toggle('hidden', !isFb);
    localPane.classList.toggle('hidden', isFb);
    fbBtn.className = isFb
      ? 'flex-1 py-2 text-xs font-bold rounded-lg bg-teal-700 text-white'
      : 'flex-1 py-2 text-xs font-semibold rounded-lg bg-slate-100 text-slate-600';
    localBtn.className = !isFb
      ? 'flex-1 py-2 text-xs font-bold rounded-lg bg-teal-700 text-white'
      : 'flex-1 py-2 text-xs font-semibold rounded-lg bg-slate-100 text-slate-600';
  },

  async handleFirebaseSignIn() {
    const email = document.getElementById('fbAuthEmail')?.value.trim();
    const pass = document.getElementById('fbAuthPassword')?.value;
    if (!email || !pass) return toast('กรุณากรอกอีเมลและรหัสผ่าน', 'warning');

    try {
      const fbUser = await AuthRBAC.signInWithEmail(email, pass);
      let profile = await FirebaseBridge.getUserProfile(fbUser.uid);
      if (!profile) {
        const users = await FirebaseBridge.listUserProfiles();
        profile = {
          uid: fbUser.uid,
          email: fbUser.email,
          name: fbUser.displayName || email,
          fullName: fbUser.displayName || email,
          dept: 'พัสดุ-งานพัสดุ',
          role: AuthRBAC.resolveBootstrapRole(users.length),
          active: true,
          authMode: 'firebase'
        };
        await FirebaseBridge.saveUserProfile(fbUser.uid, profile);
      }
      window.currentUser = { ...profile, name: profile.fullName || profile.name };
      persistLocal('nongchik_user', window.currentUser);
      this.logAction('USER_LOGIN', 'user', fbUser.uid, `เข้าสู่ระบบผ่าน Firebase Auth (${profile.role})`);
      if (typeof window.updateUserUI === 'function') window.updateUserUI();
      this.applyRoleGuards();
      window.closeModal('authModal');
      toast(`เข้าสู่ระบบสำเร็จ (${AuthRBAC.getRoleMeta(profile.role).label})`, 'success');
    } catch (err) {
      toast(`เข้าสู่ระบบไม่สำเร็จ: ${err.message || err}`, 'error');
    }
  },

  async handleFirebaseRegister() {
    const email = document.getElementById('fbAuthEmail')?.value.trim();
    const pass = document.getElementById('fbAuthPassword')?.value;
    const name = document.getElementById('fbAuthName')?.value.trim();
    const dept = document.getElementById('fbAuthDept')?.value || 'พัสดุ-งานพัสดุ';
    const consent = document.getElementById('fbPdpaConsent')?.checked;

    if (!email || !pass || pass.length < 6) return toast('กรุณากรอกอีเมลและรหัสผ่านอย่างน้อย 6 ตัวอักษร', 'warning');
    if (!name) return toast('กรุณาระบุชื่อ-นามสกุล', 'warning');
    if (!consent) return toast('กรุณายอมรับเงื่อนไข PDPA ก่อนสมัครใช้งาน', 'warning');

    try {
      const fbUser = await AuthRBAC.registerWithEmail(email, pass, name);
      const users = await FirebaseBridge.listUserProfiles();
      const role = AuthRBAC.resolveBootstrapRole(users.length);
      const profile = {
        uid: fbUser.uid,
        email,
        name,
        fullName: name,
        dept,
        role,
        active: true,
        pdpaConsentAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        authMode: 'firebase'
      };
      await FirebaseBridge.saveUserProfile(fbUser.uid, profile);
      window.currentUser = profile;
      persistLocal('nongchik_user', window.currentUser);
      this.logAction('USER_REGISTER', 'user', fbUser.uid, `ลงทะเบียนบุคลากรใหม่ (${role})`);
      if (typeof window.updateUserUI === 'function') window.updateUserUI();
      this.applyRoleGuards();
      window.closeModal('authModal');
      toast(
        role === 'admin'
          ? 'สมัครใช้งานสำเร็จ! คุณเป็นผู้ใช้งานคนแรกและได้รับสิทธิ์ "เจ้าหน้าที่พัสดุ (Admin)" อัตโนมัติ'
          : `สมัครใช้งานสำเร็จ (${AuthRBAC.getRoleMeta(role).label})`,
        'success'
      );
    } catch (err) {
      toast(`สมัครสมาชิกไม่สำเร็จ: ${err.message || err} (ตรวจสอบว่าเปิด Email/Password ใน Firebase Console แล้ว)`, 'error');
    }
  },

  handleLocalRoleLogin() {
    const name = document.getElementById('authName')?.value.trim();
    const dept = document.getElementById('authDept')?.value;
    const role = document.getElementById('authRoleSelect')?.value || 'admin';
    const consent = document.getElementById('pdpaConsent')?.checked;
    if (!name || !dept) return toast('กรุณาระบุชื่อและแผนก', 'warning');
    if (!consent) return toast('กรุณายอมรับข้อตกลง PDPA', 'warning');

    const uid = `local-${Date.now()}`;
    const profile = {
      uid,
      email: `${name.replace(/\s+/g, '.').toLowerCase()}@nongchik.local`,
      name,
      fullName: name,
      dept,
      role,
      active: true,
      authMode: 'local',
      pdpaConsentAt: new Date().toISOString()
    };
    window.currentUser = profile;
    persistLocal('nongchik_user', profile);

    if (!registeredUsersData.some(u => u.name === name && u.dept === dept)) {
      registeredUsersData.push(profile);
      persistLocal('nongchik_users', registeredUsersData);
    }

    this.logAction('USER_LOGIN', 'user', uid, `เข้าใช้งานโหมด Local (${AuthRBAC.getRoleMeta(role).shortLabel})`);
    if (typeof window.updateUserUI === 'function') window.updateUserUI();
    this.applyRoleGuards();
    window.closeModal('authModal');
    toast(`ยินดีต้อนรับ ${name} (${AuthRBAC.getRoleMeta(role).shortLabel})`, 'success');
  },

  async handleLogout() {
    await AuthRBAC.signOut();
    window.currentUser = null;
    localStorage.removeItem('nongchik_user');
    const disp = document.getElementById('userNameDisplay');
    if (disp) disp.innerText = 'เข้าสู่ระบบ (Auth/PDPA)';
    this.applyRoleGuards();
    window.closeModal('authModal');
    toast('ออกจากระบบเรียบร้อยแล้ว', 'info');
  },

  // ================= ASSET REGISTER (ผท.) CRUD + DEPRECIATION + TIMELINE =================
  openAssetFormModal(code = null) {
    if (!this.requirePermission('asset:write', 'เพิ่มหรือแก้ไขทะเบียนครุภัณฑ์')) return;

    editingAssetCode = code;
    const isEdit = Boolean(code);
    const asset = isEdit
      ? DepreciationEngine.normalizeAssetRecord((window.assetsData || []).find(a => a.code === code) || {})
      : DepreciationEngine.normalizeAssetRecord({ date: new Date().toISOString().slice(0, 10), fundSource: 'เงินบำรุง' });

    document.getElementById('assetFormTitle').innerText = isEdit ? `แก้ไขทะเบียนครุภัณฑ์ (${code})` : 'ขึ้นทะเบียนครุภัณฑ์ใหม่ (แบบ ผท.)';
    const codeInput = document.getElementById('afCode');
    codeInput.value = asset.code;
    codeInput.readOnly = isEdit;
    document.getElementById('afName').value = asset.name;
    document.getElementById('afPrice').value = asset.price || '';
    document.getElementById('afDate').value = asset.date || '';
    document.getElementById('afDept').value = asset.dept || '';
    document.getElementById('afStatus').value = asset.status || 'ใช้งานปกติ';
    document.getElementById('afFundSource').value = asset.fundSource || 'เงินบำรุง';
    document.getElementById('afContractNo').value = asset.contractNo || '';
    document.getElementById('afVendor').value = asset.vendor || '';
    document.getElementById('afWarrantyExpiry').value = asset.warrantyExpiry || '';
    document.getElementById('afBrandModel').value = asset.brandModel || '';
    document.getElementById('afSerialNo').value = asset.serialNo || '';
    document.getElementById('afLocation').value = asset.location || '';
    document.getElementById('afCustodian').value = asset.custodian || '';
    document.getElementById('afUsefulLife').value = asset.usefulLifeYears || 5;
    document.getElementById('afSpec').value = asset.spec || '';
    document.getElementById('afIsMedical').checked = Boolean(asset.isMedicalDevice);
    document.getElementById('afPhotoUrl').value = asset.photoUrl || '';

    const preview = document.getElementById('afPhotoPreview');
    if (preview) {
      preview.src = asset.photoUrl || '';
      preview.classList.toggle('hidden', !asset.photoUrl);
    }

    document.getElementById('assetFormModal').classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  },

  autoGenerateAssetCode() {
    const prefix = document.getElementById('afCodePrefix')?.value || '7440-001';
    const next = DepreciationEngine.generateNextAssetCode(prefix, window.assetsData || []);
    document.getElementById('afCode').value = next;
    document.getElementById('afUsefulLife').value = DepreciationEngine.getDefaultUsefulLife(next);
    document.getElementById('afIsMedical').checked = DepreciationEngine.isMedicalCode(next);
  },

  async handleAssetPhotoSelect(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const code = document.getElementById('afCode').value.trim() || `NEW-${Date.now()}`;
    try {
      toast('กำลังบีบอัดและอัปโหลดรูปภาพ...', 'info');
      const res = await StorageService.uploadEvidence(file, 'assets', code);
      document.getElementById('afPhotoUrl').value = res.url;
      const preview = document.getElementById('afPhotoPreview');
      if (preview) {
        preview.src = res.url;
        preview.classList.remove('hidden');
      }
      toast(res.mode === 'firebase_storage' ? 'อัปโหลดรูปขึ้น Firebase Storage สำเร็จ' : 'บันทึกรูปแบบ Local สำเร็จ', 'success');
    } catch (err) {
      toast(`อัปโหลดรูปไม่สำเร็จ: ${err.message}`, 'error');
    }
  },

  async saveAssetForm() {
    if (!this.requirePermission('asset:write', 'บันทึกทะเบียนครุภัณฑ์')) return;

    const code = document.getElementById('afCode').value.trim();
    const name = document.getElementById('afName').value.trim();
    if (!code || !name) return toast('กรุณากรอกรหัสครุภัณฑ์และชื่อรายการ', 'warning');

    const record = DepreciationEngine.normalizeAssetRecord({
      code,
      name,
      price: Number(document.getElementById('afPrice').value) || 0,
      date: document.getElementById('afDate').value,
      dept: document.getElementById('afDept').value || 'ยังไม่ระบุแผนก',
      status: document.getElementById('afStatus').value || 'ใช้งานปกติ',
      fundSource: document.getElementById('afFundSource').value || 'ไม่ระบุ',
      contractNo: document.getElementById('afContractNo').value.trim(),
      vendor: document.getElementById('afVendor').value.trim(),
      warrantyExpiry: document.getElementById('afWarrantyExpiry').value,
      brandModel: document.getElementById('afBrandModel').value.trim(),
      serialNo: document.getElementById('afSerialNo').value.trim(),
      location: document.getElementById('afLocation').value.trim(),
      custodian: document.getElementById('afCustodian').value.trim(),
      usefulLifeYears: Number(document.getElementById('afUsefulLife').value) || DepreciationEngine.getDefaultUsefulLife(code),
      spec: document.getElementById('afSpec').value.trim(),
      isMedicalDevice: document.getElementById('afIsMedical').checked,
      photoUrl: document.getElementById('afPhotoUrl').value.trim()
    });

    const idx = (window.assetsData || []).findIndex(a => a.code === code);
    if (!editingAssetCode && idx !== -1) {
      return toast(`รหัสครุภัณฑ์ ${code} มีอยู่ในระบบแล้ว`, 'error');
    }

    if (idx !== -1) {
      window.assetsData[idx] = { ...window.assetsData[idx], ...record };
      this.logAction('ASSET_UPDATE', 'asset', code, `แก้ไขข้อมูลทะเบียนคุม ${name} (${code})`);
    } else {
      window.assetsData.unshift(record);
      this.logAction('ASSET_CREATE', 'asset', code, `ขึ้นทะเบียนครุภัณฑ์ใหม่ ${name} (${code}) มูลค่า ${record.price.toLocaleString()} บาท`);
    }

    persistLocal('nongchik_custom_assets', window.assetsData);
    if (FirebaseBridge.isCloudActive()) {
      await FirebaseBridge.seedInitialAssets([record]);
    }

    window.closeModal('assetFormModal');
    if (typeof window.updateStats === 'function') window.updateStats();
    if (typeof window.renderTable === 'function') window.renderTable();
    this.renderExecutiveSummary();
    toast(`บันทึกทะเบียนครุภัณฑ์ ${code} เรียบร้อยแล้ว`, 'success');
  },

  enrichAssetDetailModal(asset) {
    if (!asset) return;
    const norm = DepreciationEngine.normalizeAssetRecord(asset);
    const dep = DepreciationEngine.calculateDepreciation(norm);
    const { transfers, tickets, auditRound } = getAppState();
    const econ = MaintenanceEngine.evaluateRepairEconomics(norm, tickets);
    const timeline = DepreciationEngine.buildAssetTimeline(norm, transfers, tickets, auditRound ? [auditRound] : [], disposalsData);

    const extraBox = document.getElementById('modalAssetGovExtra');
    if (!extraBox) return;

    extraBox.innerHTML = `
      ${norm.photoUrl ? `<div class="mb-2"><img src="${esc(norm.photoUrl)}" alt="asset" class="w-full h-36 object-cover rounded-xl border border-slate-200"/></div>` : ''}
      <div class="grid grid-cols-2 gap-2 text-xs bg-teal-50/70 p-3 rounded-xl border border-teal-200">
        <div><span class="text-slate-500">แหล่งเงิน:</span> <strong class="text-teal-900">${esc(norm.fundSource)}</strong></div>
        <div><span class="text-slate-500">S/N:</span> <strong>${esc(norm.serialNo || '-')}</strong></div>
        <div><span class="text-slate-500">สถานที่ตั้ง:</span> <strong>${esc(norm.location || '-')}</strong></div>
        <div><span class="text-slate-500">ผู้รับผิดชอบ:</span> <strong>${esc(norm.custodian || '-')}</strong></div>
        <div><span class="text-slate-500">ค่าเสื่อมสะสม:</span> <strong class="text-slate-700">${dep.accumulatedDepreciation.toLocaleString()} ฿</strong></div>
        <div><span class="text-slate-500">มูลค่าสุทธิ (NBV):</span> <strong class="text-teal-700">${dep.netBookValue.toLocaleString()} ฿</strong></div>
      </div>

      ${econ.repairCount > 0 ? `
      <div class="text-xs p-2.5 rounded-xl border ${econ.isUneconomical ? 'bg-rose-50 border-rose-300 text-rose-800' : 'bg-amber-50 border-amber-200 text-amber-800'}">
        <strong>ประวัติซ่อม:</strong> ${econ.repairCount} ครั้ง | ค่าซ่อมสะสม <strong>${econ.totalRepairCost.toLocaleString()} ฿</strong> (${econ.costRatioPercent}% ของราคาทุน)
        ${econ.isUneconomical ? `<div class="font-bold mt-0.5">⚠️ แจ้งเตือนไม่คุ้มซ่อม: ${esc(econ.reasons.join(', '))}</div>` : ''}
      </div>` : ''}

      <div class="border border-slate-200 rounded-xl p-2.5 bg-white">
        <p class="text-xs font-bold text-slate-700 mb-1.5">ประวัติการเคลื่อนไหว (Asset Timeline: ${timeline.length} รายการ)</p>
        <div class="max-h-28 overflow-y-auto space-y-1.5 text-[11px]">
          ${timeline.length === 0 ? '<p class="text-slate-400">ยังไม่มีประวัติ</p>' : timeline.map(ev => `
            <div class="border-l-2 border-teal-500 pl-2">
              <div class="font-semibold text-slate-800">${esc(ev.title)} <span class="text-slate-400 font-normal">(${esc(String(ev.date || '').slice(0, 10))})</span></div>
              <div class="text-slate-500">${esc(ev.detail)}</div>
            </div>`).join('')}
        </div>
      </div>
    `;
  },

  printSelectedAssetRegisterCard() {
    const asset = window.selectedAsset;
    if (!asset) return;
    const norm = DepreciationEngine.normalizeAssetRecord(asset);
    const dep = DepreciationEngine.calculateDepreciation(norm);
    const { transfers, tickets, auditRound } = getAppState();
    const timeline = DepreciationEngine.buildAssetTimeline(norm, transfers, tickets, auditRound ? [auditRound] : [], disposalsData);
    openPrintWindow(GovForms.renderAssetRegisterCard(norm, dep, timeline));
  },

  printTransferFormById(transferId) {
    const tr = (window.assetTransfers || []).find(t => t.id === transferId);
    if (!tr) return;
    const asset = (window.assetsData || []).find(a => a.code === tr.assetCode) || {};
    const normalizedTr = {
      ...tr,
      transferType: tr.transferType || (String(tr.type || '').includes('ยืม') ? 'borrow' : 'transfer')
    };
    openPrintWindow(GovForms.renderTransferOrBorrowForm(normalizedTr, asset));
  },

  printAnnualAuditMemo() {
    const round = window.currentAuditRound;
    if (!round) return toast('กรุณาเปิดรอบตรวจนับประจำปีก่อนพิมพ์บันทึกข้อความ', 'warning');
    const summary = window.AuditEngine
      ? window.AuditEngine.computeSummary(window.assetsData || [], round)
      : { totalActive: 0, normal: 0, damagedRepairable: 0, damagedUnrepairable: 0, lost: 0 };
    const totalValue = (window.assetsData || []).reduce((s, a) => s + (Number(a.price) || 0), 0);
    openPrintWindow(GovForms.renderAnnualAuditMemo(round, { summary: { ...summary, totalValue } }));
  },

  async uploadAuditEvidencePhoto(event) {
    const file = event.target.files?.[0];
    const code = window.selectedAuditAssetCode;
    const round = window.currentAuditRound;
    if (!file || !code || !round) return;
    try {
      toast('กำลังอัปโหลดภาพถ่ายหลักฐานตรวจนับ...', 'info');
      const res = await StorageService.uploadEvidence(file, 'audits', `audit_${round.fiscalYear}_${code}`);
      const sanitized = FirebaseBridge.sanitizeCode(code);
      if (round.items && round.items[sanitized]) {
        round.items[sanitized].photoUrl = res.url;
        FirebaseBridge.saveAuditItem(round.fiscalYear, code, round.items[sanitized]);
      }
      const preview = document.getElementById('auditEvidencePreview');
      if (preview) {
        preview.src = res.url;
        preview.classList.remove('hidden');
      }
      toast('แนบภาพถ่ายหลักฐานตรวจนับสำเร็จ', 'success');
    } catch (err) {
      toast(`อัปโหลดภาพไม่สำเร็จ: ${err.message}`, 'error');
    }
  },

  // ================= PHASE 2: STATUTORY DISPOSAL WORKFLOW (ข้อ 215-218) =================
  renderDisposals() {
    const { assets, tickets, auditRound } = getAppState();
    const uneconCodes = new Set();
    assets.forEach(a => {
      if (MaintenanceEngine.evaluateRepairEconomics(a, tickets).isUneconomical) {
        uneconCodes.add(a.code);
      }
    });

    const candidates = DisposalEngine.extractCandidates(assets, auditRound, uneconCodes);
    const candListEl = document.getElementById('disposalCandidatesList');
    const candCountEl = document.getElementById('disposalCandidateCount');
    if (candCountEl) candCountEl.innerText = candidates.length;

    if (candListEl) {
      candListEl.innerHTML = candidates.length === 0
        ? `<p class="text-xs text-slate-400 text-center py-6">ยังไม่มีรายการเข้าเกณฑ์รอจำหน่าย (ชำรุด/สูญหาย/ไม่คุ้มซ่อม)</p>`
        : candidates.map(c => {
            const dep = DepreciationEngine.calculateDepreciation(c);
            return `
              <label class="flex items-start gap-2.5 p-2.5 rounded-lg border border-slate-200 hover:bg-rose-50/40 cursor-pointer text-xs">
                <input type="checkbox" class="disposal-cand-chk mt-1 rounded text-rose-600" value="${esc(c.code)}">
                <div class="flex-1 min-w-0">
                  <div class="font-semibold text-slate-800">${esc(c.name)} <span class="font-mono text-teal-700">(${esc(c.code)})</span></div>
                  <div class="text-slate-500">${esc(c.dept)} | ทุน ${Number(c.price || 0).toLocaleString()} ฿ | NBV ${dep.netBookValue.toLocaleString()} ฿</div>
                  <div class="text-rose-700 font-medium mt-0.5">${esc(c.candidateReasons.join(' • '))}</div>
                </div>
              </label>`;
          }).join('');
    }

    const reqListEl = document.getElementById('disposalRequestsList');
    if (reqListEl) {
      reqListEl.innerHTML = disposalsData.length === 0
        ? `<p class="text-xs text-slate-400 text-center py-8">ยังไม่มีรายการคำขอจำหน่ายพัสดุในระบบ</p>`
        : disposalsData.map(d => {
            const methodLabel = DISPOSAL_METHODS[d.method]?.label || d.method;
            const statusLabel = DISPOSAL_STATUS_LABELS[d.status] || d.status;
            const totalPrice = (d.items || []).reduce((s, i) => s + (Number(i.price) || 0), 0);
            let nextBtn = '';
            if (d.status === 'draft') {
              nextBtn = `<button onclick="MophUI.advanceDisposal('${esc(d.id)}', 'committee_review')" class="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold">ตั้งกรรมการประเมินฯ</button>`;
            } else if (d.status === 'committee_review') {
              nextBtn = `<button onclick="MophUI.advanceDisposal('${esc(d.id)}', 'approved')" class="px-2.5 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-semibold">ผอ. อนุมัติจำหน่าย</button>`;
            } else if (d.status === 'approved') {
              nextBtn = `<button onclick="MophUI.advanceDisposal('${esc(d.id)}', 'completed')" class="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold">ลงจ่ายออกจากทะเบียน</button>`;
            }
            return `
              <div class="border border-slate-200 rounded-xl p-4 bg-white space-y-2">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span class="font-mono font-bold text-xs bg-rose-100 text-rose-800 px-2 py-0.5 rounded">${esc(d.disposalNo)}</span>
                    <span class="text-xs font-semibold text-slate-700 ml-2">${esc(methodLabel)}</span>
                  </div>
                  <span class="text-xs px-2.5 py-0.5 rounded-full font-semibold ${d.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${esc(statusLabel)}</span>
                </div>
                <div class="text-xs text-slate-600">
                  จำนวน <strong>${(d.items || []).length}</strong> รายการ | มูลค่าทุนรวม <strong>${totalPrice.toLocaleString()} บาท</strong>
                  ${d.committeeOrderNo ? ` | คำสั่งกรรมการ: <strong>${esc(d.committeeOrderNo)}</strong>` : ''}
                  ${d.approvedBy ? ` | ผู้อนุมัติ: <strong>${esc(d.approvedBy)}</strong>` : ''}
                </div>
                <div class="flex flex-wrap items-center gap-2 pt-1">
                  ${nextBtn}
                  <button onclick="MophUI.printDisposalForm('${esc(d.id)}')" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold">พิมพ์แบบขอจำหน่าย A4</button>
                </div>
              </div>`;
          }).join('');
    }
  },

  async createDisposalFromSelected() {
    if (!this.requirePermission('disposal:manage', 'สร้างคำขอจำหน่ายพัสดุ')) return;
    const checked = Array.from(document.querySelectorAll('.disposal-cand-chk:checked')).map(el => el.value);
    if (checked.length === 0) return toast('กรุณาติ๊กเลือกครุภัณฑ์อย่างน้อย 1 รายการ', 'warning');

    const method = document.getElementById('disposalMethodSelect')?.value || 'auction';
    const reason = document.getElementById('disposalReasonInput')?.value.trim() || 'ชำรุดเสื่อมสภาพจากการใช้งาน ไม่คุ้มค่าซ่อม';
    const items = checked.map(code => {
      const a = (window.assetsData || []).find(x => x.code === code);
      const dep = DepreciationEngine.calculateDepreciation(a);
      return { ...a, nbv: dep.netBookValue };
    }).filter(Boolean);

    try {
      const req = DisposalEngine.createDisposalRequest({
        fiscalYear: new Date().getFullYear() + 543,
        method,
        reason,
        items,
        createdBy: window.currentUser?.name || 'เจ้าหน้าที่พัสดุ',
        existingDisposals: disposalsData
      });
      disposalsData.unshift(req);
      persistLocal('nongchik_disposals', disposalsData);
      await FirebaseBridge.saveDisposal(req);
      this.logAction('DISPOSAL_CREATE', 'disposal', req.disposalNo, `สร้างคำขอจำหน่าย ${req.disposalNo} จำนวน ${items.length} รายการ`);
      this.renderDisposals();
      toast(`สร้างคำขอจำหน่าย ${req.disposalNo} เรียบร้อยแล้ว`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  },

  async advanceDisposal(disposalId, nextStatus) {
    const neededPerm = nextStatus === 'approved' ? 'disposal:approve' : 'disposal:manage';
    if (!this.requirePermission(neededPerm, 'เปลี่ยนสถานะคำขอจำหน่าย')) return;

    const idx = disposalsData.findIndex(d => d.id === disposalId);
    if (idx === -1) return;
    const current = disposalsData[idx];

    const meta = {};
    if (nextStatus === 'committee_review') {
      const orderNo = prompt('ระบุเลขที่คำสั่งแต่งตั้งคณะกรรมการสอบหาข้อเท็จจริง/ประเมินราคา:', `คำสั่ง รพ.หนองจิก ที่ /${current.fiscalYear}`);
      if (!orderNo) return;
      meta.committeeOrderNo = orderNo;
    } else if (nextStatus === 'approved') {
      const approver = prompt('ระบุชื่อ/ตำแหน่งผู้อนุมัติจำหน่าย:', 'ผู้อำนวยการโรงพยาบาลหนองจิก');
      if (!approver) return;
      meta.approvedBy = approver;
    } else if (nextStatus === 'completed') {
      if (!confirm(`ยืนยันการลงจ่ายครุภัณฑ์ ${(current.items || []).length} รายการ ออกจากทะเบียนคุมทรัพย์สิน (เปลี่ยนสถานะเป็น "จำหน่ายแล้ว" โดยเก็บประวัติไว้ตรวจสอบ)?`)) return;
      meta.completedBy = window.currentUser?.name || 'เจ้าหน้าที่พัสดุ';
    }

    try {
      const updated = DisposalEngine.transitionStatus(current, nextStatus, meta);
      disposalsData[idx] = updated;
      persistLocal('nongchik_disposals', disposalsData);
      await FirebaseBridge.saveDisposal(updated);

      if (nextStatus === 'completed') {
        const patches = DisposalEngine.buildMasterDisposalPatches(updated);
        const batchUpdates = [];
        patches.forEach(p => {
          const asset = (window.assetsData || []).find(a => a.code === p.code);
          if (asset) {
            asset.status = p.status;
            asset.disposalId = p.disposalId;
            asset.disposalNo = p.disposalNo;
            asset.disposedAt = p.disposedAt;
            batchUpdates.push({ code: p.code, newStatus: p.status });
          }
        });
        persistLocal('nongchik_custom_assets', window.assetsData);
        if (FirebaseBridge.isCloudActive()) {
          await FirebaseBridge.updateAssetsBatch(batchUpdates);
        }
        if (typeof window.updateStats === 'function') window.updateStats();
        if (typeof window.renderTable === 'function') window.renderTable();
      }

      this.logAction('DISPOSAL_STATUS', 'disposal', updated.disposalNo, `เปลี่ยนสถานะ ${updated.disposalNo} เป็น ${nextStatus}`);
      this.renderDisposals();
      this.renderExecutiveSummary();
      toast(`อัปเดตสถานะ ${updated.disposalNo} เรียบร้อยแล้ว`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  },

  printDisposalForm(disposalId) {
    const d = disposalsData.find(x => x.id === disposalId);
    if (!d) return;
    openPrintWindow(GovForms.renderDisposalRequestForm(d));
  },

  // ================= PHASE 3: HOSPITAL MAINTENANCE (COST) & PM/CALIBRATION (HA) =================
  openRepairCostModal(ticketId) {
    if (!this.requirePermission('repair:manage', 'บันทึกค่าซ่อมและอะไหล่')) return;
    const tk = (window.repairTickets || []).find(t => t.id === ticketId);
    if (!tk) return;
    editingTicketId = ticketId;
    document.getElementById('rcTicketLabel').innerText = `${tk.id} — ${tk.assetName} (${tk.assetCode})`;
    document.getElementById('rcRepairCost').value = tk.repairCost || '';
    document.getElementById('rcPartsUsed').value = tk.partsUsed || '';
    document.getElementById('rcRepairVendor').value = tk.repairVendor || '';
    document.getElementById('repairCostModal').classList.remove('hidden');
  },

  async saveRepairCost() {
    const tk = (window.repairTickets || []).find(t => t.id === editingTicketId);
    if (!tk) return;
    tk.repairCost = Number(document.getElementById('rcRepairCost').value) || 0;
    tk.partsUsed = document.getElementById('rcPartsUsed').value.trim();
    tk.repairVendor = document.getElementById('rcRepairVendor').value.trim();
    tk.technicianName = window.currentUser?.name || 'ช่างซ่อมบำรุง';
    tk.completedAt = tk.completedAt || new Date().toISOString().slice(0, 10);

    persistLocal('nongchik_tickets', window.repairTickets);
    await FirebaseBridge.saveTicket(tk);
    this.logAction('REPAIR_COST_UPDATE', 'ticket', tk.id, `บันทึกค่าซ่อม ${tk.assetCode} จำนวน ${tk.repairCost.toLocaleString()} บาท`);

    window.closeModal('repairCostModal');
    if (typeof window.renderTickets === 'function') window.renderTickets();
    this.renderExecutiveSummary();

    const asset = (window.assetsData || []).find(a => a.code === tk.assetCode);
    if (asset) {
      const econ = MaintenanceEngine.evaluateRepairEconomics(asset, window.repairTickets);
      if (econ.isUneconomical) {
        toast(`⚠️ แจ้งเตือนไม่คุ้มซ่อม: ${asset.code} (${econ.reasons.join(', ')})`, 'warning');
        return;
      }
    }
    toast('บันทึกต้นทุนค่าซ่อมเรียบร้อยแล้ว', 'success');
  },

  renderPmView() {
    const summary = MaintenanceEngine.summarizePmCompliance(pmSchedulesData);
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    setTxt('pmTotalCount', summary.total);
    setTxt('pmOverdueCount', summary.overdue);
    setTxt('pmDueSoonCount', summary.dueSoon);
    setTxt('pmCompliancePct', `${summary.compliancePercent}%`);

    const listEl = document.getElementById('pmSchedulesList');
    if (!listEl) return;

    listEl.innerHTML = pmSchedulesData.length === 0
      ? `<tr><td colspan="7" class="py-8 text-center text-slate-400">ยังไม่มีแผนบำรุงรักษาเชิงป้องกัน (PM) / สอบเทียบเครื่องมือแพทย์ — กดปุ่ม "+ เพิ่มแผน PM/สอบเทียบ" เพื่อเริ่มต้น</td></tr>`
      : pmSchedulesData.map(sc => {
          const st = MaintenanceEngine.classifyPmStatus(sc);
          const badge = st.status === 'overdue'
            ? `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-700">เกินกำหนด (${Math.abs(st.daysRemaining)} วัน)</span>`
            : st.status === 'due_soon'
              ? `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">ใกล้ครบกำหนด (${st.daysRemaining} วัน)</span>`
              : `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700">ปกติ (${st.daysRemaining} วัน)</span>`;
          return `
            <tr class="hover:bg-slate-50 border-b border-slate-100 text-xs">
              <td class="py-2.5 px-3 font-mono font-semibold text-teal-700">${esc(sc.assetCode)}</td>
              <td class="py-2.5 px-3 font-medium text-slate-800">${esc(sc.assetName)}</td>
              <td class="py-2.5 px-3 text-slate-600">${esc(sc.dept || '-')}</td>
              <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-semibold">${sc.scheduleType === 'calibration' ? 'สอบเทียบ (Cal)' : 'บำรุงรักษา (PM)'}</span></td>
              <td class="py-2.5 px-3 font-mono">${esc(sc.nextDueDate || '-')}</td>
              <td class="py-2.5 px-3">${badge}</td>
              <td class="py-2.5 px-3 text-right">
                <button onclick="MophUI.openCompletePmModal('${esc(sc.id)}')" class="px-2.5 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-[11px] font-semibold">บันทึกผลตรวจ</button>
              </td>
            </tr>`;
        }).join('');
  },

  openAddPmModal() {
    if (!this.requirePermission('pm:manage', 'เพิ่มแผน PM/สอบเทียบ')) return;
    document.getElementById('pmAssetCode').value = '';
    document.getElementById('pmType').value = 'calibration';
    document.getElementById('pmIntervalMonths').value = '12';
    document.getElementById('pmLastDoneDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('pmProvider').value = 'ศูนย์เครื่องมือแพทย์ (MEM)';
    document.getElementById('pmAddModal').classList.remove('hidden');
  },

  async saveNewPmSchedule() {
    const code = document.getElementById('pmAssetCode').value.trim();
    const asset = (window.assetsData || []).find(a => a.code === code);
    if (!asset) return toast('ไม่พบรหัสครุภัณฑ์นี้ในฐานข้อมูล', 'error');

    const lastDoneDate = document.getElementById('pmLastDoneDate').value || new Date().toISOString().slice(0, 10);
    const intervalMonths = Number(document.getElementById('pmIntervalMonths').value) || 12;
    const schedule = {
      id: `PM-${Date.now()}`,
      assetCode: asset.code,
      assetName: asset.name,
      dept: asset.dept,
      scheduleType: document.getElementById('pmType').value || 'calibration',
      intervalMonths,
      lastDoneDate,
      nextDueDate: MaintenanceEngine.calculateNextDueDate(lastDoneDate, intervalMonths),
      provider: document.getElementById('pmProvider').value.trim() || 'ศูนย์เครื่องมือแพทย์',
      certNo: '',
      certUrl: '',
      lastResult: 'pass',
      notes: ''
    };

    pmSchedulesData.unshift(schedule);
    persistLocal('nongchik_pm_schedules', pmSchedulesData);
    await FirebaseBridge.savePmSchedule(schedule);
    this.logAction('PM_CREATE', 'pm', schedule.assetCode, `สร้างแผน ${schedule.scheduleType} รอบ ${intervalMonths} เดือน (${asset.name})`);
    window.closeModal('pmAddModal');
    this.renderPmView();
    this.renderExecutiveSummary();
    toast('เพิ่มแผน PM/สอบเทียบเรียบร้อยแล้ว', 'success');
  },

  openCompletePmModal(scheduleId) {
    if (!this.requirePermission('pm:manage', 'บันทึกผล PM/สอบเทียบ')) return;
    const sc = pmSchedulesData.find(s => s.id === scheduleId);
    if (!sc) return;
    completingPmId = scheduleId;
    document.getElementById('pmCompleteLabel').innerText = `${sc.assetName} (${sc.assetCode})`;
    document.getElementById('pmCompleteDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('pmCertNo').value = sc.certNo || '';
    document.getElementById('pmResultSelect').value = 'pass';
    document.getElementById('pmCompleteModal').classList.remove('hidden');
  },

  async savePmCompletion() {
    const sc = pmSchedulesData.find(s => s.id === completingPmId);
    if (!sc) return;
    const doneDate = document.getElementById('pmCompleteDate').value || new Date().toISOString().slice(0, 10);
    sc.lastDoneDate = doneDate;
    sc.nextDueDate = MaintenanceEngine.calculateNextDueDate(doneDate, sc.intervalMonths);
    sc.certNo = document.getElementById('pmCertNo').value.trim();
    sc.lastResult = document.getElementById('pmResultSelect').value;

    const certFile = document.getElementById('pmCertFile')?.files?.[0];
    if (certFile) {
      try {
        const uploaded = await StorageService.uploadEvidence(certFile, 'pm', sc.id);
        sc.certUrl = uploaded.url;
      } catch (err) {
        toast(`อัปโหลดใบรับรองไม่สำเร็จ: ${err.message}`, 'warning');
      }
    }

    persistLocal('nongchik_pm_schedules', pmSchedulesData);
    await FirebaseBridge.savePmSchedule(sc);
    this.logAction('PM_RECORD', 'pm', sc.assetCode, `บันทึกผล ${sc.scheduleType} (${sc.lastResult}) ครบกำหนดถัดไป ${sc.nextDueDate}`);
    window.closeModal('pmCompleteModal');
    this.renderPmView();
    this.renderExecutiveSummary();
    toast(`บันทึกผลตรวจเรียบร้อย กำหนดครั้งถัดไป: ${sc.nextDueDate}`, 'success');
  },

  // ================= ADMIN USERS & AUDIT LOG =================
  async renderAdminView() {
    if (FirebaseBridge.isCloudActive()) {
      const remoteUsers = await FirebaseBridge.listUserProfiles();
      if (remoteUsers.length > 0) {
        registeredUsersData = remoteUsers;
        persistLocal('nongchik_users', registeredUsersData);
      }
    }

    const usersBody = document.getElementById('adminUsersTableBody');
    const canManageUsers = AuthRBAC.can(this.getCurrentRole(), 'user:manage');
    if (usersBody) {
      usersBody.innerHTML = registeredUsersData.length === 0
        ? `<tr><td colspan="5" class="py-6 text-center text-slate-400 text-xs">ยังไม่มีรายชื่อบุคลากรที่ลงทะเบียน</td></tr>`
        : registeredUsersData.map(u => `
            <tr class="border-b border-slate-100 text-xs">
              <td class="py-2.5 px-3 font-semibold text-slate-800">${esc(u.fullName || u.name || '-')}</td>
              <td class="py-2.5 px-3 text-slate-600">${esc(u.email || '-')}</td>
              <td class="py-2.5 px-3 text-slate-600">${esc(u.dept || '-')}</td>
              <td class="py-2.5 px-3">
                <select ${canManageUsers ? '' : 'disabled'} onchange="MophUI.changeUserRole('${esc(u.uid)}', this.value)" class="border rounded-lg px-2 py-1 text-xs bg-white">
                  ${Object.values(ROLES).map(r => `<option value="${r.key}" ${u.role === r.key ? 'selected' : ''}>${r.label}</option>`).join('')}
                </select>
              </td>
              <td class="py-2.5 px-3 text-slate-500">${esc(u.authMode || 'firebase')}</td>
            </tr>`).join('');
    }
    this.renderAuditLogTable();
  },

  async changeUserRole(uid, newRole) {
    if (!this.requirePermission('user:manage', 'เปลี่ยนสิทธิ์ผู้ใช้งาน')) return;
    const u = registeredUsersData.find(x => x.uid === uid);
    if (!u) return;
    const oldRole = u.role;
    u.role = newRole;
    persistLocal('nongchik_users', registeredUsersData);
    await FirebaseBridge.saveUserProfile(uid, { role: newRole });
    if (window.currentUser?.uid === uid) {
      window.currentUser.role = newRole;
      persistLocal('nongchik_user', window.currentUser);
      this.applyRoleGuards();
    }
    this.logAction('USER_ROLE_CHANGE', 'user', uid, `เปลี่ยนสิทธิ์ ${u.fullName || u.name} จาก ${oldRole} เป็น ${newRole}`);
    toast(`อัปเดตสิทธิ์เป็น ${AuthRBAC.getRoleMeta(newRole).label} สำเร็จ`, 'success');
  },

  renderAuditLogTable() {
    const query = document.getElementById('auditLogSearch')?.value || '';
    const filtered = AuditLogger.filterLogs(auditLogsData, { query });
    const body = document.getElementById('auditLogsTableBody');
    if (!body) return;

    body.innerHTML = filtered.length === 0
      ? `<tr><td colspan="5" class="py-6 text-center text-slate-400 text-xs">ยังไม่มีประวัติการใช้งาน (Audit Trail)</td></tr>`
      : filtered.slice(0, 100).map(l => `
          <tr class="border-b border-slate-100 text-xs">
            <td class="py-2 px-3 font-mono text-[11px] text-slate-500">${esc(String(l.timestamp || '').replace('T', ' ').slice(0, 19))}</td>
            <td class="py-2 px-3 font-semibold text-slate-800">${esc(l.actorName)} <span class="text-[10px] text-slate-400">(${esc(l.actorRole)})</span></td>
            <td class="py-2 px-3"><span class="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded">${esc(l.action)}</span></td>
            <td class="py-2 px-3 font-mono text-teal-700">${esc(l.targetId || '-')}</td>
            <td class="py-2 px-3 text-slate-700">${esc(l.summary)}</td>
          </tr>`).join('');
  },

  // ================= EXECUTIVE ANALYTICS ENRICHMENT =================
  renderExecutiveSummary() {
    const { assets, transfers, tickets } = getAppState();
    let totalNbv = 0;
    const fundTotals = {};
    FUND_SOURCES.forEach(f => { fundTotals[f] = { count: 0, value: 0 }; });

    let uneconomicalCount = 0;
    assets.forEach(a => {
      const norm = DepreciationEngine.normalizeAssetRecord(a);
      const dep = DepreciationEngine.calculateDepreciation(norm);
      if (!String(norm.status || '').includes('จำหน่ายแล้ว')) {
        totalNbv += dep.netBookValue;
      }
      const fs = fundTotals[norm.fundSource] ? norm.fundSource : 'ไม่ระบุ';
      fundTotals[fs].count += 1;
      fundTotals[fs].value += Number(norm.price) || 0;

      if (MaintenanceEngine.evaluateRepairEconomics(norm, tickets).isUneconomical) {
        uneconomicalCount += 1;
      }
    });

    const pmSummary = MaintenanceEngine.summarizePmCompliance(pmSchedulesData);
    const overdueBorrows = MaintenanceEngine.findOverdueBorrows(transfers);

    const nbvEl = document.getElementById('analyticTotalNbv');
    if (nbvEl) nbvEl.innerText = `${Math.round(totalNbv).toLocaleString()} บาท`;

    const alertsEl = document.getElementById('executiveAlertsStrip');
    if (alertsEl) {
      alertsEl.innerHTML = `
        <div class="p-3 rounded-xl border ${pmSummary.overdue > 0 ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'} text-xs">
          <p class="font-semibold">PM/สอบเทียบเกินกำหนด (HA)</p>
          <p class="text-lg font-bold mt-0.5">${pmSummary.overdue} รายการ</p>
        </div>
        <div class="p-3 rounded-xl border ${overdueBorrows.length > 0 ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-slate-50 border-slate-200 text-slate-700'} text-xs">
          <p class="font-semibold">ยืมครุภัณฑ์เกินกำหนดคืน</p>
          <p class="text-lg font-bold mt-0.5">${overdueBorrows.length} รายการ</p>
        </div>
        <div class="p-3 rounded-xl border ${uneconomicalCount > 0 ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-slate-50 border-slate-200 text-slate-700'} text-xs">
          <p class="font-semibold">ครุภัณฑ์ค่าซ่อมเกินเกณฑ์ (ไม่คุ้มซ่อม)</p>
          <p class="text-lg font-bold mt-0.5">${uneconomicalCount} รายการ</p>
        </div>
      `;
    }

    const fundEl = document.getElementById('fundSourceBreakdown');
    if (fundEl) {
      fundEl.innerHTML = Object.entries(fundTotals).map(([name, d]) => `
        <div class="flex justify-between items-center text-xs py-1.5 border-b border-slate-100 last:border-0">
          <span class="font-medium text-slate-700">${esc(name)}</span>
          <span class="font-mono text-slate-600">${d.count.toLocaleString()} รายการ (${Math.round(d.value).toLocaleString()} ฿)</span>
        </div>`).join('');
    }
  }
};

if (typeof window !== 'undefined') {
  window.MophUI = MophUI;
}
