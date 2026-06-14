/** @jsxImportSource solid-js */
import type { NewsItem } from '../../lib/types';
import { getBiasGradientColor } from '../../lib/bias';
import MaterialIcon from '../common/MaterialIcon';

interface FeaturedClusterProps {
  news: NewsItem;
  onClick: () => void;
}

export default function FeaturedCluster(props: FeaturedClusterProps) {
  const biasColor = () => props.news.biasGradientColor || getBiasGradientColor(props.news.biasScore ?? 0);
  const sourceCount = () => props.news.sourcesCount || 1;

  return (
    <button
      onClick={props.onClick}
      class="flex items-center gap-3 px-3 py-2 rounded-lg border border-border-base hover:border-accent/40 transition-colors w-full text-left"
      style={{ background: 'var(--bg-elevated)' }}
    >
      {/* Bias indicator dot */}
      <span class="w-2 h-2 rounded-full shrink-0" style={{ 'background-color': biasColor() }} />

      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>Tendencia</span>
          <span class="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{sourceCount()} fuentes</span>
        </div>
        <p class="text-xs font-medium mt-0.5 line-clamp-1" style={{ color: 'var(--text-primary)' }}>
          {props.news.title}
        </p>
      </div>

      <MaterialIcon name="arrow_forward" size="lg" class="text-lg " style={{ color: 'var(--text-tertiary)' }} />
    </button>
  );
}
