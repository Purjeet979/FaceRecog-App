/**
 * NHAI Datalake 3.0 — Offline Sync Engine
 * 
 * Listens for network connectivity restoration via NetInfo and uploads
 * pending records to AWS. Upon success, immediately purges local data.
 */

import NetInfo from '@react-native-community/netinfo';
import { StorageEngine } from './StorageEngine';

export class SyncEngine {
  private static isSyncing = false;
  // Mock AWS endpoint
  private static AWS_ENDPOINT = 'https://httpbin.org/post';

  static init() {
    // Listen for network state changes
    NetInfo.addEventListener(state => {
      if (state.isConnected && state.isInternetReachable) {
        this.syncPendingRecords();
      }
    });
  }

  static async syncPendingRecords() {
    if (this.isSyncing) return;
    
    const pending = StorageEngine.getPendingRecords();
    if (pending.length === 0) return;

    this.isSyncing = true;
    console.log(`[SyncEngine] Attempting to sync ${pending.length} records to AWS...`);

    try {
      // Simulate AWS REST API call
      const response = await fetch(this.AWS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer datalake_edge_token'
        },
        body: JSON.stringify({ batch: pending })
      });

      if (response.ok) {
        console.log(`[SyncEngine] Successfully synced ${pending.length} records.`);
        
        // PURGE MECHANISM: Delete records from local DB once confirmed by server
        const syncedIds = pending.map(r => r.id);
        StorageEngine.purgeSyncedRecords(syncedIds);
        console.log(`[SyncEngine] Purged local records to free up storage.`);
      } else {
        console.error('[SyncEngine] AWS Server rejected the sync batch.');
      }
    } catch (error) {
      console.error('[SyncEngine] Network error during sync, will retry later:', error);
    } finally {
      this.isSyncing = false;
    }
  }
}
