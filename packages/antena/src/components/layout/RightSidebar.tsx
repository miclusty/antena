/** @jsxImportSource solid-js */
import { For, Show, createMemo } from 'solid-js';
import type { NewsItem } from '../../lib/types';
import MaterialIcon from '../common/MaterialIcon';

interface RightSidebarProps {
  news: NewsItem[];
  onNewsClick: (n: NewsItem) => void;
  totalNews: number;
}

const CAT_COLORS: Record<string, string> = {
  'Política': '#FF4D5A',
  'Economía': '#F59E0B',
  'Deportes': '#10B981',
  'Policiales': '#EF4444',
  'Cultura': '#8B5CF6',
  'Tecnología': '#3B82F6',
  'Sociedad': '#06B6D4',
  'Internacional': '#6366F1',
  'Clima': '#0EA5E9',
  'Espectáculos': '#EC4899',
};

function Card(p: { title: string; icon: string; children: any; accent?: boolean }) {
  return (
    <div
      class="rounded-2xl border border-border-base overflow-hidden"
      style={{
        'background-color': 'var(--bg-elevated)',
        'box-shadow': 'var(--shadow-card)',
      }}
    >
      <div
        class="px-4 py-3 flex items-center gap-2 border-b border-border-base"
        style={{ 'background-color': 'var(--bg-base)' }}
      >
        <span
          class="w-[2px] h-3 rounded-full shrink-0"
          style={{ 'background-color': 'var(--accent)' }}
          aria-hidden="true"
        />
        <h3 class="text-[12px] xl:text-[13px] font-extrabold uppercase tracking-widest text-text-tertiary flex items-center gap-1.5">
          <MaterialIcon name={p.icon} size="xs" class="text-[14px] xl:text-[16px] " style={{ color: p.accent ? 'var(--accent)' : 'var(--text-tertiary)', 'font-variation-settings': "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 18", }} />
          {p.title}
        </h3>
      </div>
      {p.children}
    </div>
  );
}

function BiasBar(props: { news: NewsItem[] }) {
  const distribution = createMemo(() => {
    let off = 0, neu = 0, opp = 0, total = 0;
    for (const n of props.news) {
      if (n.biasScore === null || n.biasScore === undefined) { neu += 0.5; total += 0.5; continue; }
      total += 1;
      if (n.biasScore > 0.1) off += 1;
      else if (n.biasScore < -0.1) opp += 1;
      else neu += 1;
    }
    const t = total || 1;
    return {
      off: Math.round((off / t) * 100),
      neu: Math.round((neu / t) * 100),
      opp: Math.round((opp / t) * 100),
      avg: props.news.reduce((s, n) => s + (n.biasScore || 0), 0) / (props.news.length || 1),
    };
  });

  return (
    <div class="px-4 py-3 space-y-2">
      <div class="flex h-2 rounded-full overflow-hidden" style={{ 'background-color': 'var(--bg-hover)' }}>
        <Show when={distribution().off > 0}>
          <div style={{ 'background-color': 'var(--bias-officialist)', width: `${distribution().off}%` }} />
        </Show>
        <Show when={distribution().neu > 0}>
          <div style={{ 'background-color': 'var(--bias-neutral)', width: `${distribution().neu}%` }} />
        </Show>
        <Show when={distribution().opp > 0}>
          <div style={{ 'background-color': 'var(--bias-opposition)', width: `${distribution().opp}%` }} />
        </Show>
      </div>
      <div class="flex items-center justify-between text-[13px] xl:text-[14px] tabular-nums">
        <span style={{ color: 'var(--bias-officialist-dk)' }}>Of. {distribution().off}%</span>
        <span class="text-text-tertiary">Neu. {distribution().neu}%</span>
        <span style={{ color: 'var(--bias-opposition-dk)' }}>Op. {distribution().opp}%</span>
      </div>
      <p class="text-[12px] xl:text-[13px] text-text-tertiary text-center">
        Promedio del feed: {distribution().avg >= 0 ? '+' : ''}{distribution().avg.toFixed(2)}
      </p>
    </div>
  );
}

function ReadingInsight(props: { news: NewsItem[] }) {
  const stats = createMemo(() => {
    const sources = new Set(props.news.map(n => n.source));
    const totalChars = props.news.reduce((s, n) => s + (n.summary?.length || 0), 0);
    const minRead = Math.max(1, Math.round(totalChars / 1200));
    return { count: props.news.length, sourceCount: sources.size, minRead };
  });

  return (
    <div class="px-4 py-3 space-y-2">
      <p class="text-[14px] xl:text-[15px] text-text-primary leading-snug">
        Hoy leíste <strong class="text-accent">{stats().count}</strong> historias de{' '}
        <strong class="text-accent">{stats().sourceCount}</strong> medios distintos.
      </p>
      <div class="flex items-center gap-2 text-[13px] xl:text-[14px] text-text-tertiary">
        <MaterialIcon name="schedule" size="base" class="text-[16px] xl:text-[18px] " style={{ }} />
        <span>~{stats().minRead} min de lectura estimada</span>
      </div>
    </div>
  );
}

function topSourceBias(news: NewsItem[]): { name: string; bias: number | null; count: number }[] {
  const map = new Map<string, { name: string; count: number; biasTotal: number; biasN: number }>();
  for (const n of news) {
    const e = map.get(n.source) || { name: n.source, count: 0, biasTotal: 0, biasN: 0 };
    e.count += 1;
    if (n.biasScore !== null && n.biasScore !== undefined) {
      e.biasTotal += n.biasScore;
      e.biasN += 1;
    }
    map.set(n.source, e);
  }
  return Array.from(map.values())
    .map(e => ({ name: e.name, count: e.count, bias: e.biasN > 0 ? e.biasTotal / e.biasN : null }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);
}

function biasColor(score: number | null): string {
  if (score === null) return 'var(--text-tertiary)';
  if (score > 0.1) return 'var(--bias-officialist)';
  if (score < -0.1) return 'var(--bias-opposition)';
  return 'var(--bias-neutral)';
}

export default function RightSidebar(props: RightSidebarProps) {
  const trending = createMemo(() =>
    props.news
      .filter(n => n.sourcesCount > 1)
      .sort((a, b) => b.sourcesCount - a.sourcesCount)
      .slice(0, 5)
  );

  const topSources = createMemo(() => topSourceBias(props.news));

  return (
    <aside
      class="hidden xl:flex flex-col w-[380px] shrink-0"
      style={{ 'min-height': 'calc(100vh - 56px)' }}
    >
      <div
        class="sticky top-14 p-4 space-y-4 flex-1 overflow-y-auto"
        style={{ 'max-height': 'calc(100vh - 56px)' }}
      >
        {/* ── Sesgo del día ── */}
        <Card title="Sesgo del día" icon="balance" accent>
          <BiasBar news={props.news} />
        </Card>

        {/* ── Lo más visto (trending) ── */}
        <Card title="Lo más visto" icon="trending_up">
          <Show
            when={trending().length > 0}
            fallback={
              <p class="px-4 py-4 text-[14px] xl:text-[15px] text-text-tertiary">
                Las historias más leídas aparecerán acá.
              </p>
            }
          >
            <For each={trending()}>
              {(n, i) => (
                <button
                  onClick={() => props.onNewsClick(n)}
                  class="w-full text-left px-4 py-3 hover:bg-bg-hover transition-colors border-t border-border-base flex gap-3 items-start"
                >
                  <span
                    class="text-[20px] xl:text-[22px] font-extrabold text-text-tertiary tabular-nums shrink-0"
                    style={{ 'min-width': '20px' }}
                  >
                    {i() + 1}
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5 mb-0.5">
                      <span
                        class="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ 'background-color': CAT_COLORS[n.category] || 'var(--text-tertiary)' }}
                      />
                      <span class="text-[12px] xl:text-[13px] text-text-tertiary font-medium uppercase tracking-wider">
                        {n.category}
                      </span>
                    </div>
                    <p class="text-[15px] xl:text-[16px] font-bold text-text-primary line-clamp-2 leading-snug">
                      {n.title}
                    </p>
                  </div>
                </button>
              )}
            </For>
          </Show>
        </Card>

        {/* ── Lectura del día ── */}
        <Show when={props.news.length > 0}>
          <Card title="Lectura del día" icon="auto_stories">
            <ReadingInsight news={props.news} />
          </Card>
        </Show>

        {/* ── Top medios ── */}
        <Show when={topSources().length > 0}>
          <Card title="Top medios" icon="radio">
            <ul class="divide-y divide-border-base">
              <For each={topSources()}>
                {(s) => (
                  <li class="px-4 py-2.5 flex items-center gap-2.5">
                    <span
                      class="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ 'background-color': biasColor(s.bias) }}
                    />
                    <span class="text-[15px] xl:text-[16px] font-semibold text-text-primary flex-1 truncate">{s.name}</span>
                    <span class="text-[13px] xl:text-[14px] text-text-tertiary tabular-nums">
                      {s.bias === null ? '·' : (s.bias > 0 ? '+' : '') + s.bias!.toFixed(2)}
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Card>
        </Show>

        {/* ── Footer ── */}
        <div class="text-[12px] xl:text-[13px] text-text-tertiary px-2 space-y-1 pt-2">
          <p class="flex items-center gap-1.5">
            <MaterialIcon name="radio" size="base" class="text-[14px] " style={{ color: 'var(--accent)' }} />
            <span class="font-extrabold text-text-secondary">Antena v0.1</span>
          </p>
          <p class="leading-relaxed">
            {props.totalNews.toLocaleString()} noticias · open source · 100% en Cloudflare
          </p>
        </div>
      </div>
    </aside>
  );
}
