/** @jsxImportSource solid-js */
import { Show } from 'solid-js';
import MaterialIcon from '../common/MaterialIcon';

type IconKey = 'antenna' | 'signal' | 'radio' | 'wave' | 'satellite' | 'search' | 'bookmark';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  class?: string;
}

function AntennaIcon() {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="36" y1="64" x2="36" y2="40" />
      <line x1="22" y1="64" x2="50" y2="64" />
      <path d="M36 40 L18 16" />
      <path d="M36 40 L54 16" />
      <circle cx="36" cy="36" r="3" fill="currentColor" />
      <path d="M28 32 Q24 28 28 22" />
      <path d="M44 32 Q48 28 44 22" />
    </svg>
  );
}

function SignalIcon() {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
      <circle cx="36" cy="44" r="3" fill="currentColor" />
      <path d="M26 40 Q22 32 30 22" />
      <path d="M46 40 Q50 32 42 22" />
      <path d="M18 36 Q12 24 24 12" />
      <path d="M54 36 Q60 24 48 12" />
    </svg>
  );
}

function RadioIcon() {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="14" y="20" width="44" height="32" rx="4" />
      <circle cx="24" cy="32" r="2" fill="currentColor" />
      <circle cx="32" cy="32" r="2" fill="currentColor" />
      <line x1="40" y1="28" x2="52" y2="28" />
      <line x1="40" y1="32" x2="50" y2="32" />
      <line x1="40" y1="36" x2="48" y2="36" />
      <line x1="22" y1="56" x2="50" y2="56" />
      <line x1="22" y1="44" x2="38" y2="44" />
      <line x1="42" y1="44" x2="48" y2="44" />
    </svg>
  );
}

function WaveIcon() {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
      <path d="M12 36 Q18 20 24 36 T36 36 T48 36 T60 36" />
      <path d="M12 48 Q18 32 24 48 T36 48 T48 48 T60 48" opacity="0.5" />
    </svg>
  );
}

function SatelliteIcon() {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="28" y="28" width="16" height="16" transform="rotate(45 36 36)" />
      <line x1="14" y1="14" x2="24" y2="24" />
      <line x1="48" y1="48" x2="58" y2="58" />
      <path d="M16 22 Q12 16 18 12" />
      <path d="M56 50 Q60 56 54 60" />
    </svg>
  );
}

function SearchIllustration() {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
      <circle cx="32" cy="32" r="16" />
      <line x1="44" y1="44" x2="58" y2="58" />
      <line x1="26" y1="32" x2="38" y2="32" opacity="0.5" />
    </svg>
  );
}

function BookmarkIllustration() {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M22 14 L50 14 L50 58 L36 46 L22 58 Z" />
      <line x1="28" y1="24" x2="44" y2="24" opacity="0.5" />
      <line x1="28" y1="30" x2="40" y2="30" opacity="0.5" />
    </svg>
  );
}

const ICON_KEYS: ReadonlySet<IconKey> = new Set([
  'antenna', 'signal', 'radio', 'wave', 'satellite', 'search', 'bookmark',
]);

function normalizeIcon(input: string | undefined): IconKey | undefined {
  if (!input) return undefined;
  return ICON_KEYS.has(input as IconKey) ? (input as IconKey) : undefined;
}

function IllustrationFor(props: { icon?: string }) {
  const key = () => normalizeIcon(props.icon);
  return (
    <div
      class="mb-5 inline-flex items-center justify-center w-24 h-24 rounded-full"
      style={{
        background: 'var(--accent-subtle)',
        color: 'var(--accent)',
      }}
    >
      <Show when={key() === 'antenna'}><AntennaIcon /></Show>
      <Show when={key() === 'signal'}><SignalIcon /></Show>
      <Show when={key() === 'radio'}><RadioIcon /></Show>
      <Show when={key() === 'wave'}><WaveIcon /></Show>
      <Show when={key() === 'satellite'}><SatelliteIcon /></Show>
      <Show when={key() === 'search'}><SearchIllustration /></Show>
      <Show when={key() === 'bookmark'}><BookmarkIllustration /></Show>
    </div>
  );
}

export default function EmptyState(props: EmptyStateProps) {
  const hasIllustration = () => !!normalizeIcon(props.icon);
  return (
    <div
      class={`flex flex-col items-center justify-center py-16 px-6 text-center animate-fade-in ${props.class || ''}`}
    >
      <Show when={hasIllustration()}>
        <IllustrationFor icon={props.icon} />
      </Show>
      <Show when={!hasIllustration() && props.icon}>
        <MaterialIcon name={props.icon ?? "help"} size="5xl" class="text-5xl mb-4" style={{ color: 'var(--text-tertiary)', 'font-variation-settings': "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20", opacity: 0.4, }} aria-hidden="true" />
      </Show>
      <h3
        class="text-base font-semibold mb-1.5"
        style={{ color: 'var(--text-primary)' }}
      >
        {props.title}
      </h3>
      <Show when={props.description}>
        <p
          class="text-sm max-w-[300px] leading-relaxed"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {props.description}
        </p>
      </Show>
      <Show when={props.action}>
        <button
          onClick={props.action!.onClick}
          class="mt-5 px-5 min-h-[44px] rounded-full text-sm font-medium transition-all active:scale-95"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          {props.action!.label}
        </button>
      </Show>
    </div>
  );
}
