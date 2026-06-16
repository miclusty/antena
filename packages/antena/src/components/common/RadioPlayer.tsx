/** @jsxImportSource solid-js */
import {
  createSignal,
  createEffect,
  createMemo,
  onMount,
  onCleanup,
  Show,
  For,
} from 'solid-js';
import MaterialIcon from '../common/MaterialIcon';
import { useHaptic } from '../../lib/haptic';

export interface Radio {
  id: number;
  name: string;
  stream_url: string;
  website?: string | null;
  city?: string | null;
  province?: string | null;
  codgl?: string | null;
  type?: string;
}

const STORAGE_KEY = 'antena.radio.v1';
const API_BASE_FALLBACK = 'https://akira-api.miclusty.workers.dev';

function getApiBase(): string {
  try {
    const fromEnv = (import.meta as { env?: { PUBLIC_API_BASE?: string } }).env?.PUBLIC_API_BASE;
    if (fromEnv && !fromEnv.includes('localhost')) return fromEnv;
  } catch {
    // ignore
  }
  return API_BASE_FALLBACK;
}

export default function RadioPlayer() {
  const haptic = useHaptic();

  // Persistent state (saved to localStorage)
  const [open, setOpen] = createSignal(false);
  const [current, setCurrent] = createSignal<Radio | null>(null);
  const [playing, setPlaying] = createSignal(false);
  const [volume, setVolume] = createSignal(0.7);
  const [muted, setMuted] = createSignal(false);
  const [search, setSearch] = createSignal('');
  const [cityFilter, setCityFilter] = createSignal<string>('');
  const [radios, setRadios] = createSignal<Radio[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [expanded, setExpanded] = createSignal(false);

  let audioEl: HTMLAudioElement | undefined;
  let userInteracted = false;

  // Restore from localStorage on mount
  onMount(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as { currentId?: number; volume?: number; muted?: boolean };
        if (s.volume !== undefined) setVolume(s.volume);
        if (s.muted !== undefined) setMuted(s.muted);
        if (s.currentId) {
          // Mark that we have a saved selection; the radios list
          // fetch will resolve the radio object.
          setCurrent({ id: s.currentId } as Radio);
        }
      }
    } catch {
      // ignore corrupt storage
    }
    // Detect "first user gesture" — required by autoplay policies.
    const onFirstGesture = () => {
      userInteracted = true;
      window.removeEventListener('click', onFirstGesture);
      window.removeEventListener('keydown', onFirstGesture);
      window.removeEventListener('touchstart', onFirstGesture);
    };
    window.addEventListener('click', onFirstGesture, { passive: true });
    window.addEventListener('keydown', onFirstGesture, { passive: true });
    window.addEventListener('touchstart', onFirstGesture, { passive: true });
    onCleanup(() => {
      window.removeEventListener('click', onFirstGesture);
      window.removeEventListener('keydown', onFirstGesture);
      window.removeEventListener('touchstart', onFirstGesture);
    });
  });

  // Persist on changes
  createEffect(() => {
    const c = current();
    if (!c) return;
    const v = volume();
    const m = muted();
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ currentId: c.id, volume: v, muted: m }),
      );
    } catch {
      // ignore quota errors
    }
  });

  // Fetch the directory when the panel opens for the first time
  const loadRadios = async () => {
    if (loading() || radios().length) return;
    setLoading(true);
    setError(null);
    try {
      const url = new URL(`${getApiBase()}/api/stats/radios?limit=2000`);
      const res = await fetch(url.toString(), { headers: { 'User-Agent': 'AntenaRadio/1.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items?: Radio[] };
      const items = data.items ?? [];
      setRadios(items);
      // If we had a saved currentId, hydrate the radio object
      const cur = current();
      if (cur && cur.id && !cur.stream_url) {
        const found = items.find((r) => r.id === cur.id);
        if (found) setCurrent(found);
        else setCurrent(null);
      }
    } catch (e) {
      setError((e as Error).message || 'No se pudieron cargar las radios');
    } finally {
      setLoading(false);
    }
  };

  // Play / pause handling
  createEffect(() => {
    const c = current();
    const isPlaying = playing();
    if (!audioEl) return;
    if (c?.stream_url) {
      // Update src if it changed
      if (audioEl.src !== c.stream_url) {
        audioEl.src = c.stream_url;
        audioEl.load();
      }
      if (isPlaying && userInteracted) {
        audioEl.play().catch(() => setPlaying(false));
      } else {
        audioEl.pause();
      }
    } else {
      audioEl.pause();
      audioEl.removeAttribute('src');
    }
  });

  createEffect(() => {
    if (!audioEl) return;
    audioEl.volume = muted() ? 0 : volume();
  });

  const togglePlay = () => {
    haptic.vibrate('tap');
    userInteracted = true;
    setPlaying(!playing());
  };

  const selectRadio = (r: Radio) => {
    haptic.vibrate('tap');
    userInteracted = true;
    setCurrent(r);
    setPlaying(true);
    setExpanded(false);
  };

  const filtered = createMemo(() => {
    const q = search().toLowerCase().trim();
    const city = cityFilter();
    return radios().filter((r) => {
      if (city && r.city !== city) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.city ?? '').toLowerCase().includes(q) ||
        (r.province ?? '').toLowerCase().includes(q)
      );
    });
  });

  const cities = createMemo(() => {
    const set = new Set<string>();
    for (const r of radios()) if (r.city) set.add(r.city);
    return Array.from(set).sort();
  });

  const currentCityRadios = createMemo(() =>
    radios().filter((r) => r.codgl && r.city).slice(0, 6),
  );

  return (
    <>
      {/* The actual audio element — always in the DOM so the
          stream keeps playing while the user navigates. */}
      <audio
        ref={(el) => (audioEl = el)}
        preload="none"
        crossorigin="anonymous"
        onError={() => {
          setPlaying(false);
          setError('Stream no disponible. Probá otra radio.');
        }}
        onPlaying={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />

      {/* Persistent play bar — fixed bottom, above the BottomNav */}
      <div
        class="fixed left-0 right-0 z-40 transition-transform duration-200"
        style={{
          bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))',
          transform: open() ? 'translateY(0)' : 'translateY(0)',
        }}
      >
        <Show when={current()}>
          <div
            class="mx-auto px-3 max-w-3xl"
            style={{ 'pointer-events': open() ? 'auto' : 'none' }}
          >
            <div
              class="flex items-center gap-2 rounded-full shadow-lg border px-2 py-1.5"
              style={{
                background: 'var(--bg-elevated)',
                'border-color': 'var(--border-base)',
                'backdrop-filter': 'blur(12px)',
              }}
            >
              <button
                onClick={togglePlay}
                aria-label={playing() ? 'Pausar' : 'Reproducir'}
                class="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: 'var(--accent)', color: 'white' }}
              >
                <MaterialIcon
                  name={playing() ? 'pause' : 'play_arrow'}
                  size="base"
                  class="text-base"
                  style={{ 'font-variation-settings': "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24'" }}
                />
              </button>
              <button
                onClick={() => { haptic.vibrate('tap'); setOpen(!open()); if (!radios().length) loadRadios(); }}
                class="flex-1 min-w-0 text-left px-2"
                aria-label="Abrir reproductor"
              >
                <p
                  class="text-xs font-bold truncate"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {current()?.name ?? 'Reproductor'}
                </p>
                <p
                  class="text-[10px] truncate"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {current()?.city ? `${current()!.city} · ${current()!.province ?? ''}` : 'Tocá para elegir radio'}
                </p>
              </button>
              <Show when={open()}>
                <button
                  onClick={() => { haptic.vibrate('tap'); setMuted(!muted()); }}
                  aria-label={muted() ? 'Activar sonido' : 'Silenciar'}
                  class="shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                >
                  <MaterialIcon
                    name={muted() ? 'volume_off' : 'volume_up'}
                    size="sm"
                    class="text-base"
                    style={{ color: 'var(--text-secondary)' }}
                  />
                </button>
                <button
                  onClick={() => { setCurrent(null); setPlaying(false); setOpen(false); }}
                  aria-label="Cerrar reproductor"
                  class="shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                >
                  <MaterialIcon
                    name="close"
                    size="sm"
                    class="text-base"
                    style={{ color: 'var(--text-secondary)' }}
                  />
                </button>
              </Show>
            </div>
          </div>
        </Show>
      </div>

      {/* Full panel: drawer of all radios */}
      <Show when={open()}>
        <div
          class="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setOpen(false)}
        >
          <div
            class="w-full max-w-3xl max-h-[85vh] rounded-t-2xl overflow-hidden flex flex-col"
            style={{ background: 'var(--bg-base)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              class="flex items-center gap-3 p-4 border-b"
              style={{ 'border-color': 'var(--border-base)' }}
            >
              <MaterialIcon
                name="radio"
                size="base"
                class="text-base"
                style={{ color: 'var(--accent)' }}
              />
              <h2
                class="flex-1 text-lg font-bold"
                style={{ color: 'var(--text-primary)' }}
              >
                Radios en vivo
              </h2>
              <span
                class="text-xs tabular-nums"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {radios().length} emisoras
              </span>
              <button
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                class="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: 'var(--bg-elevated)' }}
              >
                <MaterialIcon name="close" size="sm" class="text-base" />
              </button>
            </div>

            {/* Now playing */}
            <Show when={current()}>
              <div
                class="p-3 border-b"
                style={{ 'border-color': 'var(--border-base)', background: 'var(--bg-elevated)' }}
              >
                <div class="flex items-center gap-3">
                  <button
                    onClick={togglePlay}
                    class="shrink-0 w-11 h-11 rounded-full flex items-center justify-center"
                    style={{ background: 'var(--accent)', color: 'white' }}
                  >
                    <MaterialIcon
                      name={playing() ? 'pause' : 'play_arrow'}
                      size="base"
                      class="text-xl"
                    />
                  </button>
                  <div class="flex-1 min-w-0">
                    <p class="text-[10px] uppercase tracking-wider font-bold" style={{ color: 'var(--text-tertiary)' }}>
                      {playing() ? 'Reproduciendo' : 'En pausa'}
                    </p>
                    <p class="text-sm font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                      {current()!.name}
                    </p>
                    <p class="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                      {current()!.city ?? 'Argentina'}{current()!.province ? `, ${current()!.province}` : ''}
                    </p>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={muted() ? 0 : volume()}
                    onInput={(e) => {
                      setVolume(Number((e.currentTarget as HTMLInputElement).value));
                      setMuted(false);
                    }}
                    aria-label="Volumen"
                    class="w-20 accent-current"
                    style={{ color: 'var(--accent)' }}
                  />
                </div>
              </div>
            </Show>

            {/* Search + city filter */}
            <div class="p-3 border-b flex gap-2" style={{ 'border-color': 'var(--border-base)' }}>
              <div class="flex-1 relative">
                <MaterialIcon
                  name="search"
                  size="sm"
                  class="text-base absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--text-tertiary)' }}
                />
                <input
                  type="search"
                  value={search()}
                  onInput={(e) => setSearch((e.currentTarget as HTMLInputElement).value)}
                  placeholder="Buscar radio, ciudad, provincia…"
                  class="w-full pl-9 pr-3 py-2 rounded-lg text-sm border bg-transparent"
                  style={{ 'border-color': 'var(--border-base)', color: 'var(--text-primary)' }}
                />
              </div>
              <select
                value={cityFilter()}
                onChange={(e) => setCityFilter((e.currentTarget as HTMLSelectElement).value)}
                class="px-2 py-2 rounded-lg text-sm border bg-transparent"
                style={{ 'border-color': 'var(--border-base)', color: 'var(--text-primary)' }}
                aria-label="Filtrar por ciudad"
              >
                <option value="">Todas</option>
                <For each={cities()}>
                  {(c) => <option value={c}>{c}</option>}
                </For>
              </select>
            </div>

            {/* City suggestion if filter empty and no current */}
            <Show when={!cityFilter() && !current() && currentCityRadios().length > 0}>
              <div class="px-3 pt-3">
                <p class="text-[10px] uppercase tracking-wider font-bold mb-1" style={{ color: 'var(--text-tertiary)' }}>
                  Cerca tuyo
                </p>
                <p class="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
                  Sugerencias (seguí un pueblo en <a href="/settings" class="underline">Ajustes</a> para personalizar)
                </p>
              </div>
            </Show>

            {/* List */}
            <div class="flex-1 overflow-y-auto">
              <Show when={error()}>
                <p class="p-4 text-sm" style={{ color: 'var(--text-tertiary)' }}>
                  {error()}
                </p>
              </Show>
              <Show when={loading()}>
                <p class="p-4 text-sm text-center" style={{ color: 'var(--text-tertiary)' }}>
                  Cargando radios…
                </p>
              </Show>
              <Show when={!loading() && !error() && radios().length === 0}>
                <p class="p-4 text-sm text-center" style={{ color: 'var(--text-tertiary)' }}>
                  Tocá el botón de play para abrir el directorio
                </p>
              </Show>
              <ul class="divide-y" style={{ 'border-color': 'var(--border-base)' }}>
                <For each={filtered().slice(0, 200)}>
                  {(r) => (
                    <li>
                      <button
                        onClick={() => selectRadio(r)}
                        class="w-full flex items-center gap-3 p-3 text-left hover:bg-[color:var(--bg-elevated)] active:bg-[color:var(--bg-elevated)]"
                        style={{
                          background: current()?.id === r.id ? 'var(--bg-elevated)' : 'transparent',
                        }}
                      >
                        <div
                          class="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
                          style={{
                            background: current()?.id === r.id ? 'var(--accent)' : 'var(--bg-elevated)',
                            color: current()?.id === r.id ? 'white' : 'var(--text-secondary)',
                          }}
                        >
                          <MaterialIcon
                            name={current()?.id === r.id && playing() ? 'volume_up' : 'radio'}
                            size="sm"
                            class="text-base"
                          />
                        </div>
                        <div class="flex-1 min-w-0">
                          <p
                            class="text-sm font-medium truncate"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {r.name}
                          </p>
                          <p
                            class="text-xs truncate"
                            style={{ color: 'var(--text-tertiary)' }}
                          >
                            {r.city ?? 'Argentina'}{r.province ? `, ${r.province}` : ''}
                          </p>
                        </div>
                        <Show when={current()?.id === r.id && playing()}>
                          <span
                            class="text-[10px] font-bold uppercase tracking-wider"
                            style={{ color: 'var(--accent)' }}
                          >
                            EN VIVO
                          </span>
                        </Show>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
              <Show when={filtered().length > 200}>
                <p class="p-3 text-xs text-center" style={{ color: 'var(--text-tertiary)' }}>
                  Mostrando 200 de {filtered().length}. Usá el buscador para acotar.
                </p>
              </Show>
            </div>
          </div>
        </div>
      </Show>

      {/* Floating play button when no current radio — always visible
          so the user can open the directory from any page. */}
      <Show when={!current()}>
        <button
          onClick={() => { haptic.vibrate('tap'); setOpen(true); loadRadios(); }}
          aria-label="Abrir radios en vivo"
          class="fixed right-4 z-40 w-12 h-12 rounded-full shadow-lg flex items-center justify-center"
          style={{
            bottom: 'calc(80px + env(safe-area-inset-bottom, 0px))',
            background: 'var(--accent)',
            color: 'white',
          }}
        >
          <MaterialIcon name="radio" size="base" class="text-xl" />
        </button>
      </Show>
    </>
  );
}
