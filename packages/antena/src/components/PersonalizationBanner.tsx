/** @jsxImportSource solid-js */
import { Show, createSignal, onMount } from 'solid-js';
import { useHaptic } from '../lib/haptic';
import MaterialIcon from './common/MaterialIcon';

interface PersonalizationBannerProps {
  /** True if no city is selected (suggests "fijá tu ciudad") */
  showCityHint: boolean;
  /** True if the user has zero followed sources */
  showFollowHint: boolean;
  /** True if the user has zero selected categories (only show after 3+ visits) */
  showCategoryHint: boolean;
  /** Triggers the full 3-step flow as a modal */
  onOpenOnboarding: () => void;
}

/**
 * Organic personalization. Three small inline banners
 * that appear contextually:
 *
 *   1. "📍 Fijá tu ciudad para ver noticias de tu zona"
 *      — shown above the feed only when no city is set
 *      and the user has scrolled at least 50% (so we
 *      don't show it on first paint)
 *
 *   2. "📌 Seguí medios para personalizar tu feed"
 *      — shown in the Blindspot section when zero follows
 *
 *   3. "🎯 Filtrá por temas" — shown in the category
 *      filter when no category is active and the user
 *      has visited 3+ times
 *
 * All three can be dismissed for 7 days via localStorage
 * (no annoying "never show again" toggle needed; it just
 * comes back after a week so the user remembers it).
 *
 * None of these block the user. None require action. The
 * user can scroll, read, share, and navigate freely
 * without ever seeing a modal. If they want to personalize,
 * they tap the "Personalizar" button which opens the same
 * 3-step flow as a settings page.
 */
export default function PersonalizationBanner(props: PersonalizationBannerProps) {
  const haptic = useHaptic();
  const [dismissed, setDismissed] = createSignal(false);
  const [scrolled, setScrolled] = createSignal(false);

  onMount(() => {
    // Only show the city hint once the user has actually
    // scrolled (don't appear on first paint — that's the
    // auto-show behavior we're moving away from).
    if (typeof window === 'undefined') return;
    const onScroll = () => {
      const docH = document.documentElement.scrollHeight - window.innerHeight;
      setScrolled(docH > 0 && window.scrollY > docH * 0.3);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  });

  const dismiss = () => {
    haptic.vibrate('tap');
    setDismissed(true);
    try { localStorage.setItem('antena-personalization-dismissed', String(Date.now() + 7 * 24 * 60 * 60 * 1000)); }
    catch { /* ignore */ }
  };

  // Check the localStorage flag on mount.
  onMount(() => {
    try {
      const until = Number(localStorage.getItem('antena-personalization-dismissed') ?? '0');
      if (until > Date.now()) setDismissed(true);
    } catch { /* ignore */ }
  });

  return (
    <Show when={!dismissed() && (props.showCityHint || props.showFollowHint || props.showCategoryHint) && scrolled()}>
      <aside
        class="mx-4 mb-3 flex items-center gap-3 px-4 py-3 rounded-xl border"
        style={{ background: 'var(--bg-elevated)', 'border-color': 'var(--border-base)' }}
        aria-label="Sugerencia de personalización"
      >
        <MaterialIcon
          name={props.showCityHint ? 'location_on' : props.showFollowHint ? 'group' : 'tune'}
          size="lg"
          class="text-lg shrink-0"
          style={{ color: 'var(--accent)' }}
          aria-hidden="true"
        />
        <p class="text-sm flex-1 min-w-0" style={{ color: 'var(--text-primary)' }}>
          {props.showCityHint && 'Fijá tu ciudad para ver noticias de tu zona.'}
          {props.showFollowHint && 'Seguí algunos medios para personalizar tu feed.'}
          {props.showCategoryHint && 'Filtrá por temas para ver solo lo que te interesa.'}
        </p>
        <button
          type="button"
          onClick={() => { haptic.vibrate('tap'); props.onOpenOnboarding(); }}
          class="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors"
          style={{ background: 'var(--accent)', color: 'var(--bg-base)' }}
        >
          Personalizar
        </button>
        <button
          type="button"
          onClick={dismiss}
          class="shrink-0 p-1.5 rounded-full hover:bg-bg-hover transition-colors"
          aria-label="Cerrar sugerencia"
        >
          <MaterialIcon name="close" size="sm" class="text-sm" style={{ color: 'var(--text-tertiary)' }} aria-hidden="true" />
        </button>
      </aside>
    </Show>
  );
}
