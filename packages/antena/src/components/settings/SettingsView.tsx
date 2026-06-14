/** @jsxImportSource solid-js */
import { Show, createSignal, onMount, For, createMemo } from "solid-js";
import {
  readDataSaver,
  writeDataSaver,
  readFontScale,
  writeFontScale,
  writeDensity,
  readImageQuality,
  writeImageQuality,
  readReadingModeDefault,
  writeReadingModeDefault,
  FONT_SCALE_MIN,
  FONT_SCALE_MAX,
  FONT_SCALE_STEP,
  type ImageQuality,
} from "../../lib/preferences";
import { useTheme } from "../../lib/theme";
import { getAntenaDeviceId, fetchFollows, fetchSources, unfollowSource, followSource, type ApiSourceEntry } from "../../lib/api";
import { toast } from "../Toast";
import MaterialIcon from '../common/MaterialIcon';

const QUALITY_OPTIONS: { id: ImageQuality; label: string; desc: string }[] = [
  { id: "auto", label: "Auto", desc: "El server decide" },
  { id: "high", label: "Alta", desc: "AVIF/WebP, ancho completo" },
  { id: "medium", label: "Media", desc: "WebP, 800px" },
  { id: "low", label: "Baja", desc: "JPEG, 400px" },
];

export default function SettingsView() {
  const { theme, toggleTheme } = useTheme();
  const [fontScale, setFontScale] = createSignal(1.0);
  const [dataSaver, setDataSaver] = createSignal(false);
  const [imageQuality, setImageQuality] = createSignal<ImageQuality>("auto");
  const [readingModeDefault, setReadingModeDefault] = createSignal(false);
  const [deviceId, setDeviceId] = createSignal<string>("");
  const [follows, setFollows] = createSignal<Array<{ sourceId: number; sourceName: string | null; sourceUrl: string | null }>>([]);
  const [sources, setSources] = createSignal<ApiSourceEntry[]>([]);

  // Top-5 sources the user does NOT already follow. Computed
  // memo so it stays in sync with `follows()` and `sources()`
  // — no manual re-filter on each follow/unfollow click.
  const suggestedSources = createMemo(() => {
    const followedIds = new Set(follows().map((f) => f.sourceId));
    return sources()
      .filter((s) => !followedIds.has(s.id) && (s.is_active === 1 || s.is_active === undefined))
      .slice(0, 5);
  });

  onMount(() => {
    setFontScale(readFontScale());
    setDataSaver(readDataSaver());
    setImageQuality(readImageQuality());
    setReadingModeDefault(readReadingModeDefault());
    setDeviceId(getAntenaDeviceId());
    // Apply font scale immediately so the UI re-flows.
    document.documentElement.style.setProperty("--font-scale", String(readFontScale()));
    if (readDataSaver()) document.documentElement.classList.add("data-saver");
    // Load follows + sources in parallel for the account section.
    Promise.all([
      fetchFollows().then(setFollows).catch(() => setFollows([])),
      fetchSources(30).then(setSources).catch(() => setSources([])),
    ]);
  });

  const updateFontScale = (v: number) => {
    const clamped = Math.max(FONT_SCALE_MIN, Math.min(FONT_SCALE_MAX, v));
    setFontScale(clamped);
    writeFontScale(clamped);
    document.documentElement.style.setProperty("--font-scale", String(clamped));
  };

  const updateDataSaver = (v: boolean) => {
    setDataSaver(v);
    writeDataSaver(v);
    document.documentElement.classList.toggle("data-saver", v);
  };

  const updateImageQuality = (q: ImageQuality) => {
    setImageQuality(q);
    writeImageQuality(q);
  };

  const updateReadingModeDefault = (v: boolean) => {
    setReadingModeDefault(v);
    writeReadingModeDefault(v);
  };

  const clearAllData = () => {
    if (typeof window === "undefined") return;
    const ok = window.confirm("¿Borrar todos los datos locales? Esta acción no se puede deshacer.");
    if (!ok) return;
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) keys.push(k);
      }
      keys.filter((k) => k.startsWith("antena-")).forEach((k) => localStorage.removeItem(k));
      toast("Datos borrados — recargá para empezar de cero", "info");
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      toast("No se pudo borrar los datos", "error");
    }
  };

  const exportData = () => {
    if (typeof window === "undefined") return;
    const dump: Record<string, unknown> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("antena-")) {
        try { dump[k] = JSON.parse(localStorage.getItem(k) || "null"); }
        catch { dump[k] = localStorage.getItem(k); }
      }
    }
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `antena-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Exportación lista", "info");
  };

  const copyDeviceId = async () => {
    if (!deviceId()) return;
    try {
      await navigator.clipboard.writeText(deviceId());
      toast("ID copiado", "info");
    } catch {
      toast("No se pudo copiar", "error");
    }
  };

  const unfollow = async (sourceId: number) => {
    const ok = await unfollowSource(sourceId);
    if (ok) {
      setFollows((cur) => cur.filter((f) => f.sourceId !== sourceId));
      toast("Medio removido", "info");
    } else {
      toast("No se pudo remover", "error");
    }
  };

  const follow = async (sourceId: number) => {
    const ok = await followSource(sourceId);
    if (ok) {
      // Add a placeholder entry; the real sourceName/url come
      // from the follow response on the server. Reload to be
      // safe.
      void fetchFollows().then(setFollows);
      toast("Ahora seguís este medio", "info");
    } else {
      toast("No se pudo seguir", "error");
    }
  };

  const themeLabel = () => {
    if (theme() === "light") return "Claro";
    if (theme() === "dark") return "Oscuro";
    return "Auto";
  };
  const themeIcon = () => {
    if (theme() === "light") return "light_mode";
    if (theme() === "dark") return "dark_mode";
    return "brightness_auto";
  };

  return (
    <div class="w-full max-w-2xl mx-auto">
      <header class="px-5 py-4 border-b border-border-base">
        <h1 class="text-xl font-bold" style={{ "font-family": "var(--font-display)", color: "var(--text-primary)" }}>
          Configuración
        </h1>
        <p class="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>
          Tus preferencias se guardan en este dispositivo.
        </p>
      </header>

      <Section title="Apariencia" icon="palette">
        <Row label="Tema" description={`Actual: ${themeLabel()}`}>
          <button
            type="button"
            onClick={toggleTheme}
            class="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium"
            style={{ background: "var(--accent-muted)", color: "var(--accent)" }}
            aria-label="Cambiar tema"
          >
            <MaterialIcon name={themeIcon()} size="base" class="text-base " style={{ "font-variation-settings": "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 18" }} aria-hidden="true" />
            Cambiar
          </button>
        </Row>

        <Row label="Tamaño de fuente" description={`${Math.round(fontScale() * 100)}%`}>
          <div class="flex items-center gap-2">
            <button
              type="button"
              onClick={() => updateFontScale(fontScale() - FONT_SCALE_STEP)}
              class="w-8 h-8 flex items-center justify-center rounded-full"
              style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border-base)" }}
              aria-label="Reducir fuente"
            >
              −
            </button>
            <input
              type="range"
              min={FONT_SCALE_MIN}
              max={FONT_SCALE_MAX}
              step={FONT_SCALE_STEP}
              value={fontScale()}
              onInput={(e) => updateFontScale(parseFloat(e.currentTarget.value))}
              class="flex-1 accent-accent"
              aria-label="Tamaño de fuente"
            />
            <button
              type="button"
              onClick={() => updateFontScale(fontScale() + FONT_SCALE_STEP)}
              class="w-8 h-8 flex items-center justify-center rounded-full"
              style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border-base)" }}
              aria-label="Aumentar fuente"
            >
              +
            </button>
          </div>
        </Row>

        <Row label="Abrir artículos en Modo lectura" description="Salta directo a la vista limpia al abrir una noticia.">
          <Toggle
            checked={readingModeDefault()}
            onChange={updateReadingModeDefault}
            label="Modo lectura por defecto"
          />
        </Row>
      </Section>

      <Section title="Datos e imágenes" icon="image">
        <Row label="Modo data-saver" description="Oculta imágenes en el feed y pide variantes de baja calidad.">
          <Toggle
            checked={dataSaver()}
            onChange={updateDataSaver}
            label="Modo data-saver"
          />
        </Row>

        <Row label="Calidad de imagen" description="El server sirve variantes según esta preferencia.">
          <div class="flex flex-wrap gap-1.5">
            {QUALITY_OPTIONS.map((opt) => (
              <button
                type="button"
                onClick={() => updateImageQuality(opt.id)}
                class="text-xs font-medium px-2.5 py-1.5 rounded-full border"
                style={
                  imageQuality() === opt.id
                    ? { background: "var(--accent)", color: "#fff", "border-color": "var(--accent)" }
                    : { background: "var(--bg-elevated)", color: "var(--text-tertiary)", "border-color": "var(--border-base)" }
                }
                title={opt.desc}
                aria-pressed={imageQuality() === opt.id}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </Row>
      </Section>

      <Section title="Cuenta" icon="person">
        <Row label="ID de dispositivo" description="Identificador anónimo que usamos para tus follows y votos.">
          <button
            type="button"
            onClick={copyDeviceId}
            class="flex items-center gap-1.5 text-xs font-mono px-2.5 py-1.5 rounded-md"
            style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border-base)" }}
            title="Copiar al portapapeles"
          >
            <MaterialIcon name="content_copy" size="sm" class="text-sm " style={{ "font-variation-settings": "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 16" }} aria-hidden="true" />
            {deviceId() ? deviceId().slice(0, 8) + "…" : "—"}
          </button>
        </Row>

        <Show when={follows().length > 0}>
          <div class="pt-2 border-t border-border-base">
            <p class="text-[10px] font-extrabold uppercase tracking-widest mb-2" style={{ color: "var(--text-tertiary)" }}>
              Tus medios ({follows().length})
            </p>
            <ul class="space-y-1">
              <For each={follows()}>
                {(f) => (
                  <li class="flex items-center justify-between gap-2 text-sm py-1">
                    <span class="min-w-0 truncate" style={{ color: "var(--text-primary)" }}>
                      {f.sourceName ?? `Medio #${f.sourceId}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => unfollow(f.sourceId)}
                      class="text-[11px] font-semibold px-2 py-1 rounded-full"
                      style={{ color: "var(--accent)" }}
                    >
                      Dejar
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>

        <Show when={suggestedSources().length > 0}>
          <div class="pt-2 border-t border-border-base">
            <p class="text-[10px] font-extrabold uppercase tracking-widest mb-2" style={{ color: "var(--text-tertiary)" }}>
              Sugeridos para seguir
            </p>
            <ul class="space-y-1">
              <For each={suggestedSources()}>
                {(s) => (
                  <li class="flex items-center justify-between gap-2 text-sm py-1">
                    <div class="min-w-0 flex-1">
                      <p class="truncate" style={{ color: "var(--text-primary)" }}>{s.name}</p>
                      <p class="text-[11px] truncate" style={{ color: "var(--text-tertiary)" }}>
                        {s.location_name ?? s.province ?? "Argentina"} · {s.news_count ?? 0} notas
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => follow(s.id)}
                      class="text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0"
                      style={{ background: "var(--accent-muted)", color: "var(--accent)" }}
                    >
                      + Seguir
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>
      </Section>

      <Section title="Tus datos" icon="download">
        <Row label="Exportar datos" description="Bookmarks, follows, preferencias. No incluye votos del server.">
          <button
            type="button"
            onClick={exportData}
            class="text-xs font-semibold px-3 py-1.5 rounded-full"
            style={{ background: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border-base)" }}
          >
            Exportar
          </button>
        </Row>
      </Section>

      <Section title="Zona peligrosa" icon="warning">
        <Row label="Borrar datos locales" description="Bookmarks, follows, preferencias. El servidor conserva tus votos y reposts.">
          <button
            type="button"
            onClick={clearAllData}
            class="text-xs font-semibold px-3 py-1.5 rounded-full"
            style={{ background: "rgba(239, 68, 68, 0.1)", color: "#DC2626", border: "1px solid rgba(239, 68, 68, 0.3)" }}
          >
            Borrar
          </button>
        </Row>
      </Section>

      <footer class="px-5 py-6 text-center">
        <a href="/" class="text-xs underline" style={{ color: "var(--accent)" }}>
          ← Volver al feed
        </a>
      </footer>
    </div>
  );
}

function Section(props: { title: string; icon: string; children: any }) {
  return (
    <section class="border-b border-border-base px-5 py-4">
      <h2 class="text-[10px] font-extrabold uppercase tracking-widest mb-3 flex items-center gap-1.5" style={{ color: "var(--text-tertiary)" }}>
        <MaterialIcon name={props.icon} size="base" class="text-base " style={{ "font-variation-settings": "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 18" }} aria-hidden="true" />
        {props.title}
      </h2>
      <div class="space-y-3">{props.children}</div>
    </section>
  );
}

function Row(props: { label: string; description?: string; children: any }) {
  return (
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {props.label}
        </p>
        <Show when={props.description}>
          <p class="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>
            {props.description}
          </p>
        </Show>
      </div>
      <div class="shrink-0">{props.children}</div>
    </div>
  );
}

function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      onClick={() => props.onChange(!props.checked)}
      class="relative w-11 h-6 rounded-full transition-colors"
      style={{ background: props.checked ? "var(--accent)" : "var(--border-base)" }}
    >
      <span
        class="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow-sm"
        style={{ transform: props.checked ? "translateX(22px)" : "translateX(2px)" }}
      />
    </button>
  );
}
