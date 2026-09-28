import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Header } from './components/Header';
import { GameList, GameListItem } from './components/GameList';
import { EmulatorScreen } from './components/EmulatorScreen';
import { SupabaseModal } from './components/SupabaseModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import {
  CLASSIC_64_GAMES,
  normalizeName,
  findMatchingClassicGame,
} from './services/gamesCatalog';
import {
  saveRomOffline,
  getRomOffline,
  getAllOfflineRoms,
  deleteRomOffline,
  clearAllOffline,
  queueForSync,
  OfflineRomMeta,
} from './services/db';
import {
  getBackendStatus,
  fetchBackendRoms,
  downloadBackendRom,
  uploadRomsToBackend,
  deleteBackendRom,
  flushOfflineSyncQueue,
  BackendStatus,
} from './services/api';

function isValidNesBuffer(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 16) return false;
  const h = new Uint8Array(buffer.slice(0, 4));
  return h[0] === 0x4e && h[1] === 0x45 && h[2] === 0x53 && h[3] === 0x1a;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const CHUNK = 8192;
  for (let i = 0; i < len; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

export default function App() {
  const isOnline = useOnlineStatus();

  // Status & notifications
  const [statusMessage, setStatusMessage] = useState(
    'Arraste os arquivos .nes aqui ou use "Carregar ROMs"'
  );
  const [isErrorMessage, setIsErrorMessage] = useState(false);

  // Backend & Supabase status
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [isSupabaseModalOpen, setIsSupabaseModalOpen] = useState(false);

  // ROM data
  const [offlineRoms, setOfflineRoms] = useState<OfflineRomMeta[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeGameId, setActiveGameId] = useState<string | number | null>(null);
  const [currentLoadedRom, setCurrentLoadedRom] = useState<{
    id: string | number;
    name: string;
    buffer: ArrayBuffer;
  } | null>(null);

  const notify = useCallback((msg: string, isError = false) => {
    setStatusMessage(msg);
    setIsErrorMessage(isError);
  }, []);

  // Refresh backend status
  const refreshBackendStatus = useCallback(async () => {
    if (!navigator.onLine) return;
    const status = await getBackendStatus();
    setBackendStatus(status);
  }, []);

  // Refresh offline ROMs list from IndexedDB
  const refreshOfflineRoms = useCallback(async () => {
    const list = await getAllOfflineRoms();
    setOfflineRoms(list);
  }, []);

  // Initial load
  useEffect(() => {
    refreshOfflineRoms();
    refreshBackendStatus();
  }, [refreshOfflineRoms, refreshBackendStatus]);

  // Sync background queue when internet is available
  useEffect(() => {
    if (isOnline) {
      flushOfflineSyncQueue().then((synced) => {
        if (synced > 0) {
          notify(`${synced} ROM(s) pendentes foram sincronizadas com o servidor!`);
          refreshBackendStatus();
          refreshOfflineRoms();
        }
      });
      refreshBackendStatus();
    }
  }, [isOnline, notify, refreshBackendStatus, refreshOfflineRoms]);

  // Assemble full game list (64 Classic Games + Custom ROMs)
  const fullGameList = useMemo<GameListItem[]>(() => {
    const offlineMap = new Map<string, OfflineRomMeta>();
    offlineRoms.forEach((r) => {
      offlineMap.set(String(r.id), r);
    });

    // 1. Classic 64 games
    const classicList: GameListItem[] = CLASSIC_64_GAMES.map((cg) => {
      const offline = offlineMap.get(String(cg.n));
      return {
        id: cg.n,
        gameNumber: cg.n,
        name: cg.name,
        size: cg.size,
        isAvailableOffline: !!offline,
        isSupabaseSynced: offline?.supabaseSynced || false,
        isCustom: false,
      };
    });

    // 2. Custom ROMs (not matching 1-64 classic numbers)
    const customList: GameListItem[] = [];
    offlineRoms.forEach((r) => {
      const isClassic = typeof r.id === 'number' && r.id >= 1 && r.id <= 64;
      if (!isClassic) {
        customList.push({
          id: r.id,
          name: r.name,
          size: Math.max(1, Math.round(r.size / 1024)) + ' KB',
          isAvailableOffline: true,
          isSupabaseSynced: r.supabaseSynced,
          isCustom: true,
        });
      }
    });

    const combined = [...classicList, ...customList];

    if (!searchQuery.trim()) return combined;

    const q = searchQuery.toLowerCase().trim();
    return combined.filter(
      (g) => g.name.toLowerCase().includes(q) || String(g.gameNumber || '').includes(q)
    );
  }, [offlineRoms, searchQuery]);

  // Handle uploading files (multiple or single)
  const handleUploadFiles = useCallback(
    async (files: File[]) => {
      let savedCount = 0;
      const invalidFiles: string[] = [];
      let lastUploadedRom: { id: string | number; name: string; buffer: ArrayBuffer } | null = null;

      notify('Processando ROMs e salvando offline...');

      for (const file of files) {
        try {
          const buffer = await file.arrayBuffer();

          if (!isValidNesBuffer(buffer)) {
            invalidFiles.push(file.name);
            continue;
          }

          // Match with classic catalog or register as custom
          const match = findMatchingClassicGame(file.name);
          const id = match ? match.n : normalizeName(file.name) + '_' + Date.now().toString(36);
          const name = match ? match.name : file.name.replace(/\.nes$/i, '').trim();

          const meta: OfflineRomMeta = {
            id: String(id),
            name,
            filename: file.name,
            size: buffer.byteLength,
            gameNumber: match ? match.n : undefined,
            uploadedAt: new Date().toISOString(),
            supabaseSynced: false,
            isCustom: !match,
          };

          // 1. Immediately save to IndexedDB (available offline permanently!)
          await saveRomOffline(id, buffer, meta);
          savedCount++;
          lastUploadedRom = { id, name, buffer };

          // 2. Attempt backend and Supabase sync
          if (navigator.onLine) {
            try {
              const uploadRes = await uploadRomsToBackend([file]);
              if (uploadRes.results && uploadRes.results[0]?.supabaseSynced) {
                meta.supabaseSynced = true;
                await saveRomOffline(id, buffer, meta);
              }
            } catch (backendErr) {
              console.warn('Backend sync failed, queued for later:', backendErr);
              // Queue in IndexedDB for background sync
              await queueForSync({
                id: String(id),
                name,
                filename: file.name,
                dataBase64: arrayBufferToBase64(buffer),
                gameNumber: match ? match.n : undefined,
                timestamp: Date.now(),
              });
            }
          } else {
            // Queue for sync when online
            await queueForSync({
              id: String(id),
              name,
              filename: file.name,
              dataBase64: arrayBufferToBase64(buffer),
              gameNumber: match ? match.n : undefined,
              timestamp: Date.now(),
            });
          }
        } catch (err) {
          console.error(`Error loading ${file.name}:`, err);
          invalidFiles.push(file.name);
        }
      }

      await refreshOfflineRoms();
      await refreshBackendStatus();

      let msg = `${savedCount} ROM(s) salvas no dispositivo e prontas para jogar offline!`;
      if (backendStatus?.supabase?.connected) {
        msg += ' (Sincronizado no Supabase)';
      }
      if (invalidFiles.length > 0) {
        msg += ` (${invalidFiles.length} arquivos inválidos ignorados)`;
      }

      notify(msg, invalidFiles.length > 0);

      // Auto start last uploaded ROM
      if (lastUploadedRom) {
        setActiveGameId(lastUploadedRom.id);
        setCurrentLoadedRom(lastUploadedRom);
      }
    },
    [backendStatus, notify, refreshBackendStatus, refreshOfflineRoms]
  );

  // Handle selecting a game to play
  const handleSelectGame = useCallback(
    async (item: GameListItem) => {
      setActiveGameId(item.id);

      // 1. Check if present in local IndexedDB
      try {
        let buffer = await getRomOffline(item.id);

        if (!buffer && typeof item.id === 'string') {
          buffer = await getRomOffline(item.id);
        }

        if (buffer) {
          notify(`Carregando ${item.name} da memória offline...`);
          setCurrentLoadedRom({
            id: item.id,
            name: item.name,
            buffer,
          });
          return;
        }

        // 2. If online and not in IndexedDB, attempt to download from backend/Supabase
        if (navigator.onLine && typeof item.id === 'string') {
          notify(`Baixando ${item.name} do Supabase / Servidor...`);
          const downloaded = await downloadBackendRom(item.id);
          if (downloaded) {
            // Cache in IndexedDB for future offline play
            const meta: OfflineRomMeta = {
              id: String(item.id),
              name: item.name,
              filename: `${item.name}.nes`,
              size: downloaded.byteLength,
              uploadedAt: new Date().toISOString(),
              supabaseSynced: true,
              isCustom: item.isCustom,
            };
            await saveRomOffline(item.id, downloaded, meta);
            await refreshOfflineRoms();

            setCurrentLoadedRom({
              id: item.id,
              name: item.name,
              buffer: downloaded,
            });
            notify(`Rodando: ${item.name}`);
            return;
          }
        }

        notify(
          `A ROM "${item.name}" ainda não foi carregada. Clique em "Carregar ROMs" ou arraste o arquivo .nes para cá.`,
          true
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Erro ao abrir ROM';
        notify(`Erro: ${msg}`, true);
      }
    },
    [notify, refreshOfflineRoms]
  );

  // Delete a game
  const handleDeleteGame = useCallback(
    async (id: string | number, name: string) => {
      if (!confirm(`Remover "${name}" do dispositivo e nuvem?`)) return;

      await deleteRomOffline(id);
      if (typeof id === 'string') {
        await deleteBackendRom(id);
      }

      await refreshOfflineRoms();
      await refreshBackendStatus();

      if (activeGameId === id) {
        setCurrentLoadedRom(null);
        setActiveGameId(null);
      }

      notify(`ROM "${name}" excluída.`);
    },
    [activeGameId, notify, refreshBackendStatus, refreshOfflineRoms]
  );

  // Clear all ROMs
  const handleClearAll = useCallback(async () => {
    if (!confirm('Deseja realmente apagar TODAS as ROMs salvas no dispositivo?')) return;
    await clearAllOffline();
    await refreshOfflineRoms();
    setCurrentLoadedRom(null);
    setActiveGameId(null);
    notify('Todas as ROMs salvas localmente foram removidas.');
  }, [notify, refreshOfflineRoms]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#111116] text-white">
      {/* Top Header */}
      <Header
        statusMessage={statusMessage}
        isErrorMessage={isErrorMessage}
        backendStatus={backendStatus}
        isOnline={isOnline}
        onOpenSupabaseModal={() => setIsSupabaseModalOpen(true)}
      />

      {/* Main Content Area */}
      <div className="flex flex-1 min-h-0 flex-col md:flex-row overflow-hidden relative">
        {/* Game List Sidebar */}
        <GameList
          games={fullGameList}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          activeGameId={activeGameId}
          onSelectGame={handleSelectGame}
          onUploadFiles={handleUploadFiles}
          onDeleteGame={handleDeleteGame}
          onClearAll={handleClearAll}
          isOnline={isOnline}
          supabaseConnected={!!backendStatus?.supabase?.connected}
          onOpenSupabaseModal={() => setIsSupabaseModalOpen(true)}
        />

        {/* Emulator Main Screen */}
        <EmulatorScreen
          currentRom={currentLoadedRom}
          onStatusChange={notify}
          onDropFiles={handleUploadFiles}
        />
      </div>

      {/* Offline Toast Indicator */}
      <OfflineIndicator />

      {/* Supabase Connection Modal */}
      <SupabaseModal
        isOpen={isSupabaseModalOpen}
        onClose={() => setIsSupabaseModalOpen(false)}
        status={backendStatus}
        onRefreshStatus={refreshBackendStatus}
        onNotify={notify}
      />
    </div>
  );
}
