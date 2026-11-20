// storage-service.js - Client-Side Image Compression & Firebase Storage Evidence Uploader
// Supports Firebase Storage (Compat SDK) with graceful compressed DataURL fallback when offline/local.

import { FirebaseBridge } from './firebase-bridge.js';

const MAX_BYTES_DEFAULT = 5 * 1024 * 1024; // 5 MB (matches storage.rules)

function getFirebaseStorage() {
  if (typeof window === 'undefined' || !window.firebase || typeof window.firebase.storage !== 'function') {
    return null;
  }
  try {
    if (!window.firebase.apps || window.firebase.apps.length === 0) return null;
    return window.firebase.storage();
  } catch {
    return null;
  }
}

export const StorageService = {
  buildStoragePath(folder = 'assets', entityId = 'unknown', filename = 'file.jpg', timestamp = Date.now()) {
    const allowedFolders = ['assets', 'audits', 'pm', 'disposals'];
    const safeFolder = allowedFolders.includes(folder) ? folder : 'assets';
    const safeEntity = FirebaseBridge.sanitizeCode(String(entityId || 'unknown')) || 'unknown';
    const safeName = String(filename || 'file.jpg').trim().replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${safeFolder}/${safeEntity}/${timestamp}_${safeName}`;
  },

  validateFile(file, maxBytes = MAX_BYTES_DEFAULT) {
    if (!file) return { valid: false, error: 'ไม่พบไฟล์ที่เลือก' };
    const size = Number(file.size) || 0;
    const type = String(file.type || '').toLowerCase();

    if (size > maxBytes) {
      const mb = Math.round((maxBytes / (1024 * 1024)) * 10) / 10;
      return { valid: false, error: `ขนาดไฟล์เกิน ${mb} MB` };
    }
    const isImage = type.startsWith('image/');
    const isPdf = type === 'application/pdf';
    if (!isImage && !isPdf) {
      return { valid: false, error: 'รองรับเฉพาะไฟล์รูปภาพ (JPG/PNG/WebP) หรือเอกสาร PDF เท่านั้น' };
    }
    return { valid: true };
  },

  /**
   * Compresses an image File in the browser using an offscreen Canvas.
   * Returns { blob, dataUrl } for uploading or local preview.
   */
  async compressImageInBrowser(file, options = {}) {
    const maxWidth = options.maxWidth || 1024;
    const quality = options.quality || 0.75;

    return new Promise((resolve, reject) => {
      if (typeof FileReader === 'undefined' || typeof Image === 'undefined') {
        reject(new Error('Browser image APIs unavailable'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพได้'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('ไฟล์รูปภาพเสียหาย'));
        img.onload = () => {
          const scale = img.width > maxWidth ? maxWidth / img.width : 1;
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          canvas.toBlob(blob => {
            resolve({ blob: blob || file, dataUrl });
          }, 'image/jpeg', quality);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  },

  /**
   * Uploads image/PDF evidence to Firebase Storage when authenticated & available;
   * otherwise falls back to compressed local DataURL so offline workflows never break.
   */
  async uploadEvidence(file, folder = 'assets', entityId = 'unknown') {
    const check = this.validateFile(file);
    if (!check.valid) throw new Error(check.error);

    const isImage = String(file.type || '').toLowerCase().startsWith('image/');
    let payloadBlob = file;
    let fallbackDataUrl = '';

    if (isImage && typeof document !== 'undefined') {
      const compressed = await this.compressImageInBrowser(file);
      payloadBlob = compressed.blob;
      fallbackDataUrl = compressed.dataUrl;
    } else if (typeof FileReader !== 'undefined') {
      fallbackDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์ได้'));
        reader.readAsDataURL(file);
      });
    }

    const storagePath = this.buildStoragePath(folder, entityId, file.name);
    const storage = getFirebaseStorage();
    const isAuthed = Boolean(typeof window !== 'undefined' && window.firebase?.auth?.()?.currentUser);

    if (storage && isAuthed) {
      try {
        const ref = storage.ref(storagePath);
        await ref.put(payloadBlob, { contentType: isImage ? 'image/jpeg' : file.type });
        const url = await ref.getDownloadURL();
        return { url, storagePath, mode: 'firebase_storage' };
      } catch (err) {
        console.warn('[StorageService] Firebase Storage upload failed, falling back to local DataURL:', err);
      }
    }

    return {
      url: fallbackDataUrl,
      storagePath,
      mode: 'local_data_url'
    };
  }
};
