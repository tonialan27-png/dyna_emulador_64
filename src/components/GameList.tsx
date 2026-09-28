import React, { useRef } from 'react';
import { Search, FolderUp, FileUp, Trash2, Cloud, Check, HardDrive, Sparkles } from 'lucide-react';
import { GameCatalogItem } from '../services/gamesCatalog';
import { OfflineRomMeta } from '../services/db';

export interface GameListItem {
  id: string | number;
  gameNumber?: number;
  name: string;
  size: string;
  isAvailableOffline: boolean;
  isSupabaseSynced: boolean;
  isCustom?: boolean;
}

interface GameListProps {
  games: GameListItem[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  activeGameId: string | number | null;
  onSelectGame: (item: GameListItem) => void;
  onUploadFiles: (files: File[]) => void;
  onDeleteGame: (id: string | number, name: string) => void;
  onClearAll: () => void;
  isOnline: boolean;
  supabaseConnected: boolean;
  onOpenSupabaseModal: () => void;
}

export const GameList: React.FC<GameListProps> = ({
  games,
  searchQuery,
  onSearchChange,
  activeGameId,
  onSelectGame,
  onUploadFiles,
  onDeleteGame,
  onClearAll,
  isOnline,
  supabaseConnected,
  onOpenSupabaseModal,
}) => {
  const multiInputRef = useRef<HTMLInputElement>(null);
  const singleInputRef = useRef<HTMLInputElement>(null);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length > 0) {
      onUploadFiles(files);
    }
  };

  const offlineCount = games.filter((g) => g.isAvailableOffline).length;

  return (
    <div className="w-full md:w-80 h-full flex flex-col bg-neutral-900 border-r border-neutral-800 text-white shrink-0">
      {/* Top Search & Upload buttons */}
      <div className="p-3 border-b border-neutral-800 space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-neutral-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar entre os 64 jogos..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-neutral-950 border border-neutral-700 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-red-500"
          />
        </div>

        <div className="flex gap-1.5">
          <button
            onClick={() => multiInputRef.current?.click()}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-bold text-white transition shadow"
          >
            <FolderUp className="w-3.5 h-3.5" />
            <span>Carregar ROMs</span>
          </button>
          <input
            ref={multiInputRef}
            type="file"
            accept=".nes,.NES"
            multiple
            onChange={handleFileInputChange}
            className="hidden"
          />

          <button
            onClick={() => singleInputRef.current?.click()}
            className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-semibold text-neutral-200 transition"
            title="Adicionar arquivo individual .nes"
          >
            <FileUp className="w-3.5 h-3.5" />
            <span>+1 ROM</span>
          </button>
          <input
            ref={singleInputRef}
            type="file"
            accept=".nes,.NES"
            onChange={handleFileInputChange}
            className="hidden"
          />
        </div>

        {/* Supabase status badge */}
        <button
          onClick={onOpenSupabaseModal}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md bg-neutral-950 border border-neutral-800 hover:border-neutral-700 text-[11px] transition text-left"
        >
          <span className="flex items-center gap-1.5">
            <Cloud className={`w-3.5 h-3.5 ${supabaseConnected ? 'text-emerald-400' : 'text-neutral-400'}`} />
            <span className="text-neutral-300">Supabase Cloud:</span>
          </span>
          <span className={`font-semibold ${supabaseConnected ? 'text-emerald-400' : 'text-amber-400'}`}>
            {supabaseConnected ? 'Conectado ✓' : 'Configurar'}
          </span>
        </button>
      </div>

      {/* Game list scrollable area */}
      <div className="flex-1 overflow-y-auto divide-y divide-neutral-800/60 custom-scrollbar">
        {games.length === 0 ? (
          <div className="p-4 text-center text-xs text-neutral-500">
            Nenhum jogo encontrado com esse nome.
          </div>
        ) : (
          games.map((game) => {
            const isActive = activeGameId === game.id;
            return (
              <div
                key={String(game.id)}
                onClick={() => onSelectGame(game)}
                className={`group flex items-center justify-between px-3 py-2 text-xs cursor-pointer transition select-none ${
                  isActive
                    ? 'bg-red-600 text-white font-medium shadow-inner'
                    : 'hover:bg-neutral-800 text-neutral-200'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {/* Status Indicator */}
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 transition ${
                      game.isAvailableOffline
                        ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]'
                        : 'bg-neutral-600'
                    }`}
                    title={game.isAvailableOffline ? 'Pronto para jogar offline' : 'Aguardando ROM'}
                  />

                  {/* Game Number & Title */}
                  <div className="truncate">
                    {game.gameNumber && (
                      <span className={`mr-1 font-mono text-[10px] ${isActive ? 'text-red-200' : 'text-neutral-500'}`}>
                        {String(game.gameNumber).padStart(2, '0')}.
                      </span>
                    )}
                    <span className="truncate">{game.name}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  {/* Supabase synced cloud icon */}
                  {game.isSupabaseSynced && (
                    <span title="Sincronizado no Supabase">
                      <Cloud className={`w-3 h-3 ${isActive ? 'text-white' : 'text-emerald-400'}`} />
                    </span>
                  )}

                  {/* Size info */}
                  <span className={`text-[10px] ${isActive ? 'text-red-100' : 'text-neutral-500'}`}>
                    {game.size}
                  </span>

                  {/* Delete custom ROM if offline */}
                  {game.isAvailableOffline && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteGame(game.id, game.name);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-300 text-neutral-400 transition"
                      title="Excluir ROM"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Info */}
      <div className="p-2.5 border-t border-neutral-800 bg-neutral-950 flex items-center justify-between text-[11px] text-neutral-400">
        <div className="flex items-center gap-1.5">
          <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
          <span>{offlineCount} ROM(s) salvas no PWA</span>
        </div>
        {offlineCount > 0 && (
          <button
            onClick={onClearAll}
            className="text-neutral-500 hover:text-red-400 text-[10px] transition underline"
          >
            Limpar tudo
          </button>
        )}
      </div>
    </div>
  );
};
