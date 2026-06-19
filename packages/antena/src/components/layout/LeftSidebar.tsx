/** @jsxImportSource solid-js */
import { For, createMemo, Show } from 'solid-js';
import type { NewsItem } from '../../lib/types';
import LocationSelector from '../common/LocationSelector';
import SourceLogo from '../common/SourceLogo';
import { useHaptic } from '../../lib/haptic';
import { updateURL } from '../../lib/urlState';
import { scoreToBiasVar } from '../../lib/bias';
import MaterialIcon from '../common/MaterialIcon';

interface LeftSidebarProps {
  activeCategory: string;
  onCategoryChange: (cat: string) => void;
  activeLocation: string | null;
  onLocationChange: (loc: string | null) => void;
  categories: { name: string; icon: string; slug: string }[];
  stats: { total_news: number; active_sources: number; total_locations: number };
  news: NewsItem[];
  savedCount: number;
  bookmarks: string[];
  followsCount: number;
  feedTab: string;
  onFeedTabChange: (tab: string) => void;
  onOpenBookmarks: () => void;
  onOpenReadLater: () => void;
  onOpenHistory: () => void;
  readLaterCount: number;
}

const CAT_COLORS: Record<string, string> = {
  'Todas': '#9C9890',
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

const CAT_ICONS: Record<string, string> = {
  'Todas': 'home',
  'Política': 'gavel',
  'Economía': 'trending_up',
  'Deportes': 'sports_soccer',
  'Policiales': 'local_police',
  'Cultura': 'theater_comedy',
  'Tecnología': 'devices',
  'Sociedad': 'groups',
  'Internacional': 'public',
  'Clima': 'cloud',
  'Espectáculos': 'theaters',
};

function countByCategory(news: NewsItem[], cat: string): number {
  if (cat === 'Todas') return news.length;
  return news.filter(n => n.category === cat).length;
}

function countBySource(news: NewsItem[]): { name: string; count: number; bias: number | null }[] {
  const map = new Map<string, { name: string; count: number; biasTotal: number; biasN: number }>();
  for (const n of news) {
    const key = n.source;
    const entry = map.get(key) || { name: key, count: 0, biasTotal: 0, biasN: 0 };
    entry.count += 1;
    if (n.biasScore !== null && n.biasScore !== undefined) {
      entry.biasTotal += n.biasScore;
      entry.biasN += 1;
    }
    map.set(key, entry);
  }
  return Array.from(map.values())
    .map(e => ({ name: e.name, count: e.count, bias: e.biasN > 0 ? e.biasTotal / e.biasN : null }))
    .sort((a, b) => b.count - a.count);
}

function biasColor(score: number | null): string {
  return scoreToBiasVar(score);
}

function SectionLabel(p: { children: any }) {
  return (
    <div class="flex items-center gap-2 px-2 mb-2.5">
      <span
        class="w-[2px] h-3 rounded-full shrink-0"
        style={{ 'background-color': 'var(--accent)' }}
        aria-hidden="true"
      />
      <p class="text-[12px] xl:text-[13px] font-extrabold text-text-tertiary uppercase tracking-widest">
        {p.children}
      </p>
    </div>
  );
}

function SideRow(p: {
  icon: string;
  label: string;
  count?: string | number;
  active?: boolean;
  dimmed?: boolean;
  dotColor?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={p.onClick}
      class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[16px] xl:text-[17px] transition-all text-left group relative"
      style={p.active
        ? { 'background-color': 'var(--accent-muted)', color: 'var(--accent)' }
        : { color: p.dimmed ? 'var(--text-tertiary)' : 'var(--text-primary)' }
      }
    >
      <Show when={p.dotColor} fallback={
        <MaterialIcon name={p.icon} size="lg" class="text-[20px] xl:text-[22px] shrink-0" style={{ color: p.active ? 'var(--accent)' : (p.dimmed ? 'var(--text-tertiary)' : 'var(--text-secondary)'), 'font-variation-settings': p.active ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 20" : "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20", }} />
      }>
        <span
          class="w-2.5 h-2.5 rounded-full shrink-0 transition-transform group-hover:scale-125"
          style={{ 'background-color': p.dotColor }}
        />
      </Show>
      <span style={p.active ? { 'font-weight': '600' } : {}}>{p.label}</span>
      <Show when={p.count !== undefined}>
        <span
          class="ml-auto text-[14px] xl:text-[15px] tabular-nums"
          style={{ color: p.active ? 'var(--accent)' : 'var(--text-tertiary)' }}
        >
          {p.count}
        </span>
      </Show>
    </button>
  );
}

export default function LeftSidebar(props: LeftSidebarProps) {
  const haptic = useHaptic();

  const todaysCount = createMemo(() => {
    const day = 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - day;
    return props.news.filter(n => {
      const t = new Date(n.publishedAt).getTime();
      return t >= cutoff;
    }).length;
  });

  const topSources = createMemo(() => countBySource(props.news).slice(0, 5));

  return (
    <aside
      class="hidden xl:flex flex-col w-[320px] shrink-0 border-r border-border-base"
      style={{ 'min-height': 'calc(100vh - 56px)' }}
    >
      <div class="sticky top-14 p-4 space-y-6 flex-1 overflow-y-auto" style={{ 'max-height': 'calc(100vh - 56px)' }}>
        {/* ── Tu Antena (profile + quick stats) ── */}
        <section>
          <div class="flex items-center gap-3 px-1.5 py-1 mb-3">
            <div
              class="w-11 h-11 rounded-full flex items-center justify-center text-[15px] font-extrabold text-white shrink-0"
              style={{
                background: 'linear-gradient(135deg, var(--accent) 0%, #F5C542 100%)',
                'box-shadow': '0 0 0 2px var(--accent-ring)',
              }}
            >
              A
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-[16px] xl:text-[17px] font-extrabold text-text-primary leading-tight">Hola, visitante</p>
              <a class="text-[13px] xl:text-[14px] text-text-tertiary hover:text-accent" style={{ 'text-decoration': 'underline' }}>Iniciá sesión</a>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2 px-1">
            <div class="rounded-lg border border-border-base px-3 py-2" style={{ 'background-color': 'var(--bg-elevated)' }}>
              <p class="text-[12px] xl:text-[13px] text-text-tertiary uppercase tracking-wider font-semibold">Hoy</p>
              <p class="text-[20px] xl:text-[22px] font-extrabold text-text-primary tabular-nums leading-none mt-1">{todaysCount()}</p>
              <p class="text-[12px] xl:text-[13px] text-text-tertiary mt-0.5">notas</p>
            </div>
            <div class="rounded-lg border border-border-base px-3 py-2" style={{ 'background-color': 'var(--bg-elevated)' }}>
              <p class="text-[12px] xl:text-[13px] text-text-tertiary uppercase tracking-wider font-semibold">Medios</p>
              <p class="text-[20px] xl:text-[22px] font-extrabold text-text-primary tabular-nums leading-none mt-1">{props.stats.active_sources}</p>
              <p class="text-[12px] xl:text-[13px] text-text-tertiary mt-0.5">activos</p>
            </div>
          </div>
        </section>

        {/* ── Mi actividad ── */}
        <nav class="pt-6 border-t border-border-base">
          <SectionLabel>Mi actividad</SectionLabel>
          <div class="space-y-0.5">
            <SideRow
              icon="home"
              label="Inicio"
              count={todaysCount()}
              active={props.feedTab === 'home'}
              onClick={() => { haptic.vibrate('tap'); props.onFeedTabChange('home'); }}
            />
            <SideRow
              icon="recommend"
              label="Para vos"
              count={props.news.length}
              active={props.feedTab === 'foryou'}
              dimmed={props.news.length === 0}
              onClick={() => { haptic.vibrate('tap'); props.onFeedTabChange('foryou'); }}
            />
            <SideRow
              icon="group"
              label="Siguiendo"
              count={props.followsCount ?? 0}
              dimmed={(props.followsCount ?? 0) === 0}
              onClick={() => { haptic.vibrate('tap'); props.onFeedTabChange('following'); }}
            />
            <SideRow
              icon="bookmark"
              label="Guardados"
              count={props.savedCount}
              onClick={() => { haptic.vibrate('tap'); props.onOpenBookmarks(); }}
            />
            <SideRow
              icon="schedule"
              label="Leer después"
              count={props.readLaterCount}
              onClick={() => { haptic.vibrate('tap'); props.onOpenReadLater(); }}
            />
            <SideRow
              icon="history"
              label="Historial"
              count={(() => {
                if (typeof window === 'undefined') return 0;
                try { return JSON.parse(localStorage.getItem('antena-history') || '[]').length; } catch { return 0; }
              })()}
              onClick={() => { haptic.vibrate('tap'); props.onOpenHistory(); }}
            />
          </div>
        </nav>

        {/* ── Explorar (categories with counts) ── */}
        <nav class="pt-6 border-t border-border-base">
          <SectionLabel>Explorar</SectionLabel>
          <div class="space-y-0.5">
            <For each={props.categories}>
              {(cat) => {
                const isActive = props.activeCategory === cat.name;
                const cnt = countByCategory(props.news, cat.name);
                const dim = cnt === 0;
                return (
                  <SideRow
                    icon={CAT_ICONS[cat.name] || 'category'}
                    label={cat.name}
                    count={cnt}
                    active={isActive}
                    dimmed={dim && !isActive}
                    dotColor={cat.name === 'Todas' ? undefined : (CAT_COLORS[cat.name] || 'var(--text-tertiary)')}
                    onClick={() => {
                      haptic.vibrate('tap');
                      props.onCategoryChange(cat.name);
                      updateURL({ cat: cat.name === 'Todas' ? null : cat.name });
                    }}
                  />
                );
              }}
            </For>
          </div>
        </nav>

        {/* ── Medios (top sources) ── */}
        <Show when={topSources().length > 0}>
          <nav class="pt-6 border-t border-border-base">
            <SectionLabel>Medios</SectionLabel>
            <div class="space-y-0.5">
              <For each={topSources()}>
                {(src) => (
                  <div
                    class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[16px] xl:text-[17px] text-text-primary"
                  >
                    <SourceLogo
                      source={src.name}
                      biasScore={src.bias ?? null}
                      size={24}
                      showBiasDot={false}
                    />
                    <span class="flex-1 min-w-0 truncate font-medium">{src.name}</span>
                    <span
                      class="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ 'background-color': biasColor(src.bias) }}
                      aria-hidden="true"
                    />
                    <span
                      class="text-[14px] xl:text-[15px] tabular-nums"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {src.count}
                    </span>
                  </div>
                )}
              </For>
              <a
                href="/medios/"
                class="block w-full text-left text-[13px] xl:text-[14px] text-accent font-semibold px-2.5 py-1.5 hover:underline"
              >
                Ver todos ({props.stats.active_sources}) →
              </a>
            </div>
          </nav>
        </Show>

        {/* ── Location selector (collapsed) ── */}
        <section class="pt-6 border-t border-border-base">
          <SectionLabel>Ubicación</SectionLabel>
          <LocationSelector
            activeLocation={props.activeLocation}
            onLocationChange={props.onLocationChange}
          />
        </section>

        {/* ── Footer link ── */}
        <div class="pt-6 border-t border-border-base">
          <a
            href="/settings"
            class="flex items-center gap-2 px-2.5 py-2 text-[14px] xl:text-[15px] text-text-tertiary hover:text-accent transition-colors"
          >
            <MaterialIcon name="settings" size="base" class="text-[18px] xl:text-[20px] " style={{ }} />
            <span>Configuración</span>
          </a>
        </div>
      </div>
    </aside>
  );
}
