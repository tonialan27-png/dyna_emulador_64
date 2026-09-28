import React from 'react';
import { WifiOff, Cloud } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur-sm animate-pulse border border-amber-400/40">
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>Modo Offline — Você pode continuar jogando as ROMs salvas no dispositivo!</span>
    </div>
  );
};
