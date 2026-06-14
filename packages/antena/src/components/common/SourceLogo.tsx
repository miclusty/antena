/** @jsxImportSource solid-js */
import { Show } from 'solid-js';

export interface SourceLogoProps {
  source: string;
  biasScore?: number | null;
  size?: number;
  showBiasDot?: boolean;
  /** When set (and `onClick` is also provided), the logo is
   *  clickable and routes to the source profile. Inert when
   *  null so bare logos don't navigate spuriously. */
  sourceId?: number | null;
  onClick?: (sourceId: number) => void;
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function hueFromSource(s: string): number {
  return hashStr(s) % 360;
}

function initials(source: string): string {
  const cleaned = source.trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return ((parts[0]![0] || '') + (parts[1]![0] || '')).toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

function biasColor(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'var(--bias-neutral)';
  if (score > 0.1) return 'var(--bias-officialist)';
  if (score < -0.1) return 'var(--bias-opposition)';
  return 'var(--bias-neutral)';
}

export default function SourceLogo(props: SourceLogoProps) {
  const size = () => props.size ?? 32;
  const showDot = () => props.showBiasDot !== false;

  const fontSize = () => Math.max(10, Math.round(size() * 0.4));
  const dotSize = () => Math.max(6, Math.round(size() * 0.22));
  const dotOffset = () => Math.max(0, Math.round(size() * 0.06));

  const isClickable = () => !!(props.onClick && props.sourceId);

  return (
    <div
      class={`relative inline-flex items-center justify-center rounded-full overflow-hidden shrink-0 ${isClickable() ? "cursor-pointer hover:opacity-80 active:scale-95 transition-all" : ""}`}
      onClick={isClickable() ? (e) => { e.stopPropagation(); props.onClick!(props.sourceId!); } : undefined}
      role={isClickable() ? "button" : undefined}
      tabIndex={isClickable() ? 0 : undefined}
      onKeyDown={isClickable() ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onClick!(props.sourceId!); } } : undefined}
      style={{
        width: `${size()}px`,
        height: `${size()}px`,
        background: `hsl(${hueFromSource(props.source)}, 65%, 50%)`,
        color: '#fff',
        'font-size': `${fontSize()}px`,
        'font-weight': '700',
        'line-height': '1',
        'letter-spacing': '0.02em',
      }}
      aria-label={props.source}
      title={props.source}
    >
      <span>{initials(props.source)}</span>
      <Show when={showDot()}>
        <span
          class="absolute rounded-full border-2"
          style={{
            width: `${dotSize()}px`,
            height: `${dotSize()}px`,
            bottom: `${dotOffset()}px`,
            right: `${dotOffset()}px`,
            'background-color': biasColor(props.biasScore ?? null),
            'border-color': 'var(--bg-elevated)',
          }}
          aria-hidden="true"
        />
      </Show>
    </div>
  );
}
