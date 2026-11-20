// auth-rbac.js - Firebase Authentication, 5-Role MOPH RBAC Matrix & Audit Trail Logger
// Works in both Browser (Firebase 10.x Compat SDK) and Node.js test environments.

export const ROLES = {
  admin: {
    key: 'admin',
    label: 'เจ้าหน้าที่พัสดุ (Admin)',
    shortLabel: 'พัสดุ/Admin',
    badgeClass: 'bg-teal-100 text-teal-800 border-teal-200'
  },
  auditor: {
    key: 'auditor',
    label: 'คณะกรรมการตรวจนับพัสดุ',
    shortLabel: 'กรรมการตรวจนับ',
    badgeClass: 'bg-indigo-100 text-indigo-800 border-indigo-200'
  },
  dept_user: {
    key: 'dept_user',
    label: 'หัวหน้าตึก / เจ้าหน้าที่แผนก',
    shortLabel: 'เจ้าหน้าที่แผนก',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200'
  },
  technician: {
    key: 'technician',
    label: 'ช่างซ่อมบำรุง / ศูนย์เครื่องมือแพทย์',
    shortLabel: 'ช่าง/MEM',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-200'
  },
  executive: {
    key: 'executive',
    label: 'ผู้บริหาร (ผอ. / หน.บริหาร)',
    shortLabel: 'ผู้บริหาร',
    badgeClass: 'bg-purple-100 text-purple-800 border-purple-200'
  }
};

export const PERMISSIONS = {
  admin: [
    'asset:read', 'asset:write', 'asset:import',
    'transfer:request', 'transfer:manage',
    'repair:request', 'repair:manage',
    'pm:read', 'pm:manage',
    'audit:scan', 'audit:report', 'audit:finalize',
    'disposal:read', 'disposal:manage', 'disposal:approve',
    'dashboard:executive',
    'user:manage', 'auditlog:view', 'forms:print'
  ],
  auditor: [
    'asset:read',
    'audit:scan', 'audit:report',
    'disposal:read',
    'forms:print'
  ],
  dept_user: [
    'asset:read',
    'transfer:request',
    'repair:request',
    'pm:read',
    'forms:print'
  ],
  technician: [
    'asset:read',
    'repair:request', 'repair:manage',
    'pm:read', 'pm:manage',
    'forms:print'
  ],
  executive: [
    'asset:read',
    'audit:report',
    'disposal:read', 'disposal:approve',
    'pm:read',
    'dashboard:executive',
    'auditlog:view',
    'forms:print'
  ]
};

function getFirebaseAuth() {
  if (typeof window === 'undefined' || !window.firebase || typeof window.firebase.auth !== 'function') {
    return null;
  }
  try {
    if (!window.firebase.apps || window.firebase.apps.length === 0) return null;
    return window.firebase.auth();
  } catch {
    return null;
  }
}

export const AuthRBAC = {
  getRolePermissions(role) {
    return PERMISSIONS[role] ? [...PERMISSIONS[role]] : [];
  },

  can(role, permission) {
    if (!role || !permission) return false;
    const perms = PERMISSIONS[role];
    return Array.isArray(perms) ? perms.includes(permission) : false;
  },

  getRoleMeta(role) {
    return ROLES[role] || ROLES.dept_user;
  },

  /**
   * First registered user in an empty users collection is automatically bootstrapped as 'admin'.
   */
  resolveBootstrapRole(existingUsersCount, requestedRole) {
    if (Number(existingUsersCount) === 0) return 'admin';
    if (requestedRole && ROLES[requestedRole]) return requestedRole;
    return 'dept_user';
  },

  /**
   * Optionally scopes asset list to user's own department for dept_user.
   */
  filterAssetsForUser(assets = [], user = null, onlyMyDept = false) {
    if (!Array.isArray(assets)) return [];
    if (!user || !onlyMyDept) return assets;
    if (user.role === 'dept_user' && user.dept) {
      const userDept = String(user.dept).trim().toLowerCase();
      return assets.filter(a => String(a.dept || '').trim().toLowerCase() === userDept);
    }
    return assets;
  },

  isFirebaseAuthAvailable() {
    return Boolean(getFirebaseAuth());
  },

  initFirebaseAuth(onStateChange) {
    const auth = getFirebaseAuth();
    if (!auth) return false;
    auth.onAuthStateChanged(user => {
      if (typeof onStateChange === 'function') onStateChange(user);
    });
    return true;
  },

  async signInWithEmail(email, password) {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error('Firebase Auth ยังไม่ได้เชื่อมต่อ');
    const cred = await auth.signInWithEmailAndPassword(String(email).trim(), String(password));
    return cred.user;
  },

  async registerWithEmail(email, password, displayName = '') {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error('Firebase Auth ยังไม่ได้เชื่อมต่อ');
    const cred = await auth.createUserWithEmailAndPassword(String(email).trim(), String(password));
    if (displayName && cred.user && typeof cred.user.updateProfile === 'function') {
      await cred.user.updateProfile({ displayName: String(displayName).trim() });
    }
    return cred.user;
  },

  async signOut() {
    const auth = getFirebaseAuth();
    if (auth) {
      await auth.signOut();
    }
    return true;
  }
};

export const AuditLogger = {
  createEntry({ actor = {}, action = 'UNKNOWN', targetType = 'system', targetId = '', summary = '', changes = null } = {}) {
    const now = new Date();
    const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
    return {
      id: `LOG-${now.getTime()}-${rand}`,
      timestamp: now.toISOString(),
      actorUid: actor.uid || 'local',
      actorName: actor.fullName || actor.name || actor.email || 'ผู้ใช้งานระบบ',
      actorRole: actor.role || 'dept_user',
      actorDept: actor.dept || '-',
      action: String(action),
      targetType: String(targetType),
      targetId: String(targetId),
      summary: String(summary),
      changes: changes || null
    };
  },

  filterLogs(logs = [], filters = {}) {
    if (!Array.isArray(logs)) return [];
    const { action = '', targetType = '', query = '' } = filters;
    const q = String(query || '').trim().toLowerCase();

    return logs.filter(entry => {
      if (action && entry.action !== action) return false;
      if (targetType && entry.targetType !== targetType) return false;
      if (q) {
        const hay = `${entry.actorName || ''} ${entry.action || ''} ${entry.targetId || ''} ${entry.summary || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }
};
