/** @jsxImportSource solid-js */
import { Show, For, createMemo, createSignal } from "solid-js";
import NewsCard from "../common/NewsCard";
import FeedTabs from "../common/FeedTabs";
import LocationSelector from "../common/LocationSelector";
import EmptyState from "../common/EmptyState";
import SourceLogo from "../common/SourceLogo";
import CitySelector from "../common/CitySelector";
import DensityToggle from "../common/DensityToggle";
import TimeFilters from "../common/TimeFilters";
import QualityFilters from "../common/QualityFilters";
import MaterialIcon from "../common/MaterialIcon";
import FeaturedStory from "./FeaturedStory";
import TrendingSection from "./TrendingSection";
import BlindspotSection from "./BlindspotSection";
import PersonalizationBanner from "../PersonalizationBanner";
import NewsletterSignup from "../NewsletterSignup";
import PullToRefresh from "../PullToRefresh";
import { resolveCustomTabSelection } from "../../lib/feed-controls";
import { CATEGORIES, type Category, type NewsItem } from "../../lib/types";
import type { ApiNewsCard } from "../../lib/api";
import type { TrendingItem, BlindspotItem } from "../../hooks/useFeed";
import { fetchEmerging, type EmergingCluster } from "../../lib/api";
import type { ViewType } from "../../hooks/useUrlState";
import type { Density } from "../../lib/preferences";
import type { FeedFilterState, BiasFilter } from "../../lib/feed-filters";
import { fetchVote, fetchRepost } from "../../lib/api";
import { toast } from "../Toast";

const CAT_COLORS: Record<string, string> = {
  'Política': '#FF4D5A', 'Economía': '#F59E0B', 'Deportes': '#10B981', 'Policiales': '#EF4444',
  'Cultura': '#8B5CF6', 'Tecnología': '#3B82F6', 'Sociedad': '#06B6D4', 'Internacional': '#6366F1',
  'Clima': '#0EA5E9', 'Espectáculos': '#EC4899',
};

const BIAS_LABELS: Record<BiasFilter, string> = {
  all: 'Todos', left: 'Opositor', right: 'Oficialista', neutral: 'Neutral',
};

type Nav = {
  currentView: () => ViewType;
  handleNewsClick: (n: NewsItem) => Promise<void>;
  loadArticleFromId: (id: string) => Promise<void>;
  handleViewChange: (v: ViewType) => void;
};

type FeedHook = {
  mappedNews: () => NewsItem[];
  featuredCluster: () => { primary: NewsItem; clusterId: string; sourcesCount: number; sourceNames: string[] } | null;
  trendingItems: () => TrendingItem[];
  blindspotItems: () => BlindspotItem[];
  blindspotLoading: () => boolean;
  emergingClusterIds: () => Set<string>;
  feed: { error: unknown; loading: boolean };
  offset: () => number;
  searchQuery: () => string;
  setSearchQuery: (q: string) => void;
  resetFeed: () => void;
};

type Filters = {
  filterState: () => FeedFilterState;
  showFilters: () => boolean;
  setShowFilters: (v: boolean | ((s: boolean) => boolean)) => void;
  updateTime: (t: any) => void;
  updateQuality: (q: any) => void;
  updateBias: (b: BiasFilter) => void;
  clearFilters: () => void;
  hasActiveFilters: () => boolean;
  setReset?: (fn: () => void) => void;
};

type Discovery = {
  categories: () => Category[];
  cities: () => Array<{ id: number; name: string; province: string; count: number }>;
  customTabs: () => Array<{ id: string; label: string; category: string }>;
  feedTabsVisible: () => boolean;
  onAddCustomTab: (cat: { slug: string; name: string }) => void;
  onRemoveCustomTab: (tabId: string) => void;
};

type Follows = {
  follows: () => Array<{ sourceId: number; sourceName: string | null; sourceUrl: string | null; sourceDomain: string | null; createdAt: string }>;
  followedIds: () => Set<number>;
};

type Chrome = {
  setOnboardingVisible: (v: boolean) => void;
  setMateMode: (v: boolean) => void;
  mateMode: () => boolean;
};

export type FeedViewProps = {
  // signals
  activeCategory: () => string;
  setActiveCategory: (v: string) => void;
  activeLocation: () => string | null;
  setActiveLocation: (v: string | null) => void;
  activeFeedTab: () => string;
  setActiveFeedTab: (id: string) => void;
  density: () => Density;
  updateDensity: (d: Density) => void;
  // hooks
  feedHook: FeedHook;
  filters: Filters;
  discovery: Discovery;
  follows: Follows;
  chrome: Chrome;
  nav: Nav;
  // handlers
  haptic: { vibrate: (kind?: any) => void };
  setObserverTarget: (el: HTMLElement) => void;
  updateURL: (params: { cat?: string | null; loc?: string | null }) => void;
  shareNews: (n: NewsItem) => Promise<void>;
  toggleBookmark: (id: string) => void;
};

export default function FeedView(props: FeedViewProps) {
  // ─── Emerging row (S3.9) ──────────────────────────────────────
  // Pulled ONCE per minute, independent of the feed — lets us show
  // the "🚨 Emergente" overlay even when the main feed is paused
  // (Following, etc.). On error or empty, we render nothing and
  // the existing TrendingSection takes over.
  const [emergingItems, setEmergingItems] = createSignal<EmergingCluster[]>([]);
  const refreshEmergingRow = async () => {
    try {
      const r = await fetchEmerging(6, 0);
      setEmergingItems(r?.emerging?.slice(0, 4) ?? []);
    } catch {
      setEmergingItems([]);
    }
  };
  if (typeof window !== "undefined") {
    queueMicrotask(refreshEmergingRow);
    setInterval(refreshEmergingRow, 60 * 1000);
  }
  const openArticleFromCluster = async (clusterId: string) => {
    // Find any news card in the current feed that belongs to the
    // given cluster. If none, bail (the cluster may have expired
    // since the last refresh).
    const match = props.feedHook.mappedNews().find((n) => n.clusterId === clusterId);
    if (match) await props.nav.handleNewsClick(match);
  };

  const onTabChange = (tabId: string) => {
    props.haptic.vibrate('tap');
    props.setActiveFeedTab(tabId);
    const resolved = resolveCustomTabSelection(
      tabId,
      props.discovery.categories().map((c) => ({ name: c.name, slug: c.slug })),
    );
    if (resolved.categoryName) props.setActiveCategory(resolved.categoryName);
    else if (tabId !== props.activeFeedTab()) props.setActiveCategory('Todas');
    if (resolved.shouldReset) props.feedHook.resetFeed();
  };

  const onAddCustomTab = (cat: { slug: string; name: string }) => {
    props.discovery.onAddCustomTab(cat);
    props.haptic.vibrate('tap');
    props.setActiveFeedTab(`cat:${cat.slug}`);
    props.setActiveCategory(cat.name);
  };

  const onRemoveCustomTab = (tabId: string) => {
    props.discovery.onRemoveCustomTab(tabId);
    if (props.activeFeedTab() === tabId) props.setActiveFeedTab('home');
  };

  const onNewsClick = (item: NewsItem) => props.nav.handleNewsClick(item);

  return (
    <Show when={props.nav.currentView() === 'feed'}>
      <FeedTabs
        activeTab={props.activeFeedTab()}
        onTabChange={onTabChange}
        customTabs={props.discovery.customTabs()}
        onAddCustomTab={onAddCustomTab}
        onRemoveCustomTab={onRemoveCustomTab}
        availableCategories={CATEGORIES.filter((c) => c.slug !== 'all')}
        visible={props.discovery.feedTabsVisible()}
      />

      <div class="xl:hidden">
        <div class="px-4 py-2">
          <LocationSelector
            activeLocation={props.activeLocation()}
            onLocationChange={(locId) => {
              props.setActiveLocation(locId);
              props.updateURL({ loc: locId });
              props.nav.handleViewChange('feed');
              props.feedHook.resetFeed();
            }}
          />
        </div>
        <div class="px-4 pb-2 flex items-center gap-2 overflow-x-auto scrollbar-hide">
          {props.discovery.categories().map((cat) => {
            const color = CAT_COLORS[cat.name];
            const isActive = props.activeCategory() === cat.name;
            return (
              <button
                onClick={() => {
                  props.haptic.vibrate('tap');
                  props.setActiveCategory(cat.name);
                  props.updateURL({ cat: cat.name === 'Todas' ? null : cat.name });
                  props.feedHook.resetFeed();
                }}
                class="text-xs font-semibold px-3 py-1.5 rounded-full border whitespace-nowrap transition-all"
                style={isActive
                  ? { 'background-color': color || 'var(--text-primary)', 'border-color': color || 'var(--text-primary)', color: 'var(--accent-fg)' }
                  : { 'border-color': 'var(--border)', color: 'var(--text-secondary)' }
                }
              >
                {cat.name}
              </button>
            );
          })}
        </div>
      </div>

      <Show
        when={!props.feedHook.feed.error}
        fallback={
          <div class="px-4 py-8">
            <EmptyState
              icon="wifi_off"
              title="No se pudieron cargar las noticias"
              description="Revisá tu conexión a internet y volvé a intentarlo."
              action={{ label: 'Reintentar', onClick: () => { props.feedHook.resetFeed(); } }}
            />
          </div>
        }
      >
        <Show
          when={!props.feedHook.feed.loading || props.feedHook.offset() > 0}
          fallback={
            <div class="px-4">
              <div class="flex flex-col">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div class="border-b border-border-base px-4 py-4">
                    <div class="flex items-center gap-3 mb-4">
                      <div class="w-10 h-10 rounded-full bg-bg-hover animate-pulse" />
                      <div class="flex-1">
                        <div class="h-3 w-24 bg-bg-hover rounded animate-pulse mb-1.5" />
                        <div class="h-2.5 w-16 bg-bg-hover rounded animate-pulse" />
                      </div>
                    </div>
                    <div class="h-4 w-3/4 bg-bg-hover rounded animate-pulse mb-2" />
                    <div class="h-3 w-1/2 bg-bg-hover rounded animate-pulse mb-3" />
                  </div>
                ))}
              </div>
            </div>
          }
        >
          <Show
            when={props.feedHook.mappedNews().length > 0}
            fallback={
              <div class="px-4 py-8">
                <EmptyState
                  icon={props.activeFeedTab() === 'following' && props.follows.followedIds().size === 0 ? 'person_add' : 'inbox'}
                  title={
                    props.activeFeedTab() === 'following' && props.follows.followedIds().size === 0
                      ? 'Tu Siguiendo está vacío'
                      : `No hay noticias en ${props.activeCategory()}`
                  }
                  description={
                    props.activeFeedTab() === 'following' && props.follows.followedIds().size === 0
                      ? 'Seguí medios para personalizar tu feed. Cuantos más sigas, mejores recomendaciones vas a ver.'
                      : (props.activeLocation()
                        ? 'Probá con otra ubicación o quitá el filtro.'
                        : 'Probá con otra categoría o esperá unos minutos.')
                  }
                  action={(() => {
                    if (props.activeFeedTab() === 'following' && props.follows.followedIds().size === 0) {
                      return { label: 'Descubrir medios', onClick: () => props.nav.handleViewChange('feed') };
                    }
                    if (props.feedHook.searchQuery()) {
                      return { label: 'Limpiar búsqueda', onClick: () => props.feedHook.setSearchQuery('') };
                    }
                    return {
                      label: 'Ver todas',
                      onClick: () => {
                        props.setActiveCategory('Todas');
                        props.updateURL({ cat: null });
                        props.feedHook.resetFeed();
                      },
                    };
                  })()}
                />
              </div>
            }
          >
            <Show when={props.feedHook.featuredCluster()}>
              {(cluster) => (
                <div class="px-4 pt-3">
                  <FeaturedStory
                    primary={cluster().primary}
                    clusterId={cluster().clusterId}
                    sourcesCount={cluster().sourcesCount}
                    sourceNames={cluster().sourceNames}
                    onClick={() => props.nav.handleNewsClick(cluster().primary)}
                  />
                </div>
              )}
            </Show>

            <Show when={props.feedHook.trendingItems().length > 0 || props.feedHook.offset() === 0}>
              <TrendingSection
                items={props.feedHook.trendingItems().map((n) => ({ id: n.id, title: n.title, category: n.category ?? 'General' }))}
                loading={props.feedHook.trendingItems().length === 0}
                onItemClick={(item) => {
                  const full = props.feedHook.mappedNews().find((n) => n.id === item.id);
                  if (full) props.nav.handleNewsClick(full);
                  else props.nav.loadArticleFromId(item.id);
                }}
              />
            </Show>

            {/* ─── Emerging row (S3.9) ────────────────────────────
                Pops up when AKIRA's emerging-themes detector flags
                a cluster. Cards with the 🚨 badge (set in
                useFeed.ts via the `isEmerging` flag) come from
                this same data. The row itself surfaces the
                `title` + `velocity_score` so users see WHY this
                is showing. */}
            <Show when={emergingItems().length > 0}>
              <section class="w-full px-4 py-2" data-emerging-section>
                <div class="flex items-center justify-between mb-1.5 gap-2">
                  <h2 class="text-sm font-extrabold uppercase tracking-widest flex items-center gap-1.5" style={{ color: '#FF4D5A' }}>
                    <span aria-hidden="true">🚨</span>
                    <span>Emergentes</span>
                  </h2>
                  <span class="text-[11px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                    Ganando tracción
                  </span>
                </div>
                <div
                  class="flex gap-2 overflow-x-auto pb-1 snap-x snap-mandatory"
                  style={{ 'scrollbar-width': 'none', '-ms-overflow-style': 'none' }}
                >
                  <For each={emergingItems().slice(0, 4)}>
                    {(item) => (
                      <button
                        type="button"
                        onClick={() => openArticleFromCluster(item.cluster_id)}
                        class="snap-start shrink-0 w-56 rounded-[var(--radius-md)] border text-left p-3 flex flex-col gap-1 active:scale-[0.98] hover:shadow-sm transition-all"
                        style={{
                          background: 'color-mix(in srgb, #FF4D5A 7%, var(--bg-elevated))',
                          'border-color': 'color-mix(in srgb, #FF4D5A 30%, var(--border-base))',
                        }}
                        aria-label={item.title ?? 'Tema emergente'}
                      >
                        <div class="flex items-center justify-between gap-2">
                          <span class="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: '#FF4D5A' }}>
                            {item.distinct_sources_in_window} fuentes
                          </span>
                          <span class="text-[10px] font-bold" style={{ color: 'var(--text-tertiary)' }} aria-hidden="true">
                            ⚡ {item.velocity_score.toFixed(1)}
                          </span>
                        </div>
                        <p class="text-sm font-semibold leading-snug line-clamp-2" style={{ color: 'var(--text-primary)' }}>
                          {item.title ?? `Cluster ${item.cluster_id}`}
                        </p>
                        <Show when={item.new_articles_in_window > 1}>
                          <span class="text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                            +{item.new_articles_in_window} en {props.feedHook.emergingClusterIds().has(item.cluster_id) ? 'esta hora' : 'las últimas 6h'}
                          </span>
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              </section>
            </Show>

            <BlindspotSection
              items={props.feedHook.blindspotItems()}
              loading={props.feedHook.blindspotLoading()}
              onItemClick={onNewsClick}
            />

            <NewsletterSignup />

            <PersonalizationBanner
              showCityHint={!props.activeLocation() || props.activeLocation() === ''}
              showFollowHint={props.follows.follows().length === 0}
              showCategoryHint={!props.activeCategory() || props.activeCategory() === 'Todas'}
              onOpenOnboarding={() => props.chrome.setOnboardingVisible(true)}
            />

            <div class="flex items-center justify-between px-4 pt-3 pb-1">
              <DensityToggle density={props.density()} onChange={props.updateDensity} />
              <div class="flex items-center gap-2">
                <button
                  onClick={() => { props.haptic.vibrate('tap'); props.filters.setShowFilters((s: boolean) => !s); }}
                  class="flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-full transition-colors"
                  style={props.filters.hasActiveFilters()
                    ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                    : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-base)' }
                  }
                  aria-pressed={props.filters.showFilters()}
                  aria-label="Filtros"
                >
                  <MaterialIcon name="tune" size="base" class="text-base" aria-hidden="true" />
                  Filtros
                </button>
                <button
                  onClick={() => { props.haptic.vibrate('tap'); props.chrome.setMateMode(!props.chrome.mateMode()); }}
                  class="flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-full transition-colors"
                  style={props.chrome.mateMode()
                    ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                    : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-base)' }
                  }
                  aria-pressed={props.chrome.mateMode()}
                >
                  <MaterialIcon name="record_voice_over" size="base" class="text-base" aria-hidden="true" />
                  Modo Mate
                </button>
              </div>
            </div>

            <Show when={props.filters.showFilters()}>
              <div
                class="px-4 py-3 space-y-2 border-b border-border-base"
                style={{ background: 'var(--bg-elevated)' }}
              >
                <div class="flex items-center justify-between mb-1">
                  <p class="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>
                    Período
                  </p>
                  <Show when={props.filters.hasActiveFilters()}>
                    <button
                      onClick={() => { props.haptic.vibrate('tap'); props.filters.clearFilters(); }}
                      class="text-[11px] font-semibold"
                      style={{ color: 'var(--accent)' }}
                    >
                      Limpiar
                    </button>
                  </Show>
                </div>
                <TimeFilters activeFilter={props.filters.filterState().time} onFilterChange={props.filters.updateTime} />
                <p class="text-[10px] font-extrabold uppercase tracking-widest mt-2" style={{ color: 'var(--text-tertiary)' }}>
                  Calidad
                </p>
                <QualityFilters activeFilter={props.filters.filterState().quality} onFilterChange={props.filters.updateQuality} />
                <p class="text-[10px] font-extrabold uppercase tracking-widest mt-2" style={{ color: 'var(--text-tertiary)' }}>
                  Sesgo
                </p>
                <div class="flex items-center gap-1.5 overflow-x-auto scrollbar-hide py-1">
                  {(['all', 'left', 'right', 'neutral'] as const).map((b) => {
                    const active = () => props.filters.filterState().bias === b;
                    return (
                      <button
                        onClick={() => props.filters.updateBias(b)}
                        class="px-3 py-1.5 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors border"
                        style={active()
                          ? { background: 'var(--accent)', color: 'var(--accent-fg)', 'border-color': 'var(--accent)' }
                          : { background: 'var(--bg-elevated)', color: 'var(--text-tertiary)', 'border-color': 'var(--border-base)' }
                      }
                      >
                        {BIAS_LABELS[b]}
                      </button>
                    );
                  })}
                </div>
              </div>
            </Show>

            <div class="xl:hidden">
              <CitySelector
                cities={props.discovery.cities()}
                activeCityId={null}
                onSelect={(id) => {
                  props.setActiveLocation(id ? String(id) : null);
                  props.updateURL({ loc: id ? String(id) : null });
                  props.feedHook.resetFeed();
                }}
              />
            </div>

            <PullToRefresh onRefresh={async () => { props.feedHook.resetFeed(); }}>
              <div>
                <div class="flex flex-col [&>article:last-child]:mb-0">
                  <For each={props.feedHook.mappedNews()}>
                    {(item, index) => (
                      <NewsCard
                        news={item}
                        variant={props.density() === 'compact' ? 'compact' : 'default'}
                        priority={index() === 0}
                        onClick={() => props.nav.handleNewsClick(item)}
                        onUpvote={(_id, current) => {
                          props.haptic.vibrate('tap');
                          fetchVote(item.id, current).catch(() => {});
                        }}
                        onBookmark={() => { props.haptic.vibrate('tap'); props.toggleBookmark(item.id); }}
                        onShare={() => props.shareNews(item)}
                        onRepost={() => {
                          props.haptic.vibrate('success');
                          fetchRepost(item.id)
                            .then((res) => { if (res) toast('Repost publicado', 'info'); })
                            .catch(() => toast('No se pudo republicar', 'error'));
                        }}
                        onOpenSource={() => {
                          if (item.sourceUrl) {
                            props.haptic.vibrate('tap');
                            window.open(item.sourceUrl, '_blank', 'noopener,noreferrer');
                          } else {
                            toast('Fuente sin enlace', 'warning');
                          }
                        }}
                        onViewCluster={() => props.nav.handleNewsClick(item)}
                      />
                    )}
                  </For>
                </div>

                <div ref={props.setObserverTarget} class="h-1" />

                <Show when={props.feedHook.feed.loading && props.feedHook.offset() > 0}>
                  <div class="flex justify-center py-6">
                    <div class="flex items-center gap-2 text-text-tertiary text-[15px]">
                      <span class="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      Cargando más...
                    </div>
                  </div>
                </Show>
              </div>
            </PullToRefresh>
          </Show>
        </Show>
      </Show>
    </Show>
  );
}