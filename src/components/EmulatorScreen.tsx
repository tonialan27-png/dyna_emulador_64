import React, { useEffect, useRef, useState, useCallback } from 'react';
import { NES, Controller, ButtonKey } from 'jsnes';
import { Maximize, Minimize, Volume2, VolumeX, Save, FolderOpen, Gamepad2, Monitor, Tv } from 'lucide-react';
import { saveEmulatorState, loadEmulatorState } from '../services/db';

export interface EmulatorScreenProps {
  currentRom: {
    id: string | number;
    name: string;
    buffer: ArrayBuffer;
  } | null;
  onStatusChange: (status: string, isError?: boolean) => void;
  onDropFiles: (files: File[]) => void;
}

export type GfxFilter = 'sharp' | 'smooth' | 'crt';
export type GfxColor = 'orig' | 'vivid' | 'soft' | 'mono';
export type GfxAspect = 'pixel' | 'tv';

const COLOR_PRESETS: Record<GfxColor, { sat: number; con: number; bri: number } | null> = {
  orig: null,
  vivid: { sat: 1.3, con: 1.08, bri: 0 },
  soft: { sat: 0.85, con: 0.95, bri: 6 },
  mono: { sat: 0, con: 1.05, bri: 0 },
};

const SCALE = 4;
const OUT_W = 256 * SCALE;
const OUT_H = 240 * SCALE;
const FRAME_TIME = 1000 / 60.098;

export const EmulatorScreen: React.FC<EmulatorScreenProps> = ({
  currentRom,
  onStatusChange,
  onDropFiles,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Graphics state
  const [filter, setFilter] = useState<GfxFilter>('sharp');
  const [colorPreset, setColorPreset] = useState<GfxColor>('orig');
  const [aspect, setAspect] = useState<GfxAspect>('pixel');
  const [soundOn, setSoundOn] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showControlsHint, setShowControlsHint] = useState(false);

  // References for emulator and audio
  const nesRef = useRef<NES | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const ringLRef = useRef<Float32Array>(new Float32Array(65536));
  const ringRRef = useRef<Float32Array>(new Float32Array(65536));
  const writePosRef = useRef(0);
  const readPosRef = useRef(0);
  const rafIdRef = useRef<number>(0);
  const isRunningRef = useRef(false);
  const soundOnRef = useRef(soundOn);
  soundOnRef.current = soundOn;

  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const crtOverlayRef = useRef<HTMLCanvasElement | null>(null);
  const colorCacheRef = useRef<Map<number, number>>(new Map());

  // Build CRT scanlines overlay canvas
  const getCrtOverlay = useCallback(() => {
    if (crtOverlayRef.current) return crtOverlayRef.current;
    const o = document.createElement('canvas');
    o.width = OUT_W;
    o.height = OUT_H;
    const c = o.getContext('2d');
    if (!c) return null;

    // Scanlines
    for (let y = 0; y < 240; y++) {
      c.fillStyle = 'rgba(0,0,0,0.18)';
      c.fillRect(0, y * SCALE + 2, OUT_W, 1);
      c.fillStyle = 'rgba(0,0,0,0.44)';
      c.fillRect(0, y * SCALE + 3, OUT_W, 1);
    }

    // Radial vignette
    const g = c.createRadialGradient(
      OUT_W / 2,
      OUT_H / 2,
      OUT_H * 0.45,
      OUT_W / 2,
      OUT_H / 2,
      OUT_H * 0.95
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.42)');
    c.fillStyle = g;
    c.fillRect(0, 0, OUT_W, OUT_H);

    crtOverlayRef.current = o;
    return o;
  }, []);

  // Map color palette with presets
  const mapColor = useCallback(
    (c: number): number => {
      const preset = COLOR_PRESETS[colorPreset];
      if (!preset) return c;

      let v = colorCacheRef.current.get(c);
      if (v === undefined) {
        let r = (c >> 16) & 0xff;
        let g = (c >> 8) & 0xff;
        let b = c & 0xff;
        const y = 0.299 * r + 0.587 * g + 0.114 * b;
        const { sat, con, bri } = preset;

        r = y + (r - y) * sat;
        g = y + (g - y) * sat;
        b = y + (b - y) * sat;

        r = (r - 128) * con + 128 + bri;
        g = (g - 128) * con + 128 + bri;
        b = (b - 128) * con + 128 + bri;

        const clamp = (x: number) => (x < 0 ? 0 : x > 255 ? 255 : x | 0);
        v = (clamp(r) << 16) | (clamp(g) << 8) | clamp(b);
        colorCacheRef.current.set(c, v);
      }
      return v;
    },
    [colorPreset]
  );

  // Present canvas frame
  const presentFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const offscreen = offscreenCanvasRef.current;
    if (!canvas || !offscreen) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreen, 0, 0, OUT_W, OUT_H);

    if (filter === 'crt') {
      const crt = getCrtOverlay();
      if (crt) ctx.drawImage(crt, 0, 0);
    }
  }, [filter, getCrtOverlay]);

  // Audio initialization
  const initAudio = useCallback(() => {
    if (audioCtxRef.current) {
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
      return;
    }

    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC({ latencyHint: 'interactive' });
      audioCtxRef.current = ctx;

      const script = ctx.createScriptProcessor(2048, 0, 2);
      scriptNodeRef.current = script;

      const ringSize = 65536;
      script.onaudioprocess = (e) => {
        const outL = e.outputBuffer.getChannelData(0);
        const outR = e.outputBuffer.getChannelData(1);
        const len = outL.length;

        if (!soundOnRef.current) {
          outL.fill(0);
          outR.fill(0);
          return;
        }

        const rL = ringLRef.current;
        const rR = ringRRef.current;
        let rPos = readPosRef.current;
        const wPos = writePosRef.current;

        for (let i = 0; i < len; i++) {
          if (rPos !== wPos) {
            outL[i] = rL[rPos];
            outR[i] = rR[rPos];
            rPos = (rPos + 1) & (ringSize - 1);
          } else {
            outL[i] = 0;
            outR[i] = 0;
          }
        }
        readPosRef.current = rPos;
      };

      script.connect(ctx.destination);
      if (nesRef.current) {
        (nesRef.current as unknown as { opts?: { sampleRate?: number } }).opts = { sampleRate: ctx.sampleRate };
      }
    } catch (e) {
      console.warn('AudioContext not supported or blocked:', e);
    }
  }, []);

  const onAudioSample = useCallback((left: number, right: number) => {
    if (!audioCtxRef.current || !soundOnRef.current) return;
    const ringSize = 65536;
    let wPos = writePosRef.current;
    let rPos = readPosRef.current;

    ringLRef.current[wPos] = left;
    ringRRef.current[wPos] = right;
    wPos = (wPos + 1) & (ringSize - 1);

    const buffered = (wPos - rPos) & (ringSize - 1);
    if (buffered > 8192) {
      rPos = (wPos - 4096) & (ringSize - 1);
      readPosRef.current = rPos;
    }
    writePosRef.current = wPos;
  }, []);

  // Initialize Canvas structures
  useEffect(() => {
    const offscreen = document.createElement('canvas');
    offscreen.width = 256;
    offscreen.height = 240;
    offscreenCanvasRef.current = offscreen;
    const offCtx = offscreen.getContext('2d');
    if (offCtx) {
      offscreenCtxRef.current = offCtx;
      imageDataRef.current = offCtx.createImageData(256, 240);
    }
  }, []);

  // Reset color cache when preset changes
  useEffect(() => {
    colorCacheRef.current.clear();
    presentFrame();
  }, [colorPreset, presentFrame]);

  // Frame loop
  const stopLoop = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }
    isRunningRef.current = false;
  }, []);

  const startLoop = useCallback(() => {
    stopLoop();
    isRunningRef.current = true;
    let lastTime = 0;
    let accumulator = 0;

    const tick = (timestamp: number) => {
      if (!isRunningRef.current || !nesRef.current) return;

      if (document.hidden) {
        lastTime = timestamp;
        accumulator = 0;
        rafIdRef.current = requestAnimationFrame(tick);
        return;
      }

      if (!lastTime) lastTime = timestamp;
      let delta = timestamp - lastTime;
      lastTime = timestamp;
      if (delta > 100) delta = 100;
      accumulator += delta;

      let steps = 0;
      while (accumulator >= FRAME_TIME && steps < 3) {
        nesRef.current.frame();
        accumulator -= FRAME_TIME;
        steps++;
      }

      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);
  }, [stopLoop]);

  // Load ROM whenever currentRom changes
  useEffect(() => {
    if (!currentRom || !currentRom.buffer) return;

    try {
      initAudio();
      stopLoop();

      // Create NES instance if needed
      const nes = new NES({
        onFrame: (frameBuffer: Uint32Array) => {
          const imgData = imageDataRef.current;
          const offCtx = offscreenCtxRef.current;
          if (!imgData || !offCtx) return;

          const data = imgData.data;
          const len = frameBuffer.length;
          for (let i = 0; i < len; i++) {
            const c = mapColor(frameBuffer[i]);
            const o = i << 2;
            data[o] = (c >> 16) & 0xff;
            data[o + 1] = (c >> 8) & 0xff;
            data[o + 2] = c & 0xff;
            data[o + 3] = 255;
          }
          offCtx.putImageData(imgData, 0, 0);
          presentFrame();
        },
        onAudioSample: onAudioSample,
        sampleRate: audioCtxRef.current ? audioCtxRef.current.sampleRate : 44100,
      });

      nesRef.current = nes;

      // Pass Uint8Array directly
      nes.loadROM(new Uint8Array(currentRom.buffer));
      startLoop();
      onStatusChange(`Rodando: ${currentRom.name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao inicializar ROM';
      console.error(err);
      onStatusChange(`Erro na ROM: ${msg}`, true);
    }

    return () => {
      stopLoop();
    };
  }, [currentRom, initAudio, mapColor, onAudioSample, presentFrame, startLoop, stopLoop, onStatusChange]);

  // Handle Save State
  const handleSaveState = async () => {
    if (!nesRef.current || !currentRom) {
      onStatusChange('Nenhuma ROM em execução para salvar.', true);
      return;
    }
    try {
      const stateObj = nesRef.current.toJSON();
      await saveEmulatorState(currentRom.id, JSON.stringify(stateObj));
      onStatusChange('State salvo com sucesso no IndexedDB!');
    } catch {
      onStatusChange('Falha ao salvar state.', true);
    }
  };

  // Handle Load State
  const handleLoadState = async () => {
    if (!nesRef.current || !currentRom) {
      onStatusChange('Nenhuma ROM em execução.', true);
      return;
    }
    try {
      const raw = await loadEmulatorState(currentRom.id);
      if (!raw) {
        onStatusChange('Nenhum save state encontrado para este jogo.', true);
        return;
      }
      const parsed = JSON.parse(raw);
      nesRef.current.fromJSON(parsed);
      onStatusChange('State carregado com sucesso!');
    } catch {
      onStatusChange('Falha ao carregar state.', true);
    }
  };

  // Fullscreen toggle
  const toggleFullscreen = async () => {
    const el = containerRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } else {
        await el.requestFullscreen();
        setIsFullscreen(true);
      }
    } catch {
      // ignore
    }
  };

  // Keyboard mapping
  useEffect(() => {
    const keyMap: Record<string, ButtonKey> = {
      ArrowUp: Controller.BUTTON_UP as ButtonKey,
      ArrowDown: Controller.BUTTON_DOWN as ButtonKey,
      ArrowLeft: Controller.BUTTON_LEFT as ButtonKey,
      ArrowRight: Controller.BUTTON_RIGHT as ButtonKey,
      KeyZ: Controller.BUTTON_A as ButtonKey,
      KeyX: Controller.BUTTON_B as ButtonKey,
      KeyA: Controller.BUTTON_TURBO_A as ButtonKey,
      KeyS: Controller.BUTTON_TURBO_B as ButtonKey,
      Enter: Controller.BUTTON_START as ButtonKey,
      ShiftRight: Controller.BUTTON_SELECT as ButtonKey,
      ShiftLeft: Controller.BUTTON_SELECT as ButtonKey,
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when user is typing in input or textarea
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (keyMap[e.code] !== undefined && nesRef.current) {
        initAudio();
        nesRef.current.buttonDown(1, keyMap[e.code]);
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (keyMap[e.code] !== undefined && nesRef.current) {
        nesRef.current.buttonUp(1, keyMap[e.code]);
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [initAudio]);

  // Touch button handler
  const handleTouchButton = (btnCode: number, isDown: boolean) => {
    initAudio();
    if (!nesRef.current) return;
    const key = btnCode as ButtonKey;
    if (isDown) {
      nesRef.current.buttonDown(1, key);
    } else {
      nesRef.current.buttonUp(1, key);
    }
  };

  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    initAudio();
    const files = Array.from(e.dataTransfer.files).filter((f) => /\.nes$/i.test(f.name));
    if (files.length > 0) {
      onDropFiles(files);
    }
  };

  return (
    <div
      ref={containerRef}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative flex flex-col flex-1 min-w-0 min-h-0 bg-neutral-950 items-center justify-center overflow-hidden ${
        isFullscreen ? 'fixed inset-0 z-50 p-0' : ''
      }`}
    >
      {/* Canvas container */}
      <div className="relative flex items-center justify-center w-full h-full max-h-[calc(100vh-120px)] p-2">
        <canvas
          ref={canvasRef}
          width={OUT_W}
          height={OUT_H}
          className="max-h-full max-w-full rounded shadow-2xl bg-black object-contain"
          style={{
            imageRendering: filter === 'sharp' ? 'pixelated' : 'auto',
            aspectRatio: aspect === 'tv' ? '4 / 3' : '256 / 240',
          }}
        />

        {/* Drag and drop overlay */}
        {isDragOver && (
          <div className="absolute inset-0 bg-red-600/30 border-4 border-dashed border-white backdrop-blur-xs flex items-center justify-center z-30 pointer-events-none">
            <span className="text-xl md:text-2xl font-black text-white uppercase tracking-wider drop-shadow-md">
              Solte os arquivos .nes para carregar!
            </span>
          </div>
        )}

        {/* No ROM placeholder */}
        {!currentRom && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6 bg-neutral-950/80 z-10 pointer-events-none">
            <div className="w-16 h-16 rounded-2xl bg-red-600/20 text-red-500 flex items-center justify-center mb-3">
              <Gamepad2 className="w-8 h-8" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">Dyna Radical 64 NES</h3>
            <p className="text-xs text-neutral-400 max-w-xs leading-relaxed">
              Selecione um jogo na lista lateral, arraste arquivos <span className="text-red-400 font-mono">.nes</span> para cá ou clique em &quot;Carregar ROMs&quot;.
            </p>
          </div>
        )}

        {/* Virtual On-Screen Touch Gamepad for Mobile */}
        <div className="md:hidden absolute inset-x-0 bottom-2 px-3 flex justify-between items-end pointer-events-none z-20">
          {/* D-Pad */}
          <div className="grid grid-cols-3 grid-rows-3 gap-1 pointer-events-auto bg-black/40 backdrop-blur-sm p-1 rounded-full border border-white/10">
            <div />
            <button
              onPointerDown={(e) => { e.preventDefault(); handleTouchButton(Controller.BUTTON_UP, true); }}
              onPointerUp={(e) => { e.preventDefault(); handleTouchButton(Controller.BUTTON_UP, false); }}
              onPointerLeave={() => handleTouchButton(Controller.BUTTON_UP, false)}
              className="w-11 h-11 rounded-t-lg bg-neutral-800/90 active:bg-red-600 text-white font-bold flex items-center justify-center text-sm shadow"
            >
              ▲
            </button>
            <div />
            <button
              onPointerDown={(e) => { e.preventDefault(); handleTouchButton(Controller.BUTTON_LEFT, true); }}
              onPointerUp={(e) => { e.preventDefault(); handleTouchButton(Controller.BUTTON_LEFT, false); }}
              onPointerLeave={() => handleTouchButton(Controller.BUTTON_LEFT, false)}
              className="w-11 h-11 rounded-l-lg bg-neutral-800/90 active:bg-red-600 text-white font-bold flex items-center justify-center text-sm shadow"
            >
              ◀
            </button>
            <div className="w-11 h-11 bg-neutral-900 rounded-full" />
            <button
              onPointerDown={(e) => { e.preventDefault(); handleTouchButton(Controller.BUTTON_RIGHT, true); }}
              onPointerUp={(e) => { e.preventDefault(); handleTouchButton(Controller.BUTTON_RIGHT, false); }}
              onPointerLeave={() => handleTouchButton(Controller.BUTTON_RIGHT, false)}
              className="w-11 h-11 rounded-r-lg bg-neutral-800/90 active:bg-red-600 text-white font-bold flex items-center justify-center text-sm shadow"
            >
              ▶
            </button>
            <div />
            <button
              onPointerDown={(e) => { e.preventDefault(); handleTouchButton(Controller.BUTTON_DOWN, true); }}
              onPointerUp={(e) => { e.preventDefault(); handleTouchButton(Controller.BUTTON_DOWN, false); }}
              onPointerLeave={() => handleTouchButton(Controller.BUTTON_DOWN, false)}
              className="w-11 h-11 rounded-b-lg bg-neutral-800/90 active:bg-red-600 text-white font-bold flex items-center justify-center text-sm shadow"
            >
              ▼
            </button>
            <div />
          </div>

          {/* Middle: Select & Start */}
          <div className="flex gap-2 mb-2 pointer-events-auto bg-black/40 px-2 py-1 rounded-full border border-white/10">
            <button
              onPointerDown={(e) => { e.preventDefault(); handleTouchButton(Controller.BUTTON_SELECT, true); }}
              onPointerUp={(e) => { e.preventDefault(); handleTouchButton(Controller.BUTTON_SELECT, false); }}
              onPointerLeave={() => handleTouchButton(Controller.BUTTON_SELECT, false)}
              className="px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider rounded bg-neutral-800 active:bg-neutral-600 text-neutral-300"
            >
              Select
            </button>
            <button
              onPointerDown={(e) => { e.preventDefault(); handleTouchButton(Controller.BUTTON_START, true); }}
              onPointerUp={(e) => { e.preventDefault(); handleTouchButton(Controller.BUTTON_START, false); }}
              onPointerLeave={() => handleTouchButton(Controller.BUTTON_START, false)}
              className="px-2.5 py-1 text-[10px] uppercase font-bold tracking-wider rounded bg-neutral-800 active:bg-red-600 text-white"
            >
              Start
            </button>
          </div>

          {/* Action Buttons: B & A + Turbo */}
          <div className="flex flex-col gap-1 pointer-events-auto bg-black/40 backdrop-blur-sm p-1.5 rounded-2xl border border-white/10">
            <div className="flex gap-1.5 justify-center">
              <button
                onPointerDown={(e) => { e.preventDefault(); handleTouchButton(Controller.BUTTON_TURBO_B, true); }}
                onPointerUp={(e) => { e.preventDefault(); handleTouchButton(Controller.BUTTON_TURBO_B, false); }}
                onPointerLeave={() => handleTouchButton(Controller.BUTTON_TURBO_B, false)}
                className="w-9 h-9 rounded-full bg-amber-700/80 active:bg-amber-500 text-white font-bold text-[10px]"
              >
                TB
              </button>
              <button
                onPointerDown={(e) => { e.preventDefault(); handleTouchButton(Controller.BUTTON_TURBO_A, true); }}
                onPointerUp={(e) => { e.preventDefault(); handleTouchButton(Controller.BUTTON_TURBO_A, false); }}
                onPointerLeave={() => handleTouchButton(Controller.BUTTON_TURBO_A, false)}
                className="w-9 h-9 rounded-full bg-amber-700/80 active:bg-amber-500 text-white font-bold text-[10px]"
              >
                TA
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onPointerDown={(e) => { e.preventDefault(); handleTouchButton(Controller.BUTTON_B, true); }}
                onPointerUp={(e) => { e.preventDefault(); handleTouchButton(Controller.BUTTON_B, false); }}
                onPointerLeave={() => handleTouchButton(Controller.BUTTON_B, false)}
                className="w-12 h-12 rounded-full bg-red-700 active:bg-red-500 text-white font-bold text-sm shadow-md"
              >
                B
              </button>
              <button
                onPointerDown={(e) => { e.preventDefault(); handleTouchButton(Controller.BUTTON_A, true); }}
                onPointerUp={(e) => { e.preventDefault(); handleTouchButton(Controller.BUTTON_A, false); }}
                onPointerLeave={() => handleTouchButton(Controller.BUTTON_A, false)}
                className="w-12 h-12 rounded-full bg-red-600 active:bg-red-400 text-white font-bold text-sm shadow-md"
              >
                A
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Emulator bottom toolbar */}
      <div className="w-full bg-neutral-900 border-t border-neutral-800 px-3 py-2 flex flex-wrap items-center justify-between gap-2 z-20">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Save / Load State */}
          <button
            onClick={handleSaveState}
            disabled={!currentRom}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-xs font-medium text-neutral-200 transition"
            title="Salvar progresso atual"
          >
            <Save className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Salvar State</span>
          </button>
          <button
            onClick={handleLoadState}
            disabled={!currentRom}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-xs font-medium text-neutral-200 transition"
            title="Carregar progresso salvo"
          >
            <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Carregar State</span>
          </button>

          <div className="h-4 w-px bg-neutral-700 mx-1 hidden sm:block" />

          {/* Graphics Filter */}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as GfxFilter)}
            className="px-2 py-1.5 rounded-md bg-neutral-800 border border-neutral-700 text-xs text-neutral-200 focus:outline-none cursor-pointer"
            title="Filtro visual"
          >
            <option value="sharp">🖥 Nítido</option>
            <option value="smooth">🖥 Suave</option>
            <option value="crt">📺 CRT Scanlines</option>
          </select>

          {/* Color profiles */}
          <select
            value={colorPreset}
            onChange={(e) => setColorPreset(e.target.value as GfxColor)}
            className="px-2 py-1.5 rounded-md bg-neutral-800 border border-neutral-700 text-xs text-neutral-200 focus:outline-none cursor-pointer"
            title="Paleta de Cores"
          >
            <option value="orig">🎨 Cores Originais</option>
            <option value="vivid">🎨 Vivas</option>
            <option value="soft">🎨 TV Vintage</option>
            <option value="mono">🎨 P&amp;B</option>
          </select>

          {/* Aspect Ratio */}
          <button
            onClick={() => setAspect((prev) => (prev === 'pixel' ? 'tv' : 'pixel'))}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-200 transition"
            title="Alternar formato Pixel 1:1 ou TV 4:3"
          >
            {aspect === 'tv' ? <Tv className="w-3.5 h-3.5 text-sky-400" /> : <Monitor className="w-3.5 h-3.5" />}
            <span className="text-[11px]">{aspect === 'tv' ? '4:3 TV' : '1:1 Pixel'}</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Controls modal button */}
          <button
            onClick={() => setShowControlsHint(!showControlsHint)}
            className="p-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition"
            title="Ver controles do teclado"
          >
            <Gamepad2 className="w-4 h-4" />
          </button>

          {/* Sound Toggle */}
          <button
            onClick={() => {
              initAudio();
              setSoundOn(!soundOn);
            }}
            className="p-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition"
            title={soundOn ? 'Desativar Som' : 'Ativar Som'}
          >
            {soundOn ? <Volume2 className="w-4 h-4 text-emerald-400" /> : <VolumeX className="w-4 h-4 text-neutral-500" />}
          </button>

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition"
            title="Tela Cheia"
          >
            {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Keyboard Controls Guide Modal */}
      {showControlsHint && (
        <div className="absolute top-4 right-4 z-40 w-72 rounded-xl border border-neutral-700 bg-neutral-900/95 backdrop-blur-md p-4 shadow-2xl text-xs text-white">
          <div className="flex items-center justify-between pb-2 border-b border-neutral-800 font-bold text-red-400">
            <span className="flex items-center gap-1.5">
              <Gamepad2 className="w-4 h-4" /> Controles do Teclado
            </span>
            <button onClick={() => setShowControlsHint(false)} className="text-neutral-400 hover:text-white">✕</button>
          </div>
          <div className="mt-3 space-y-1.5 text-neutral-300">
            <div className="flex justify-between"><span>Direcionais:</span><span className="font-mono text-white">Setas (↑ ↓ ← →)</span></div>
            <div className="flex justify-between"><span>Botão A:</span><span className="font-mono text-white">Z</span></div>
            <div className="flex justify-between"><span>Botão B:</span><span className="font-mono text-white">X</span></div>
            <div className="flex justify-between"><span>Turbo A:</span><span className="font-mono text-white">A</span></div>
            <div className="flex justify-between"><span>Turbo B:</span><span className="font-mono text-white">S</span></div>
            <div className="flex justify-between"><span>Start:</span><span className="font-mono text-white">Enter</span></div>
            <div className="flex justify-between"><span>Select:</span><span className="font-mono text-white">Shift</span></div>
          </div>
        </div>
      )}
    </div>
  );
};
