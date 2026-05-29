/**
 * NHAI Datalake 3.0 — Offline Storage Engine (React Native + MMKV)
 * 
 * Uses react-native-mmkv for synchronous, extremely fast, encrypted 
 * offline storage of attendance records.
 */

import { globalVectorStore } from './VectorStore';

let MMKV: any = null;
try {
  MMKV = require('react-native-mmkv').MMKV;
} catch (e) {
  console.warn('MMKV not available:', e);
}

// Initialize MMKV instance with safe fallback
let storageInstance: any;
try {
  if (MMKV) {
    storageInstance = new MMKV({
      id: 'nhai-datalake-biometrics',
      encryptionKey: 'datalake-secure-key-3.0'
    });
  }
} catch (e) {
  console.warn('MMKV init failed:', e);
}

// Fallback to in-memory storage if MMKV fails
if (!storageInstance) {
  const memStore: Record<string, string> = {};
  storageInstance = {
    getString: (key: string) => memStore[key] ?? null,
    set: (key: string, value: string) => { memStore[key] = value; },
  };
}

export const storage = storageInstance;

export type AuthRecord = {
  id: string;
  userId: string;
  timestamp: number;
  confidence: number;
  livenessPassed: boolean;
  synced: boolean;
};

export type FaceTemplate = {
  template_id: string;
  user_id: string;
  protected_template: number[];       // L2-normalized average embedding
  angle_embeddings?: {                // Per-angle embeddings
    front: number[];
    left: number[];
    right: number[];
  };
  quality_score?: number;             // Average quality at enrollment
  enrollment_frame_count?: number;    // How many frames were captured
  enrollment_date: number;
  revoked: boolean;
};

export class StorageEngine {
  private static RECORDS_KEY = 'auth_records';
  private static TEMPLATES_KEY = 'nhai_templates';
  
  // Initialize vector store from stored templates on app start
  static initVectorStore() {
    const templates = this.getAllTemplates();
    globalVectorStore.rebuild(templates);
    console.log(`[StorageEngine] Initialized VectorStore with ${templates.length} templates`);
  }

  /**
   * Save a biometric template securely in MMKV and update VectorStore
   */
  static saveTemplate(userId: string, embedding: number[], meta: any = {}): string {
    const templateId = `temp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const newTemplate: FaceTemplate = {
      template_id: templateId,
      user_id: userId,
      protected_template: embedding,
      enrollment_date: Date.now(),
      revoked: false,
      ...meta
    };
    const store = this.getTemplatesMap();
    store[userId] = newTemplate;
    storage.set(this.TEMPLATES_KEY, JSON.stringify(store));
    
    // Update vector store
    globalVectorStore.insert(userId, embedding);
    
    return templateId;
  }

  /**
   * Get templates map (userId -> FaceTemplate)
   */
  static getTemplatesMap(): Record<string, FaceTemplate> {
    const data = storage.getString(this.TEMPLATES_KEY);
    return data ? JSON.parse(data) : {};
  }

  /**
   * Get all stored face templates
   */
  static getAllTemplates(): FaceTemplate[] {
    return Object.values(this.getTemplatesMap());
  }

  /**
   * Load face template for a specific user
   */
  static loadTemplate(userId: string): FaceTemplate | null {
    const map = this.getTemplatesMap();
    const template = map[userId];
    if (!template || template.revoked) return null;
    return template;
  }

  /**
   * Delete face template securely and update VectorStore
   */
  static deleteTemplate(userId: string): boolean {
    const map = this.getTemplatesMap();
    if (!map[userId]) return false;

    // 3-pass secure overwrite with random values
    for (let pass = 0; pass < 3; pass++) {
      map[userId].protected_template = new Array(map[userId].protected_template.length)
        .fill(0)
        .map(() => Math.random());
      storage.set(this.TEMPLATES_KEY, JSON.stringify(map));
    }

    delete map[userId];
    storage.set(this.TEMPLATES_KEY, JSON.stringify(map));
    
    // Remove from vector store
    globalVectorStore.remove(userId);
    
    return true;
  }

  /**
   * Save a new authentication record offline
   */
  static saveRecord(record: Omit<AuthRecord, 'id' | 'synced'>): AuthRecord {
    const records = this.getAllRecords();
    const newRecord: AuthRecord = {
      ...record,
      id: `rec_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      synced: false,
    };
    records.push(newRecord);
    storage.set(this.RECORDS_KEY, JSON.stringify(records));
    return newRecord;
  }

  /**
   * Get all stored records
   */
  static getAllRecords(): AuthRecord[] {
    const data = storage.getString(this.RECORDS_KEY);
    return data ? JSON.parse(data) : [];
  }

  /**
   * Get all pending (unsynced) records
   */
  static getPendingRecords(): AuthRecord[] {
    return this.getAllRecords().filter(r => !r.synced);
  }

  /**
   * Purge records that have been successfully synced to AWS
   */
  static purgeSyncedRecords(syncedIds: string[]) {
    const records = this.getAllRecords();
    const remaining = records.filter(r => !syncedIds.includes(r.id));
    storage.set(this.RECORDS_KEY, JSON.stringify(remaining));
  }
}

// Call init once file is imported
StorageEngine.initVectorStore();
