/**
 * IndexedDB offline storage for Dyna Radical 64
 * Ensures all loaded/downloaded ROMs are completely playable offline.
 */

const DB_NAME = 'dyna64_offline_v2';
const DB_VERSION = 1;
const STORE_ROMS = 'rom_binaries';
const STORE_METADATA = 'rom_metadata';
const STORE_STATES = 'save_states';
const STORE_QUEUE = 'sync_queue';

let dbInstance: IDBDatabase | null = null;

export interface OfflineRomMeta {
  id: string;
  name: string;
  filename: string;
  size: number;
  gameNumber?: number;
  uploadedAt: string;
  supabaseSynced: boolean;
  isCustom?: boolean;
}

export interface OfflineSyncItem {
  id: string;
  name: string;
  filename: string;
  dataBase64: string;
  gameNumber?: number;
  timestamp: number;
}

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_ROMS)) {
        db.createObjectStore(STORE_ROMS); // key: id or gameNumber
      }
      if (!db.objectStoreNames.contains(STORE_METADATA)) {
        db.createObjectStore(STORE_METADATA, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_STATES)) {
        db.createObjectStore(STORE_STATES);
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: 'id' });
      }
    };

    req.onsuccess = () => {
      dbInstance = req.result;
      resolve(dbInstance);
    };

    req.onerror = () => reject(req.error);
  });
}

// Save ROM binary locally for offline play
export async function saveRomOffline(id: string | number, buffer: ArrayBuffer, meta: OfflineRomMeta): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_ROMS, STORE_METADATA], 'readwrite');
    tx.objectStore(STORE_ROMS).put(buffer, id);
    tx.objectStore(STORE_METADATA).put(meta);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Get ROM binary from local IndexedDB
export async function getRomOffline(id: string | number): Promise<ArrayBuffer | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ROMS, 'readonly');
    const req = tx.objectStore(STORE_ROMS).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// Get all offline ROM metadata
export async function getAllOfflineRoms(): Promise<OfflineRomMeta[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_METADATA, 'readonly');
    const req = tx.objectStore(STORE_METADATA).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// Delete ROM offline
export async function deleteRomOffline(id: string | number): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_ROMS, STORE_METADATA, STORE_STATES], 'readwrite');
    tx.objectStore(STORE_ROMS).delete(id);
    tx.objectStore(STORE_METADATA).delete(String(id));
    tx.objectStore(STORE_STATES).delete(String(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Clear all offline storage
export async function clearAllOffline(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_ROMS, STORE_METADATA, STORE_STATES, STORE_QUEUE], 'readwrite');
    tx.objectStore(STORE_ROMS).clear();
    tx.objectStore(STORE_METADATA).clear();
    tx.objectStore(STORE_STATES).clear();
    tx.objectStore(STORE_QUEUE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Save Emulator State
export async function saveEmulatorState(gameId: string | number, stateJson: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STATES, 'readwrite');
    tx.objectStore(STORE_STATES).put(stateJson, String(gameId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Load Emulator State
export async function loadEmulatorState(gameId: string | number): Promise<string | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_STATES, 'readonly');
    const req = tx.objectStore(STORE_STATES).get(String(gameId));
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// Queue item for sync when back online
export async function queueForSync(item: OfflineSyncItem): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    tx.objectStore(STORE_QUEUE).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getSyncQueue(): Promise<OfflineSyncItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readonly');
    const req = tx.objectStore(STORE_QUEUE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function removeFromSyncQueue(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readwrite');
    tx.objectStore(STORE_QUEUE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
