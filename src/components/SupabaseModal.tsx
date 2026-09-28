import React, { useState } from 'react';
import { Database, CheckCircle2, AlertTriangle, Cloud, Copy, Check, RefreshCw, X, DownloadCloud } from 'lucide-react';
import { saveSupabaseConfig, syncAllToSupabase, pullAllFromSupabase, BackendStatus } from '../services/api';

interface SupabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: BackendStatus | null;
  onRefreshStatus: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

export const SupabaseModal: React.FC<SupabaseModalProps> = ({
  isOpen,
  onClose,
  status,
  onRefreshStatus,
  onNotify,
}) => {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!isOpen) return null;

  const sqlSchema = `-- Crie a tabela de ROMs no SQL Editor do Supabase:
create table if not exists public.roms (
  id text primary key,
  name text not null,
  filename text not null,
  size integer not null,
  data_base64 text not null,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Ativar segurança RLS (opcional) ou permitir acesso anon
alter table public.roms enable row level security;

create policy "Permitir leitura anonima" on public.roms
  for select using (true);

create policy "Permitir upload anonimo" on public.roms
  for insert with check (true);

create policy "Permitir atualizacao anonima" on public.roms
  for update using (true);

create policy "Permitir exclusao anonima" on public.roms
  for delete using (true);
`;

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !key.trim()) {
      setFeedback('Preencha a URL e a Chave do Supabase.');
      return;
    }

    setLoading(true);
    setFeedback(null);

    try {
      const res = await saveSupabaseConfig(url.trim(), key.trim());
      setFeedback(res.tableNotice || res.message || 'Configuração salva!');
      onNotify('Supabase configurado com sucesso!');
      onRefreshStatus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao conectar ao Supabase';
      setFeedback(msg);
      onNotify(msg, true);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      const res = await syncAllToSupabase();
      onNotify(`${res.syncedCount} ROM(s) sincronizadas com sucesso no Supabase!`);
      onRefreshStatus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao sincronizar';
      onNotify(msg, true);
    } finally {
      setSyncing(false);
    }
  };

  const handlePullAll = async () => {
    setPulling(true);
    try {
      const res = await pullAllFromSupabase();
      onNotify(`${res.imported} ROM(s) baixadas do Supabase para o servidor/cache!`);
      onRefreshStatus();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao importar do Supabase';
      onNotify(msg, true);
    } finally {
      setPulling(false);
    }
  };

  const copySqlToClipboard = () => {
    navigator.clipboard.writeText(sqlSchema);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  const isConnected = status?.supabase?.connected;
  const isConfigured = status?.supabase?.isConfigured;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs">
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-900 p-6 text-white shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-neutral-100">Banco de Dados Supabase & Nuvem</h2>
              <p className="text-xs text-neutral-400">Persistência na nuvem com funcionamento offline local via PWA</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status card */}
        <div className="mt-4 p-3.5 rounded-lg border border-neutral-800 bg-neutral-950/60 flex items-start gap-3">
          {isConnected ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          ) : isConfigured ? (
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          ) : (
            <Cloud className="w-5 h-5 text-neutral-400 shrink-0 mt-0.5" />
          )}
          <div className="text-xs flex-1">
            <div className="font-semibold flex items-center gap-2">
              <span>Status:</span>
              <span className={isConnected ? 'text-emerald-400' : isConfigured ? 'text-amber-400' : 'text-neutral-400'}>
                {isConnected
                  ? 'Supabase Conectado & Operacional'
                  : isConfigured
                  ? 'Credenciais Salvas (Aguardando Tabela ou Rede)'
                  : 'Modo Local / Armazenamento no Servidor e IndexedDB'}
              </span>
            </div>
            <p className="text-neutral-400 mt-1 leading-relaxed">
              {isConnected
                ? 'Todas as novas ROMs enviadas são automaticamente salvas no seu Supabase e mantidas em cache no navegador para jogar offline.'
                : 'Você pode jogar offline normalmente! Ao configurar seu Supabase abaixo, suas ROMs ficam sincronizadas na nuvem para qualquer dispositivo.'}
            </p>
            {status?.supabase?.message && (
              <p className="text-amber-400 mt-1 font-mono text-[11px]">{status.supabase.message}</p>
            )}
          </div>
        </div>

        {/* Cloud actions if configured */}
        {isConnected && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={handleSyncAll}
              disabled={syncing}
              className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Sincronizando...' : 'Enviar ROMs p/ Supabase'}</span>
            </button>
            <button
              onClick={handlePullAll}
              disabled={pulling}
              className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-xs font-semibold text-white transition"
            >
              <DownloadCloud className={`w-3.5 h-3.5 ${pulling ? 'animate-spin' : ''}`} />
              <span>{pulling ? 'Baixando...' : 'Baixar do Supabase'}</span>
            </button>
          </div>
        )}

        {/* Configuration Form */}
        <form onSubmit={handleSaveConfig} className="mt-5 space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1">
              Supabase Project URL
            </label>
            <input
              type="url"
              placeholder="https://exemplo-app.supabase.co"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-neutral-950 border border-neutral-700 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1">
              Supabase Anon Key ou Service Role Key
            </label>
            <input
              type="password"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              value={key}
              onChange={(e) => setKey(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-neutral-950 border border-neutral-700 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          {feedback && (
            <div className="p-2.5 rounded-lg bg-neutral-950 border border-neutral-800 text-xs text-amber-300">
              {feedback}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white transition flex items-center justify-center gap-1.5"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Testando & Salvando...</span>
                </>
              ) : (
                <span>Testar & Salvar Configuração</span>
              )}
            </button>
          </div>
        </form>

        {/* SQL Schema Helper */}
        <div className="mt-6 pt-4 border-t border-neutral-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-neutral-300">
              Script SQL para criar a tabela no Supabase:
            </span>
            <button
              onClick={copySqlToClipboard}
              className="flex items-center gap-1 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-[11px] text-neutral-200 transition"
            >
              {copiedSql ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedSql ? 'Copiado!' : 'Copiar SQL'}</span>
            </button>
          </div>
          <pre className="p-3 rounded-lg bg-neutral-950 border border-neutral-800 text-[11px] font-mono text-neutral-400 overflow-x-auto max-h-36">
            {sqlSchema}
          </pre>
          <p className="mt-2 text-[11px] text-neutral-500">
            Dica: Cole o script acima no <strong>SQL Editor</strong> do painel do seu projeto Supabase para habilitar o armazenamento na nuvem.
          </p>
        </div>
      </div>
    </div>
  );
};
