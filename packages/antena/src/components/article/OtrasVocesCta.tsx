/** @jsxImportSource solid-js */
import { createMemo, createSignal, Show } from 'solid-js';
import type { NewsItem } from '../../lib/types';
import { useHaptic } from '../../lib/haptic';
import { createScrollProgress } from '../../lib/scroll-progress';
import { trackEvent } from '../../lib/analytics';
import BottomSheet from '../common/BottomSheet';
import MaterialIcon from '../common/MaterialIcon';
import OtrasVocesTable from './OtrasVocesTable';

interface OtrasVocesCtaProps {
  otherSources: NewsItem[];
  currentId: string;
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

  // Pre-compute the source labels for the CTA copy
  const topSources = createMemo(() =>
    props.otherSources
      .slice(0, 3)
      .map((a) => a.source)
  );
  const overflow = createMemo(() =>
    Math.max(0, props.otherSources.length - 3)
  );

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
          class="fixed left-0 right-0 z-30 mx-4 flex justify-center pointer-events-none"
          style={{ bottom: 'calc(var(--bottom-nav-height, 60px) + 12px)' }}
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
