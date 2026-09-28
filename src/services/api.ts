/**
 * API service for communicating with the backend and Supabase
 */

import {
  saveRomOffline,
  getSyncQueue,
  removeFromSyncQueue,
  OfflineRomMeta,
} from './db';

export interface BackendStatus {
  status: string;
  totalRoms: number;
  supabase: {
    isConfigured: boolean;
    url: string;
    connected: boolean;
    message?: string;
  };
}

export interface BackendRom {
  id: string;
  name: string;
  filename: string;
  size: number;
  uploadedAt: string;
  supabaseSynced: boolean;
  gameNumber?: number;
}

// Check backend connection & Supabase status
export async function getBackendStatus(): Promise<BackendStatus | null> {
  try {
    const res = await fetch('/api/status', { signal: AbortSignal.timeout(3500) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Fetch list of ROMs from backend
export async function fetchBackendRoms(): Promise<BackendRom[]> {
  try {
    const res = await fetch('/api/roms', { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

// Download a ROM binary from backend
export async function downloadBackendRom(id: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(`/api/roms/${id}/download`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

// Upload a single or multiple files to backend
export async function uploadRomsToBackend(files: File[]): Promise<{
  message: string;
  results: Array<{ id: string; name: string; success: boolean; supabaseSynced: boolean; error?: string }>;
  roms: BackendRom[];
}> {
  const formData = new FormData();
  files.forEach((file) => formData.append('roms', file));

  const res = await fetch('/api/roms/upload', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Falha ao enviar ROMs para o servidor');
  }

  return await res.json();
}

// Delete a ROM from backend & Supabase
export async function deleteBackendRom(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/roms/${id}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}

// Configure Supabase credentials
export async function saveSupabaseConfig(url: string, key: string): Promise<{
  success: boolean;
  message: string;
  tableNotice?: string;
  error?: string;
}> {
  const res = await fetch('/api/supabase/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, key }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Erro ao configurar Supabase');
  }

  return data;
}

// Sync all local ROMs to Supabase
export async function syncAllToSupabase(): Promise<{
  success: boolean;
  total: number;
  syncedCount: number;
  errors: string[];
}> {
  const res = await fetch('/api/supabase/sync-all', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Erro ao sincronizar com Supabase');
  }
  return data;
}

// Pull all ROMs from Supabase
export async function pullAllFromSupabase(): Promise<{
  success: boolean;
  imported: number;
  total: number;
}> {
  const res = await fetch('/api/supabase/pull-all', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Erro ao importar do Supabase');
  }
  return data;
}

// Flush pending offline queue to backend/Supabase
export async function flushOfflineSyncQueue(): Promise<number> {
  const queue = await getSyncQueue();
  if (queue.length === 0) return 0;

  let synced = 0;
  for (const item of queue) {
    try {
      const res = await fetch('/api/roms/upload-json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });

      if (res.ok) {
        await removeFromSyncQueue(item.id);
        synced++;
      }
    } catch (e) {
      console.warn('Sync queue item failed, will retry next time:', e);
      break; // stop until connection improves
    }
  }

  return synced;
}
