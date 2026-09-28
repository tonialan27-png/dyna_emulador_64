import React from 'react';
import { Gamepad2, Cloud, Database, Wifi, WifiOff } from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';
import { BackendStatus } from '../services/api';

interface HeaderProps {
  statusMessage: string;
  isErrorMessage?: boolean;
  backendStatus: BackendStatus | null;
  isOnline: boolean;
  onOpenSupabaseModal: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  statusMessage,
  isErrorMessage,
  backendStatus,
  isOnline,
  onOpenSupabaseModal,
}) => {
  const isSupabaseConnected = backendStatus?.supabase?.connected;

  return (
    <header className="bg-gradient-to-r from-red-800 via-red-600 to-red-700 text-white px-3 py-2 flex flex-wrap items-center justify-between gap-2 shadow-md z-30 select-none">
      {/* Brand & Title */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-md bg-neutral-900/40 flex items-center justify-center border border-white/20 shadow-inner">
          <Gamepad2 className="w-4 h-4 text-white" />
        </div>
        <div>
          <h1 className="text-xs sm:text-sm font-black tracking-wider uppercase drop-shadow flex items-center gap-1.5">
            DYNA RADICAL 64
            <span className="hidden sm:inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-black/40 border border-white/20">
              NES PWA
            </span>
          </h1>
        </div>
      </div>

      {/* Center dynamic status message */}
      <div className="order-last sm:order-none w-full sm:w-auto text-center">
        <span
          className={`text-[11px] sm:text-xs font-medium px-2 py-0.5 rounded-full inline-block truncate max-w-xs md:max-w-md ${
            isErrorMessage
              ? 'bg-black/60 text-red-200 border border-red-400'
              : 'bg-black/30 text-neutral-100'
          }`}
        >
          {statusMessage || 'Pronto. Selecione uma ROM para iniciar.'}
        </span>
      </div>

      {/* Right Controls: Online status + Supabase button + PWA install */}
      <div className="flex items-center gap-1.5">
        {/* Online / Offline badge */}
        <div
          className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold ${
            isOnline ? 'bg-black/30 text-emerald-200' : 'bg-amber-900/60 text-amber-200'
          }`}
          title={isOnline ? 'Conectado à Internet' : 'Sem conexão (Modo Offline PWA)'}
        >
          {isOnline ? <Wifi className="w-3 h-3 text-emerald-300" /> : <WifiOff className="w-3 h-3 text-amber-300" />}
          <span className="hidden md:inline">{isOnline ? 'Online' : 'Offline'}</span>
        </div>

        {/* Supabase Button */}
        <button
          onClick={onOpenSupabaseModal}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition border ${
            isSupabaseConnected
              ? 'bg-emerald-950/60 border-emerald-400/40 text-emerald-200 hover:bg-emerald-900/70'
              : 'bg-black/40 border-white/20 text-white hover:bg-black/60'
          }`}
          title="Configuração do Banco de Dados Supabase"
        >
          <Database className={`w-3.5 h-3.5 ${isSupabaseConnected ? 'text-emerald-400' : 'text-neutral-300'}`} />
          <span className="hidden sm:inline">Supabase</span>
        </button>

        {/* In-App PWA Install Button */}
        <PWAInstallButton />
      </div>
    </header>
  );
};
