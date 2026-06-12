/** @jsxImportSource solid-js */
import { For } from 'solid-js';
import type { NewsItem } from '../../lib/types';
import SourceLogo from '../common/SourceLogo';

export interface FeaturedStoryProps {
  primary: NewsItem;
  clusterId: string;
  sourcesCount: number;
  sourceNames: string[];
  onClick: () => void;
}

const CAT_COLOR: Record<string, string> = {
  'Política': 'var(--cat-politica)',
  'Economía': 'var(--cat-economia)',
  'Deportes': 'var(--cat-deportes)',
  'Policiales': 'var(--cat-policiales)',
  'Cultura': 'var(--cat-cultura)',
  'Tecnología': 'var(--cat-tecnologia)',
  'Sociedad': 'var(--cat-sociedad)',
  'Internacional': 'var(--cat-internacional)',
  'Clima': '#0EA5E9',
  'Espectáculos': '#EC4899',
};

function catColor(cat: string): string {
  return CAT_COLOR[cat] || 'var(--accent)';
}

export default function FeaturedStory(props: FeaturedStoryProps) {
  const category = () => props.primary.category || 'General';
  const marqueeNames = () => (props.sourceNames || []).slice(0, 5);
  const sourcesText = () => {
    const n = props.sourcesCount || 1;
    if (n === 1) return '1 medio cubre esto';
    return `${n} medios cubren esto`;
  };

  return (
    <button
      onClick={props.onClick}
      class="relative w-full text-left rounded-[var(--radius-lg)] border border-border-base overflow-hidden transition-all duration-200 hover:shadow-md active:scale-[1.005]"
      style={{
        background: 'var(--bg-elevated)',
        'box-shadow': 'var(--shadow-card)',
      }}
      aria-label={props.primary.title}
    >
      <div
        class="absolute top-0 left-0 right-0 h-1"
        style={{
          background: 'linear-gradient(90deg, var(--accent) 0%, var(--bias-opposition) 50%, var(--bias-officialist) 100%)',
        }}
        aria-hidden="true"
      />
      <div class="p-4 pt-5">
        <div class="flex items-center gap-2 mb-2">
          <span
            class="text-[10px] font-extrabold uppercase tracking-widest"
            style={{ color: catColor(category()) }}
          >
            {category()}
          </span>
          <span
            class="text-[10px] font-bold uppercase tracking-wider"
            style={{ color: 'var(--text-tertiary)' }}
          >
            · Destacado
          </span>
        </div>
        <h2
          class="text-xl font-bold leading-snug mb-1.5"
          style={{ color: 'var(--text-primary)' }}
        >
          {props.primary.title}
        </h2>
        <p
          class="text-sm leading-relaxed line-clamp-2"
          style={{ color: 'var(--text-secondary)' }}
        >
          {props.primary.summary}
        </p>
        <div class="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-border-base/40">
          <span
            class="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full"
            style={{
              background: 'var(--accent-muted)',
              color: 'var(--accent)',
            }}
          >
            {sourcesText()}
          </span>
          <div class="flex items-center -space-x-2">
            <For each={marqueeNames()}>
              {(name) => (
                <SourceLogo
                  source={name}
                  size={24}
                  showBiasDot={false}
                />
              )}
            </For>
            <span
              class="ml-3 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {props.primary.time}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
