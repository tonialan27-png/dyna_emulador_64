import express, { Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import dotenv from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.resolve('data');
const ROMS_DIR = path.join(DATA_DIR, 'roms');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SUPABASE_CONFIG_FILE = path.join(DATA_DIR, 'supabase_config.json');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ROMS_DIR)) fs.mkdirSync(ROMS_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify([]));

// Interfaces
interface RomMetadata {
  id: string;
  name: string;
  filename: string;
  size: number;
  uploadedAt: string;
  supabaseSynced: boolean;
  gameNumber?: number;
}

interface SupabaseConfig {
  url: string;
  key: string;
}

// Memory database helpers
function getLocalRoms(): RomMetadata[] {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveLocalRoms(roms: RomMetadata[]) {
  fs.writeFileSync(DB_FILE, JSON.stringify(roms, null, 2), 'utf-8');
}

// Supabase configuration helper
function getStoredSupabaseConfig(): SupabaseConfig {
  if (fs.existsSync(SUPABASE_CONFIG_FILE)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(SUPABASE_CONFIG_FILE, 'utf-8'));
      if (cfg.url && cfg.key) return cfg;
    } catch {
      // ignore
    }
  }

  return {
    url: process.env.SUPABASE_URL || '',
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '',
  };
}

function getSupabaseClient(): { client: SupabaseClient | null; url: string; isConfigured: boolean } {
  const config = getStoredSupabaseConfig();
  if (config.url && config.key && config.url.startsWith('http')) {
    try {
      const client = createClient(config.url, config.key, {
        auth: { persistSession: false },
      });
      return { client, url: config.url, isConfigured: true };
    } catch (e) {
      console.error('Failed to initialize Supabase client:', e);
    }
  }
  return { client: null, url: config.url, isConfigured: false };
}

// Check iNES header
function isValidNes(buffer: Buffer): boolean {
  if (buffer.length < 16) return false;
  return (
    buffer[0] === 0x4e && // N
    buffer[1] === 0x45 && // E
    buffer[2] === 0x53 && // S
    buffer[3] === 0x1a
  );
}

// Middlewares
app.use(cors());
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024 }, // 40MB limit
});

// Sync a single ROM buffer and metadata to Supabase
async function syncRomToSupabase(
  rom: RomMetadata,
  buffer: Buffer
): Promise<{ success: boolean; error?: string }> {
  const { client, isConfigured } = getSupabaseClient();
  if (!client || !isConfigured) {
    return { success: false, error: 'Supabase não está configurado.' };
  }

  try {
    const dataBase64 = buffer.toString('base64');
    const { error } = await client.from('roms').upsert(
      {
        id: rom.id,
        name: rom.name,
        filename: rom.filename,
        size: rom.size,
        data_base64: dataBase64,
        created_at: rom.uploadedAt,
      },
      { onConflict: 'id' }
    );

    if (error) {
      console.warn(`Supabase upsert warning for ${rom.name}:`, error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Supabase error syncing ${rom.name}:`, message);
    return { success: false, error: message };
  }
}

// Delete ROM from Supabase
async function deleteRomFromSupabase(id: string): Promise<boolean> {
  const { client, isConfigured } = getSupabaseClient();
  if (!client || !isConfigured) return false;

  try {
    const { error } = await client.from('roms').delete().eq('id', id);
    if (error) {
      console.warn(`Supabase delete error for ${id}:`, error.message);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/* ============================================================
   API ROUTES
   ============================================================ */

// Status / Health
app.get('/api/status', async (req: Request, res: Response) => {
  const roms = getLocalRoms();
  const { isConfigured, url, client } = getSupabaseClient();

  let supabaseConnected = false;
  let supabaseMessage = '';

  if (isConfigured && client) {
    try {
      const { data, error } = await client.from('roms').select('id').limit(1);
      if (error) {
        supabaseMessage = error.message;
      } else {
        supabaseConnected = true;
      }
    } catch (e: unknown) {
      supabaseMessage = e instanceof Error ? e.message : 'Falha na conexão com Supabase';
    }
  }

  res.json({
    status: 'online',
    totalRoms: roms.length,
    supabase: {
      isConfigured,
      url: url ? url.replace(/(https?:\/\/)(.*)/, '$1***') : '',
      connected: supabaseConnected,
      message: supabaseMessage,
    },
  });
});

// Configure Supabase credentials
app.post('/api/supabase/config', async (req: Request, res: Response) => {
  const { url, key } = req.body;

  if (!url || !key) {
    res.status(400).json({ error: 'URL e Chave (Anon ou Service Role) são obrigatórias.' });
    return;
  }

  try {
    const testClient = createClient(url, key, { auth: { persistSession: false } });
    const { error } = await testClient.from('roms').select('id').limit(1);

    // Save configuration
    fs.writeFileSync(
      SUPABASE_CONFIG_FILE,
      JSON.stringify({ url: url.trim(), key: key.trim() }, null, 2)
    );

    let tableNotice = '';
    if (error && error.code === '42P01') {
      tableNotice =
        'Conexão OK, mas a tabela "roms" não existe no Supabase. Crie-a no SQL Editor do Supabase.';
    }

    res.json({
      success: true,
      message: 'Configuração do Supabase salva com sucesso!',
      tableNotice,
      error: error && error.code !== '42P01' ? error.message : null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao conectar ao Supabase';
    res.status(400).json({ error: message });
  }
});

// List all ROMs
app.get('/api/roms', (req: Request, res: Response) => {
  const roms = getLocalRoms();
  res.json(roms);
});

// Download a ROM binary
app.get('/api/roms/:id/download', async (req: Request, res: Response) => {
  const { id } = req.params;
  const filePath = path.join(ROMS_DIR, `${id}.nes`);

  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${id}.nes"`);
    res.sendFile(filePath);
    return;
  }

  // Fallback: check if stored in Supabase
  const { client, isConfigured } = getSupabaseClient();
  if (client && isConfigured) {
    try {
      const { data, error } = await client
        .from('roms')
        .select('name, filename, data_base64')
        .eq('id', id)
        .single();

      if (data && data.data_base64) {
        const buffer = Buffer.from(data.data_base64, 'base64');
        fs.writeFileSync(filePath, buffer); // cache locally
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${data.filename || id}.nes"`);
        res.send(buffer);
        return;
      }
    } catch (e) {
      console.error('Error fetching ROM from Supabase:', e);
    }
  }

  res.status(404).json({ error: 'ROM não encontrada no servidor.' });
});

// Upload ROMs (Multipart/form-data)
app.post('/api/roms/upload', upload.array('roms', 50), async (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    return;
  }

  const roms = getLocalRoms();
  const results: Array<{ id: string; name: string; success: boolean; supabaseSynced: boolean; error?: string }> = [];

  for (const file of files) {
    if (!isValidNes(file.buffer)) {
      results.push({
        id: '',
        name: file.originalname,
        success: false,
        supabaseSynced: false,
        error: 'Arquivo não possui cabeçalho válido de NES (iNES).',
      });
      continue;
    }

    const cleanName = file.originalname.replace(/\.nes$/i, '').trim();
    const id = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + Date.now().toString(36);
    const filePath = path.join(ROMS_DIR, `${id}.nes`);

    // Write file locally
    fs.writeFileSync(filePath, file.buffer);

    const romMetadata: RomMetadata = {
      id,
      name: cleanName,
      filename: file.originalname,
      size: file.buffer.length,
      uploadedAt: new Date().toISOString(),
      supabaseSynced: false,
    };

    // Attempt Supabase sync
    const supabaseRes = await syncRomToSupabase(romMetadata, file.buffer);
    romMetadata.supabaseSynced = supabaseRes.success;

    // Remove old matching if needed, or add new
    const existingIdx = roms.findIndex((r) => r.name.toLowerCase() === cleanName.toLowerCase());
    if (existingIdx >= 0) {
      // replace
      roms[existingIdx] = romMetadata;
    } else {
      roms.push(romMetadata);
    }

    results.push({
      id,
      name: cleanName,
      success: true,
      supabaseSynced: supabaseRes.success,
      error: supabaseRes.error,
    });
  }

  saveLocalRoms(roms);

  res.json({
    message: `${results.filter((r) => r.success).length} ROM(s) processada(s) com sucesso.`,
    results,
    roms: getLocalRoms(),
  });
});

// Upload via JSON (Base64) - ideal for client IndexedDB offline queue sync!
app.post('/api/roms/upload-json', async (req: Request, res: Response) => {
  const { name, filename, dataBase64, gameNumber } = req.body;

  if (!dataBase64) {
    res.status(400).json({ error: 'dataBase64 é obrigatório.' });
    return;
  }

  try {
    const buffer = Buffer.from(dataBase64, 'base64');
    if (!isValidNes(buffer)) {
      res.status(400).json({ error: 'Arquivo não possui cabeçalho iNES válido.' });
      return;
    }

    const cleanName = (name || filename || 'nes_rom').replace(/\.nes$/i, '').trim();
    const id = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + Date.now().toString(36);
    const filePath = path.join(ROMS_DIR, `${id}.nes`);

    fs.writeFileSync(filePath, buffer);

    const romMetadata: RomMetadata = {
      id,
      name: cleanName,
      filename: filename || `${cleanName}.nes`,
      size: buffer.length,
      uploadedAt: new Date().toISOString(),
      supabaseSynced: false,
      gameNumber,
    };

    // Attempt Supabase sync
    const supabaseRes = await syncRomToSupabase(romMetadata, buffer);
    romMetadata.supabaseSynced = supabaseRes.success;

    const roms = getLocalRoms();
    const existingIdx = roms.findIndex((r) => r.name.toLowerCase() === cleanName.toLowerCase());
    if (existingIdx >= 0) {
      roms[existingIdx] = romMetadata;
    } else {
      roms.push(romMetadata);
    }
    saveLocalRoms(roms);

    res.json({
      success: true,
      rom: romMetadata,
      supabaseSynced: supabaseRes.success,
      supabaseError: supabaseRes.error,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao processar upload JSON';
    res.status(500).json({ error: message });
  }
});

// Delete a ROM
app.delete('/api/roms/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const filePath = path.join(ROMS_DIR, `${id}.nes`);

  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.error('Failed to unlink local file:', e);
    }
  }

  let roms = getLocalRoms();
  roms = roms.filter((r) => r.id !== id);
  saveLocalRoms(roms);

  // Also remove from Supabase
  await deleteRomFromSupabase(id);

  res.json({ success: true, message: 'ROM excluída com sucesso.' });
});

// Sync all local ROMs to Supabase on demand
app.post('/api/supabase/sync-all', async (req: Request, res: Response) => {
  const roms = getLocalRoms();
  const { client, isConfigured } = getSupabaseClient();

  if (!client || !isConfigured) {
    res.status(400).json({ error: 'Supabase não está configurado.' });
    return;
  }

  let syncedCount = 0;
  const errors: string[] = [];

  for (const rom of roms) {
    const filePath = path.join(ROMS_DIR, `${rom.id}.nes`);
    if (!fs.existsSync(filePath)) continue;

    const buffer = fs.readFileSync(filePath);
    const syncRes = await syncRomToSupabase(rom, buffer);

    if (syncRes.success) {
      rom.supabaseSynced = true;
      syncedCount++;
    } else if (syncRes.error) {
      errors.push(`${rom.name}: ${syncRes.error}`);
    }
  }

  saveLocalRoms(roms);

  res.json({
    success: true,
    total: roms.length,
    syncedCount,
    errors: errors.slice(0, 5),
  });
});

// Pull ROMs from Supabase to local server
app.post('/api/supabase/pull-all', async (req: Request, res: Response) => {
  const { client, isConfigured } = getSupabaseClient();

  if (!client || !isConfigured) {
    res.status(400).json({ error: 'Supabase não está configurado.' });
    return;
  }

  try {
    const { data, error } = await client
      .from('roms')
      .select('id, name, filename, size, data_base64, created_at');

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    if (!data || data.length === 0) {
      res.json({ message: 'Nenhuma ROM encontrada no Supabase.', imported: 0 });
      return;
    }

    const localRoms = getLocalRoms();
    let imported = 0;

    for (const remote of data) {
      if (!remote.data_base64) continue;
      const buffer = Buffer.from(remote.data_base64, 'base64');
      const filePath = path.join(ROMS_DIR, `${remote.id}.nes`);

      fs.writeFileSync(filePath, buffer);

      const metadata: RomMetadata = {
        id: remote.id,
        name: remote.name,
        filename: remote.filename || `${remote.name}.nes`,
        size: remote.size || buffer.length,
        uploadedAt: remote.created_at || new Date().toISOString(),
        supabaseSynced: true,
      };

      const idx = localRoms.findIndex((r) => r.id === remote.id);
      if (idx >= 0) {
        localRoms[idx] = metadata;
      } else {
        localRoms.push(metadata);
      }
      imported++;
    }

    saveLocalRoms(localRoms);
    res.json({ success: true, imported, total: localRoms.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao importar do Supabase';
    res.status(500).json({ error: message });
  }
});

/* ============================================================
   VITE DEV MIDDLEWARE / STATIC FILES
   ============================================================ */
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve('dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`🎮 Dyna Radical 64 NES Server running on http://localhost:${PORT}`);
  });
}

startServer();
