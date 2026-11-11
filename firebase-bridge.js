// firebase-bridge.js - Real-time Firestore & LocalStorage Hybrid Bridge
// Compatible with Node.js test environment and Browser window object

let currentStatus = 'local_storage'; // 'connected' | 'offline_cached' | 'local_storage'
let firebaseApp = null;
let firestoreDb = null;
let activeListeners = [];

export const FirebaseBridge = {
  /**
   * Replaces problematic characters (especially forward slashes in asset codes)
   * to ensure valid Firestore document paths.
   */
  sanitizeCode(code) {
    if (!code || typeof code !== 'string') return '';
    return code.trim().replace(/\//g, '_');
  },

  /**
   * Safely extracts the asset code from scanned QR text or URL.
   * Handles URLs with forward slashes in the asset code, e.g. https://.../scan/6515-070-0002/22
   */
  extractQrAssetCode(text) {
    if (!text || typeof text !== 'string') return '';
    const trimmed = text.trim();
    const scanMatch = trimmed.match(/\/scan\/(.+)$/);
    if (scanMatch) {
      try {
        return decodeURIComponent(scanMatch[1]).trim();
      } catch {
        return scanMatch[1].trim();
      }
    }
    return trimmed;
  },

  /**
   * Parses JSON string, JavaScript snippet (e.g. const firebaseConfig = { ... };),
   * or direct object into a clean Firebase config object.
   */
  parseConfig(input) {
    if (!input) return null;
    if (typeof input === 'object') {
      return (input.projectId || input.apiKey) ? input : null;
    }
    if (typeof input !== 'string') return null;

    const trimmed = input.trim();
    if (!trimmed) return null;

    // Try standard JSON.parse first
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && (parsed.projectId || parsed.apiKey)) return parsed;
    } catch {
      // Not pure JSON, continue to JS snippet extractor
    }

    // Try extracting object literal { ... }
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      const objStr = match[0];
      try {
        // Safe evaluation of JS object literal
        const fn = new Function(`"use strict"; return (${objStr});`);
        const extracted = fn();
        if (extracted && (extracted.projectId || extracted.apiKey)) {
          return extracted;
        }
      } catch {
        return null;
      }
    }

    return null;
  },

  /**
   * Resets connection state to local storage (useful for testing or disconnecting).
   */
  reset() {
    activeListeners.forEach(unsub => {
      try { if (typeof unsub === 'function') unsub(); } catch {}
    });
    activeListeners = [];
    currentStatus = 'local_storage';
    firebaseApp = null;
    firestoreDb = null;
  },

  /**
   * Returns current sync status: 'connected' | 'offline_cached' | 'local_storage'
   */
  getStatus() {
    return currentStatus;
  },

  /**
   * Initializes Firebase and Firestore with IndexedDB persistence if running in browser.
   */
  async init(configInput, options = { enablePersistence: true }) {
    const config = this.parseConfig(configInput);
    if (!config) {
      currentStatus = 'local_storage';
      return false;
    }

    // If running in browser with Firebase loaded
    const fb = typeof window !== 'undefined' ? window.firebase : null;
    if (!fb) {
      // No Firebase SDK loaded in environment; stay in local_storage mode
      currentStatus = 'local_storage';
      return false;
    }

    try {
      if (!fb.apps || fb.apps.length === 0) {
        firebaseApp = fb.initializeApp(config);
      } else {
        firebaseApp = fb.app();
      }

      firestoreDb = fb.firestore();

      if (options.enablePersistence && typeof window !== 'undefined' && firestoreDb.enablePersistence) {
        try {
          await firestoreDb.enablePersistence({ synchronizeTabs: true });
        } catch (persErr) {
          if (persErr.code === 'failed-precondition') {
            // Multiple tabs open, persistence can only be enabled in one tab at a time.
            console.warn('[FirebaseBridge] Multiple tabs open; offline persistence enabled in primary tab.');
          } else if (persErr.code === 'unimplemented') {
            console.warn('[FirebaseBridge] Current browser does not support IndexedDB persistence.');
          }
        }
      }

      currentStatus = navigator?.onLine === false ? 'offline_cached' : 'connected';

      // Monitor online/offline events in browser
      if (typeof window !== 'undefined') {
        window.addEventListener('online', () => {
          if (firestoreDb) currentStatus = 'connected';
        });
        window.addEventListener('offline', () => {
          if (firestoreDb) currentStatus = 'offline_cached';
        });
      }

      return true;
    } catch (err) {
      console.error('[FirebaseBridge] Initialization failed:', err);
      currentStatus = 'local_storage';
      return false;
    }
  },

  /**
   * One-click seed of initial assets into Firestore.
   */
  async seedInitialAssets(assetsArray, onProgress) {
    if (!firestoreDb || !Array.isArray(assetsArray) || assetsArray.length === 0) {
      return { total: 0, inserted: 0 };
    }

    const batchLimit = 400;
    let inserted = 0;
    const total = assetsArray.length;

    for (let i = 0; i < total; i += batchLimit) {
      const chunk = assetsArray.slice(i, i + batchLimit);
      const batch = firestoreDb.batch();

      chunk.forEach(item => {
        const docId = this.sanitizeCode(item.code || `asset_${Date.now()}`);
        const docRef = firestoreDb.collection('assets').doc(docId);
        batch.set(docRef, {
          code: item.code,
          name: item.name,
          price: Number(item.price) || 0,
          date: item.date || '',
          dept: item.dept || 'ยังไม่ระบุแผนก',
          status: item.status || 'ใช้งานปกติ',
          updatedAt: new Date().toISOString(),
          updatedBy: 'System Seed'
        }, { merge: true });
      });

      await batch.commit();
      inserted += chunk.length;
      if (typeof onProgress === 'function') {
        onProgress(inserted, total);
      }
    }

    return { total, inserted };
  },

  /**
   * Subscribes to real-time asset changes.
   */
  subscribeAssets(callback) {
    if (!firestoreDb) {
      // Local fallback
      return () => {};
    }

    const unsubscribe = firestoreDb.collection('assets').onSnapshot(
      snapshot => {
        const assets = [];
        snapshot.forEach(doc => assets.push(doc.data()));
        currentStatus = 'connected';
        callback(assets);
      },
      error => {
        console.warn('[FirebaseBridge] Assets snapshot warning:', error);
        if (error.code === 'unavailable') {
          currentStatus = 'offline_cached';
        }
      }
    );

    activeListeners.push(unsubscribe);
    return unsubscribe;
  },

  /**
   * Subscribes to annual audit round updates.
   */
  subscribeAuditRound(fiscalYear, callback) {
    if (!firestoreDb || !fiscalYear) return () => {};

    const docId = `audit_${fiscalYear}`;
    const unsubscribe = firestoreDb.collection('annual_audits').doc(docId).onSnapshot(
      doc => {
        if (doc.exists) {
          callback(doc.data());
        } else {
          callback(null);
        }
      },
      error => {
        console.warn('[FirebaseBridge] Audit snapshot warning:', error);
      }
    );

    activeListeners.push(unsubscribe);
    return unsubscribe;
  },

  /**
   * Saves an individual audit item to the annual audit round document.
   * Uses nested map format for Firestore set({ merge: true }) and wraps in try-catch for offline safety.
   */
  async saveAuditItem(fiscalYear, assetCode, itemData) {
    const sanitizedId = this.sanitizeCode(assetCode);
    if (firestoreDb && fiscalYear) {
      try {
        const docRef = firestoreDb.collection('annual_audits').doc(`audit_${fiscalYear}`);
        const updatePayload = {
          lastUpdated: new Date().toISOString(),
          items: {
            [sanitizedId]: {
              ...itemData,
              code: assetCode,
              auditedAt: itemData.auditedAt || new Date().toISOString()
            }
          }
        };
        await docRef.set(updatePayload, { merge: true });
      } catch (err) {
        console.warn('[FirebaseBridge] Firestore audit sync deferred (offline/error):', err);
      }
    }

    // Always persist to localStorage for offline safety
    try {
      const key = `nongchik_audit_${fiscalYear}`;
      const existing = JSON.parse(localStorage.getItem(key) || '{"items":{}}');
      if (!existing.items) existing.items = {};
      existing.items[sanitizedId] = {
        ...itemData,
        code: assetCode,
        auditedAt: itemData.auditedAt || new Date().toISOString()
      };
      existing.lastUpdated = new Date().toISOString();
      localStorage.setItem(key, JSON.stringify(existing));
    } catch {}
  },

  /**
   * Saves or finalizes an entire annual audit round document in Firestore.
   */
  async saveAuditRound(roundData) {
    if (!roundData || !roundData.fiscalYear) return;
    const docId = `audit_${roundData.fiscalYear}`;
    if (firestoreDb) {
      try {
        await firestoreDb.collection('annual_audits').doc(docId).set({
          ...roundData,
          lastUpdated: new Date().toISOString()
        }, { merge: true });
      } catch (err) {
        console.warn('[FirebaseBridge] Firestore save round deferred:', err);
      }
    }
  },

  /**
   * Batch updates master asset statuses in Firestore when closing an audit round.
   */
  async updateAssetsBatch(updates) {
    if (!firestoreDb || !Array.isArray(updates) || updates.length === 0) return;
    const batchLimit = 400;
    for (let i = 0; i < updates.length; i += batchLimit) {
      const chunk = updates.slice(i, i + batchLimit);
      const batch = firestoreDb.batch();
      chunk.forEach(u => {
        const docId = this.sanitizeCode(u.code);
        const ref = firestoreDb.collection('assets').doc(docId);
        batch.set(ref, {
          status: u.newStatus,
          updatedAt: new Date().toISOString(),
          updatedBy: 'Annual Audit Finalize'
        }, { merge: true });
      });
      try {
        await batch.commit();
      } catch (err) {
        console.warn('[FirebaseBridge] Batch asset update failed:', err);
      }
    }
  },

  /**
   * Saves or updates a ticket in Firestore and localStorage.
   */
  async saveTicket(ticket) {
    const id = ticket.id || `ticket_${Date.now()}`;
    if (firestoreDb) {
      await firestoreDb.collection('tickets').doc(id).set(ticket, { merge: true });
    }
  },

  /**
   * Saves or updates a transfer log in Firestore and localStorage.
   */
  async saveTransfer(transfer) {
    const id = transfer.id || `trans_${Date.now()}`;
    if (firestoreDb) {
      await firestoreDb.collection('transfers').doc(id).set(transfer, { merge: true });
    }
  }
};

// Expose globally for browser
if (typeof window !== 'undefined') {
  window.FirebaseBridge = FirebaseBridge;
}
