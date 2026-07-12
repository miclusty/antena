/** @jsxImportSource solid-js */
import { createMemo, createResource, createSignal, Show, For } from 'solid-js';
import type { NewsItem } from '../../lib/types';
import { useHaptic } from '../../lib/haptic';
import { createScrollProgress } from '../../lib/scroll-progress';
import { trackEvent } from '../../lib/analytics';
import { fetchBiasNarrative, fetchContradictions } from '../../lib/api';
import BottomSheet from '../common/BottomSheet';
import MaterialIcon from '../common/MaterialIcon';
import OtrasVocesTable from './OtrasVocesTable';

// Map subject keys to user-friendly Spanish labels. Falls back to
// the raw key (with underscores replaced) so a brand-new subject
// the i18n table doesn't know about still renders something legible.
const SUBJECT_LABELS: Record<string, string> = {
  muerto: 'muertos',
  herido: 'heridos',
  evacuado: 'evacuados',
  damnificado: 'damnificados',
  detenido: 'detenidos',
  desaparecido: 'desaparecidos',
  contagiado: 'contagiados',
  victima: 'víctimas',
  persona: 'personas',
  familia: 'familias',
  nino: 'niños',
  menor: 'menores',
  peso: 'pesos',
  dolar: 'dólares',
  dolares: 'dólares',
  euro: 'euros',
  grado: 'grados',
  dia: 'días',
  mes: 'meses',
  ano: 'años',
  hora: 'horas',
  minuto: 'minutos',
  casa: 'casas',
  edificio: 'edificios',
  vehiculo: 'vehículos',
  metro: 'metros',
  kilometro: 'kilómetros',
  centimetro: 'centímetros',
  hectarea: 'hectáreas',
  kilogramo: 'kilogramos',
  tonelada: 'toneladas',
  porcentaje: '%',
  millon_ARS: 'millones de pesos',
  millon_USD: 'millones de dólares',
  millon_peso: 'millones de pesos',
  millon_dolar: 'millones de dólares',
  millon_euro: 'millones de euros',
  millon: 'millones',
  mil_ARS: 'miles de pesos',
  mil_peso: 'miles de pesos',
  mil: 'miles',
};

function formatSubject(subject: string, unit: string | null): string {
  if (unit === '%') return SUBJECT_LABELS.porcentaje ?? '%';
  if (subject in SUBJECT_LABELS) return SUBJECT_LABELS[subject];
  return subject.replace(/_/g, ' ');
}

function formatValue(v: number): string {
  // Spanish news style: 1.234 for thousands, decimals only when needed
  if (Number.isInteger(v) && Math.abs(v) >= 1000) {
    return v.toLocaleString('es-AR');
  }
  return v.toString();
}

interface OtrasVocesCtaProps {
  otherSources: NewsItem[];
  currentId: string;
  clusterId?: string;
  onSelect?: (article: NewsItem) => void;
}

/**
 * Sticky CTA that appears after the user has scrolled past the
 * article body. Tapping it opens a BottomSheet listing all the
 * other sources covering the same story.
 */
export default function OtrasVocesCta(props: OtrasVocesCtaProps) {
  const haptic = useHaptic();
  const [sheetOpen, setSheetOpen] = createSignal(false);
  const [sentinelRef, passed] = createScrollProgress(0.6);

  // Bias narrative: LLM-generated explanation of cluster bias.
  const [narrative] = createResource(
    () => (sheetOpen() && props.clusterId ? props.clusterId : null),
    fetchBiasNarrative
  );

  // Contradictions: numerical/factual disagreements between sources.
  // Shown above the narrative as a discrete warning card. Lazy-loaded
  // along with the narrative so we don't fire two requests on mount.
  const [contradictions] = createResource(
    () => (sheetOpen() && props.clusterId ? props.clusterId : null),
    fetchContradictions
  );

  // Pre-compute the source labels for the CTA copy
  const topSources = createMemo(() => {
    // Dedupe by source name. Without this, a cluster of 3
    // articles from the same outlet (e.g. the same wire story
    // syndicated 3×) would render as
    // "diariolujan.ar · diariolujan.ar · diariolujan.ar".
    const seen = new Set<string>();
    const out: string[] = [];
    for (const a of props.otherSources) {
      if (out.length >= 3) break;
      const key = a.source.toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a.source);
    }
    return out;
  });
  const overflow = createMemo(() => {
    // Count unique sources, not raw article count, so the "+N"
    // matches the deduped headline above.
    const seen = new Set<string>();
    for (const a of props.otherSources) seen.add(a.source.toLowerCase().trim());
    return Math.max(0, seen.size - 3);
  });

  // Fire a one-time analytics event when the CTA becomes visible
  let tracked = false;
  const trackOnce = () => {
    if (tracked) return;
    if (!passed()) return;
    tracked = true;
    trackEvent({
      type: 'card_view',
      newsId: props.currentId,
      source: 'otras_voces_cta',
    });
  };

  const openSheet = () => {
    haptic.vibrate(15); // light impact
    trackOnce();
    setSheetOpen(true);
  };

  return (
    <Show when={props.otherSources.length > 0}>
      {/* Sentinel — drives when the sticky CTA appears */}
      <div
        ref={sentinelRef}
        aria-hidden="true"
        style={{ height: '1px' }}
      />
      <Show when={passed()}>
        <div
          class="fixed left-0 right-0 mx-4 flex justify-center pointer-events-none"
          style={{ bottom: 'calc(var(--bottom-nav-height, 60px) + 12px)', 'z-index': 'var(--z-floating)' }}
        >
          <button
            onClick={openSheet}
            class="pointer-events-auto w-full max-w-md min-h-[56px] rounded-2xl px-5 py-3 flex items-center justify-between gap-3 text-left active:scale-[0.98] transition-transform"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-base)',
              'backdrop-filter': 'blur(20px)',
              'box-shadow': '0 8px 24px rgba(0,0,0,0.12)',
            }}
            aria-label={`Ver ${props.otherSources.length} voces más sobre esta historia`}
          >
            <div class="flex-1 min-w-0">
              <p
                class="text-[11px] font-bold uppercase tracking-widest"
                style={{ color: 'var(--accent)' }}
              >
                {props.otherSources.length} voces más sobre esta historia
              </p>
              <p
                class="text-sm font-medium mt-0.5 truncate"
                style={{ color: 'var(--text-primary)' }}
              >
                {topSources().join(' · ')}
                <Show when={overflow() > 0}>
                  <span style={{ color: 'var(--text-tertiary)' }}>
                    {' '}· +{overflow()}
                  </span>
                </Show>
              </p>
            </div>
            <MaterialIcon name="arrow_forward" size="2xl" class="text-2xl shrink-0" style={{ color: 'var(--accent)' }} />
          </button>
        </div>
      </Show>

      <BottomSheet
        open={sheetOpen()}
        onClose={() => setSheetOpen(false)}
        title={`${props.otherSources.length} voces sobre esta historia`}
      >
        <p
          class="text-[11px] mb-3"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Deslizá horizontalmente para comparar cómo cubre cada medio
        </p>
        <Show when={(contradictions()?.count ?? 0) > 0}>
          {(getCount) => (
            <div
              class="rounded-lg p-3 mb-3 text-[13px]"
              role="alert"
              aria-label="Discrepancias entre fuentes"
              style={{
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                'border-left': '4px solid #f59e0b',
              }}
            >
              <div class="flex items-center gap-2 mb-1.5">
                <MaterialIcon
                  name="warning"
                  size="sm"
                  style={{ color: '#f59e0b' }}
                />
                <p
                  class="text-[12px] font-bold uppercase tracking-wider"
                  style={{ color: '#b45309' }}
                >
                  Discrepancias entre fuentes ({getCount()})
                </p>
              </div>
              <ul class="space-y-1 text-[12px] leading-snug" style={{ color: 'var(--text-primary)' }}>
                <For each={contradictions()?.contradictions ?? []}>
                  {(c) => {
                    // Build "A=5 vs B=8 (muertos)" string from entries.
                    // We dedupe by source so the same outlet saying two
                    // things doesn't show up twice.
                    const seen = new Set<string>();
                    const parts: string[] = [];
                    for (const e of c.entries) {
                      if (seen.has(e.source)) continue;
                      seen.add(e.source);
                      parts.push(`${e.source}=${formatValue(e.value)}`);
                    }
                    return (
                      <li>
                        <strong>{parts.join(' vs ')}</strong>
                        <span style={{ color: 'var(--text-tertiary)' }}>
                          {' '}({formatSubject(c.subject, c.unit)})
                        </span>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </div>
          )}
        </Show>
        <Show when={narrative()}>
          {(n) => (
            <div
              class="rounded-lg p-3 mb-3 text-[13px] leading-relaxed"
              style={{
                background: 'var(--bg-base)',
                'border-left': '4px solid var(--accent)',
              }}
              role="note"
              aria-label="Análisis de sesgo editorial"
            >
              <p style={{ color: 'var(--text-primary)' }}>{n().narrative}</p>
              <Show when={n().key_quotes.length > 0}>
                <ul class="mt-2 space-y-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  {n().key_quotes.map((q) => (
                    <li>
                      <strong style={{ color: 'var(--text-secondary)' }}>{q.source}:</strong>{' '}
                      "{q.quote}"
                    </li>
                  ))}
                </ul>
              </Show>
              <Show when={n().source === 'heuristic'}>
                <p class="text-[10px] mt-1 italic" style={{ color: 'var(--text-tertiary)' }}>
                  (análisis simplificado, sin LLM disponible)
                </p>
              </Show>
            </div>
          )}
        </Show>
        <OtrasVocesTable
          sources={props.otherSources}
          currentId={props.currentId}
          onSelect={(article) => {
            setSheetOpen(false);
            props.onSelect?.(article);
          }}
        />
      </BottomSheet>
    </Show>
  );
}
