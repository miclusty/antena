/** @jsxImportSource solid-js */
import { createSignal, createResource, createEffect, createMemo, For, Show, onMount, onCleanup, lazy, Suspense, untrack } from 'solid-js';
import type { NewsItem } from './lib/types';
import NewsCard from './components/common/NewsCard';
import BottomNav, { type TabId } from './components/common/BottomNav';
import FeedTabs from './components/common/FeedTabs';
import Header from './components/layout/Header';
import LeftSidebar from './components/layout/LeftSidebar';
import RightSidebar from './components/layout/RightSidebar';
import LocationSelector from './components/common/LocationSelector';
import ErrorBoundary from './components/common/ErrorBoundary';
import EmptyState from './components/common/EmptyState';
import ConnectionStatus from './components/ConnectionStatus';
import ToastContainer from './components/Toast';
import NewsletterSignup from './components/NewsletterSignup';
import PwaInstallPrompt from './components/PwaInstallPrompt';
import PersonalizationBanner from './components/PersonalizationBanner';
import PullToRefresh from './components/PullToRefresh';
import { toast } from './components/Toast';
import { useHaptic } from './lib/haptic';
import { useFeed } from './hooks/useFeed';
import { useUrlState } from './hooks/useUrlState';
import { cacheNews, getCachedNews, markAsRead } from './lib/db';
import { useInfiniteScroll } from './lib/hooks';
import { saveScrollPos, restoreScrollPos } from './lib/scroll';
import { useBookmarks } from './lib/bookmarks';
import { useReadLater } from './lib/read-later';
import { useFollows } from './lib/follows';
import FeaturedStory from './components/feed/FeaturedStory';
import TrendingSection from './components/feed/TrendingSection';
import BlindspotSection from './components/feed/BlindspotSection';
import CitySelector from './components/common/CitySelector';
import SourceLogo from './components/common/SourceLogo';
import { fetchFeed, fetchNewsById, fetchCategories, fetchStats, fetchBreaking, fetchTrending, fetchCities, fetchFeaturedStory, fetchBlindspot, fetchVote, fetchRepost, type FeedResponse, type ApiNewsCard } from './lib/api';

// Lazy-loaded views (code-split out of the main bundle).
// Each is only downloaded when the user navigates to it.
const ArticleDetail = lazy(() => import('./components/article/ArticleDetail'));
const BookmarksView = lazy(() => import('./components/bookmarks/BookmarksView'));
const ReadLaterView = lazy(() => import('./components/readlater/ReadLaterView'));
const BreakingView = lazy(() => import('./components/feed/BreakingView'));
const MobileDrawer = lazy(() => import('./components/menu/MobileDrawer'));
const OnboardingView = lazy(() => import('./components/onboarding/OnboardingView').then(m => ({ default: m.default })));
import { mapNewsCard } from './lib/mappers';
import { parseURLState, updateURL, clearURL, pushPath, articleCanonicalPath } from './lib/urlState';
import { resolveCustomTabSelection } from './lib/feed-controls';
import { readDensity, writeDensity, type Density } from './lib/preferences';
import { readFontScale, readDataSaver } from './lib/preferences';
import DensityToggle from './components/common/DensityToggle';
import ModoMate from './components/common/ModoMate';
import RadioPlayer from './components/common/RadioPlayer';
import { isOnboarded } from './components/onboarding/OnboardingView';
import TimeFilters, { type TimeFilter } from './components/common/TimeFilters';
import QualityFilters, { type QualityFilter } from './components/common/QualityFilters';
import {
  buildFeedFilterParams,
  DEFAULT_FILTERS,
  hasActiveFilters,
  type BiasFilter,
  type FeedFilterState,
} from './lib/feed-filters';
import { CATEGORIES, type Category } from './lib/types';
import MaterialIcon from './components/common/MaterialIcon';

const CAT_COLORS: Record<string, string> = {
  'Política':'#FF4D5A','Economía':'#F59E0B','Deportes':'#10B981','Policiales':'#EF4444',
  'Cultura':'#8B5CF6','Tecnología':'#3B82F6','Sociedad':'#06B6D4','Internacional':'#6366F1',
  'Clima':'#0EA5E9','Espectáculos':'#EC4899',
};

type ViewType = 'feed' | 'article' | 'menu' | 'bookmarks' | 'breaking' | 'readLater';

export default function App(props?: { initialFeed?: unknown[]; initialBlindspot?: unknown[] }) {
  const [activeCategory, setActiveCategory] = createSignal('Todas');
  const [activeLocation, setActiveLocation] = createSignal<string | null>(null);
  const [categories, setCategories] = createSignal<{ name: string; icon: string; slug: string }[]>([
    { name: 'Todas', icon: 'home', slug: 'all' },
    { name: 'Política', icon: 'gavel', slug: 'politica' },
    { name: 'Economía', icon: 'trending_up', slug: 'economia' },
    { name: 'Deportes', icon: 'sports_soccer', slug: 'deportes' },
    { name: 'Policiales', icon: 'local_police', slug: 'policiales' },
    { name: 'Cultura', icon: 'theater_comedy', slug: 'cultura' },
    { name: 'Tecnología', icon: 'devices', slug: 'tecnologia' },
    { name: 'Sociedad', icon: 'groups', slug: 'sociedad' },
  ]);
  const [stats, setStats] = createSignal<{ total_news: number; active_sources: number; total_locations: number; news_today?: number }>({ total_news: 0, active_sources: 0, total_locations: 0 });
  const [activeTab, setActiveTab] = createSignal<TabId>('home');
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [activeFeedTab, setActiveFeedTab] = createSignal<string>('home');
  const [feedTabsVisible, setFeedTabsVisible] = createSignal(true);
  // User-added category tabs (e.g. "Política", "Deportes") that
  // appear after the default Para vos / Siguiendo / Explorar tabs.
  // Persisted to localStorage so the user's tab layout survives
  // a page reload. The shape is a list of {id, label, category}
  // where id is "cat:<slug>" (used to dispatch onTabChange in
  // the FeedTabs onTabChange handler).
  type CustomTab = { id: string; label: string; category: string };
  const [customTabs, setCustomTabs] = createSignal<CustomTab[]>(
    typeof window === 'undefined'
      ? []
      : (() => {
          try {
            const raw = localStorage.getItem("antena-custom-tabs");
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? (parsed as CustomTab[]) : [];
          } catch {
            return [];
          }
        })(),
  );
  const [cities, setCities] = createSignal<Array<{ id: number; name: string; province: string; count: number }>>([]);
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  const [density, setDensity] = createSignal<Density>(readDensity());
  const [mateMode, setMateMode] = createSignal(false);
  const [filterState, setFilterState] = createSignal<FeedFilterState>({ ...DEFAULT_FILTERS });
  const [showFilters, setShowFilters] = createSignal(false);
  const [onboardingVisible, setOnboardingVisible] = createSignal(false);

  const updateTime = (t: TimeFilter) => { setFilterState(s => ({ ...s, time: t })); feedHook.resetFeed(); };
  const updateQuality = (q: QualityFilter) => { setFilterState(s => ({ ...s, quality: q })); feedHook.resetFeed(); };
  const updateBias = (b: BiasFilter) => { setFilterState(s => ({ ...s, bias: b })); feedHook.resetFeed(); };
  const clearFilters = () => { setFilterState({ ...DEFAULT_FILTERS }); feedHook.resetFeed(); };

  const haptic = useHaptic();

  const { bookmarks, isBookmarked, toggleBookmark } = useBookmarks();
  const { queue: readLaterQueue } = useReadLater();
  const follows = useFollows();

  const feedHook = useFeed({
    initialFeed: props?.initialFeed,
    initialBlindspot: props?.initialBlindspot,
    activeCategory,
    activeLocation,
    activeFeedTab,
    filterState,
    follows,
  });

  const nav = useUrlState({
    activeCategory,
    setActiveCategory,
    activeLocation,
    setActiveLocation,
  });

  const shareNews = async (news: NewsItem) => {
    haptic.vibrate('tap');
    const articleUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/?view=article&id=${news.id}`
      : '';
    if (navigator.share) {
      try {
        await navigator.share({ title: news.title, text: news.summary, url: articleUrl });
        haptic.vibrate('success');
        toast('Compartido', 'info');
      } catch (e) {
        if ((e as DOMException)?.name !== 'AbortError') {
          toast('No se pudo compartir', 'error');
        }
      }
    } else if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(`${news.title}\n${articleUrl}`);
        haptic.vibrate('success');
        toast('Enlace copiado', 'info');
      } catch {
        toast('No se pudo copiar el enlace', 'error');
      }
    } else {
      toast('Tu navegador no soporta compartir', 'warning');
    }
  };

  const updateDensity = (d: Density) => {
    setDensity(d);
    writeDensity(d);
  };

  const { setObserverTarget } = useInfiniteScroll({ onLoadMore: feedHook.loadMore, hasMore: feedHook.hasMore, isLoading: () => feedHook.feed.loading });

  onMount(async () => {
    // Apply user preferences to the root <html> before any UI
    // renders — avoids a flash of the default size / data-saver
    // images. The settings page updates these too, so a write
    // there re-applies on the next render.
    document.documentElement.style.setProperty('--font-scale', String(readFontScale()));
    if (readDataSaver()) document.documentElement.classList.add('data-saver');

    // We used to auto-show a 3-step onboarding modal on
    // first visit ("¿De dónde sos?" → categories → sources).
    // That blocked the user before they ever saw a single
    // story. We removed that flow in favor of an organic,
    // in-context personalization:
    //   1. Default to "Toda Argentina" (no city) on first
    //      visit. A subtle banner offers to pin a city.
    //   2. The filter UI (top of the feed) has a "Fijá
    //      ciudad" / "Categorías" / "Seguí medios" link
    //      that opens the same 3-step flow as a settings
    //      page, not a modal.
    //   3. Blindspot and SourceProfile get inline "Seguí"
    //      prompts that don't require a separate flow.
    // isOnboarded() is kept for compatibility (any other
    // code that still references it doesn't break).
    void isOnboarded;

    const urlState = parseURLState();
    if (urlState.category) setActiveCategory(urlState.category);
    if (urlState.locationId) setActiveLocation(urlState.locationId);
    if (urlState.view === 'article' && urlState.articleId) {
      await nav.loadArticleFromId(urlState.articleId);
    }

    const onPopState = async () => {
      const state = parseURLState();
      if (state.view === 'article' && state.articleId) {
        await nav.loadArticleFromId(state.articleId);
      } else {
        nav.handleViewChange('feed');
      }
      if (state.category) setActiveCategory(state.category);
      if (state.locationId !== null) setActiveLocation(state.locationId);
    };

    window.addEventListener('popstate', onPopState);
    onCleanup(() => window.removeEventListener('popstate', onPopState));

    // ── Scroll-hide/reveal for FeedTabs (mobile only) ──
    let lastScrollY = 0;
    const SCROLL_THRESHOLD = 8;
    const onScroll = () => {
      if (window.innerWidth >= 1024) {
        setFeedTabsVisible(true);
        return;
      }
      const currentY = window.scrollY;
      const delta = currentY - lastScrollY;
      if (Math.abs(delta) < SCROLL_THRESHOLD) return;
      if (currentY < 80) {
        setFeedTabsVisible(true);
      } else if (delta > 0) {
        setFeedTabsVisible(false);
      } else {
        setFeedTabsVisible(true);
      }
      lastScrollY = currentY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onCleanup(() => window.removeEventListener('scroll', onScroll));

    try {
      const [cats, s] = await Promise.all([
        fetchCategories().catch(() => []),
        fetchStats().catch(() => ({ status: 'ok', stats: { total_news: 0, active_sources: 0, total_locations: 0 } })),
      ]);
      if (cats.length > 0) setCategories([{ name: 'Todas', icon: 'home', slug: 'all' }, ...cats.map(c => ({ name: c.name, icon: c.icon, slug: c.slug }))]);
      setStats(s.stats);
    } catch (e) { toast('Error al cargar categorias', 'warning'); }

    fetchCities().then(setCities).catch(() => setCities([]));
  });

  // ── Shared sidebar component ─────────────────────────────────────────────────
  const leftSidebar = (
    <LeftSidebar
      activeCategory={activeCategory()}
      onCategoryChange={(cat) => {
        setActiveCategory(cat);
        updateURL({ cat: cat === 'Todas' ? null : cat });
        feedHook.resetFeed();
        nav.handleViewChange('feed');
      }}
      activeLocation={activeLocation()}
      onLocationChange={(locId) => {
        setActiveLocation(locId);
        updateURL({ loc: locId });
        nav.handleViewChange('feed');
        feedHook.resetFeed();
      }}
      categories={categories()}
      stats={stats()}
      news={feedHook.mappedNews()}
      savedCount={bookmarks().length}
      readLaterCount={readLaterQueue().length}
      onOpenReadLater={() => nav.handleViewChange('readLater')}
      bookmarks={bookmarks()}
      followsCount={follows.followedIds().size}
      feedTab={activeFeedTab()}
      onFeedTabChange={(tab) => { haptic.vibrate('tap'); setActiveFeedTab(tab); }}
      onOpenBookmarks={() => nav.handleViewChange('bookmarks')}
    />
  );

  const rightSidebar = (
    <RightSidebar
      news={feedHook.mappedNews()}
      onNewsClick={nav.handleNewsClick}
      totalNews={stats().total_news}
    />
  );

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <ErrorBoundary>
      <ConnectionStatus />
      <ToastContainer />
      <PwaInstallPrompt />

      <div class="min-h-screen bg-bg-base">

        <Header
          activeCategory={activeCategory()}
          onCategoryChange={(cat) => {
            setActiveCategory(cat);
            updateURL({ cat: cat === 'Todas' ? null : cat });
            feedHook.setSearchQuery('');
            nav.handleViewChange('feed');
            feedHook.resetFeed();
          }}
          onSearch={(query) => feedHook.setSearchQuery(query)}
          searchOpen={searchOpen()}
          onSearchOpenChange={setSearchOpen}
        />

        <Show when={nav.currentView() === 'feed'}>
          <FeedTabs
            activeTab={activeFeedTab()}
            onTabChange={(tabId) => {
              haptic.vibrate('tap');
              setActiveFeedTab(tabId);
              // Custom category tabs (e.g. "cat:politica") filter
              // the feed by that category. Built-in tabs (home,
              // following, explore, for-you) clear the filter.
              // Either way, switching tabs should reset the
              // accumulated `allNews` so the user doesn't see a
              // flash of the previous category's content while the
              // new fetch is in flight.
              const resolved = resolveCustomTabSelection(
                tabId,
                categories().map((c) => ({ name: c.name, slug: c.slug })),
              );
              if (resolved.categoryName) setActiveCategory(resolved.categoryName);
              else if (tabId !== activeFeedTab()) setActiveCategory('Todas');
              if (resolved.shouldReset) feedHook.resetFeed();
            }}
            customTabs={customTabs()}
            onAddCustomTab={(cat) => {
              const newTab = { id: `cat:${cat.slug}`, label: cat.name, category: cat.slug };
              const next = [...customTabs(), newTab];
              setCustomTabs(next);
              try {
                localStorage.setItem("antena-custom-tabs", JSON.stringify(next));
              } catch {
                // localStorage may be unavailable (private mode);
                // the in-memory state is still usable for the session.
              }
              haptic.vibrate('tap');
              setActiveFeedTab(newTab.id);
              setActiveCategory(cat.name);
            }}
            onRemoveCustomTab={(tabId) => {
              const next = customTabs().filter((t) => t.id !== tabId);
              setCustomTabs(next);
              try {
                localStorage.setItem("antena-custom-tabs", JSON.stringify(next));
              } catch {
                /* see above */
              }
              // If the removed tab was active, fall back to 'home'.
              if (activeFeedTab() === tabId) {
                setActiveFeedTab("home");
              }
            }}
            availableCategories={CATEGORIES.filter((c) => c.slug !== "all")}
            visible={feedTabsVisible()}
          />
        </Show>

        {/* ── Persistent 3-column layout (desktop) ── */}
        <div class="flex justify-center min-[1800px]:justify-between min-[1800px]:px-6 mx-auto w-full">
          {leftSidebar}

          {/* ── Center column ── */}
          <section aria-label="Feed de noticias" class="flex-1 min-w-0 max-w-[640px] xl:max-w-[960px] border-r border-border-base">

            {/* ── Feed view ── */}
            <Show when={nav.currentView() === 'feed'}>
              {/* Mobile-only: location + category chips */}
              <div class="xl:hidden">
                <div class="px-4 py-2">
                  <LocationSelector
                    activeLocation={activeLocation()}
                    onLocationChange={(locId) => {
                      setActiveLocation(locId);
                      updateURL({ loc: locId });
                      nav.handleViewChange('feed');
                      feedHook.resetFeed();
                    }}
                  />
                </div>
                <div class="px-4 pb-2 flex items-center gap-2 overflow-x-auto scrollbar-hide">
                  {categories().map((cat) => {
                    const color = CAT_COLORS[cat.name];
                    const isActive = activeCategory() === cat.name;
                    return (
                      <button
                        onClick={() => {
                          haptic.vibrate('tap');
                          setActiveCategory(cat.name);
                          updateURL({ cat: cat.name === 'Todas' ? null : cat.name });
                          feedHook.resetFeed();
                        }}
                        class="text-xs font-semibold px-3 py-1.5 rounded-full border whitespace-nowrap transition-all"
                        style={isActive
                          ? { 'background-color': color || 'var(--text-primary)', 'border-color': color || 'var(--text-primary)', color: '#fff' }
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
                when={!feedHook.feed.error}
                fallback={
                  <div class="px-4 py-8">
                    <EmptyState
                      icon="wifi_off"
                      title="No se pudieron cargar las noticias"
                      description="Revisá tu conexión a internet y volvé a intentarlo."
                      action={{ label: 'Reintentar', onClick: () => { feedHook.resetFeed(); } }}
                    />
                  </div>
                }
              >
                <Show
                  when={!feedHook.feed.loading || feedHook.offset() > 0}
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
                     when={feedHook.mappedNews().length > 0}
                     fallback={
                       <div class="px-4 py-8">
                         <EmptyState
                           icon="inbox"
                           title={`No hay noticias en ${activeCategory()}`}
                           description={activeLocation()
                             ? 'Probá con otra ubicación o quitá el filtro.'
                             : 'Probá con otra categoría o esperá unos minutos.'}
                           action={feedHook.searchQuery()
                             ? { label: 'Limpiar búsqueda', onClick: () => feedHook.setSearchQuery('') }
                             : { label: 'Ver todas', onClick: () => {
                                 setActiveCategory('Todas');
                                 updateURL({ cat: null });
                                 feedHook.resetFeed();
                               } }}
                         />
                       </div>
                     }
                     >
                    {/* Featured story hero — only when there's a multi-source story */}
                    <Show when={feedHook.featuredCluster()}>
                      {(cluster) => (
                        <div class="px-4 pt-3">
                          <FeaturedStory
                            primary={cluster().primary}
                            clusterId={cluster().clusterId}
                            sourcesCount={cluster().sourcesCount}
                            sourceNames={cluster().sourceNames}
                            onClick={() => nav.handleNewsClick(cluster().primary)}
                          />
                        </div>
                      )}
                    </Show>

                    {/* Trending horizontal scroll */}
                    <Show when={feedHook.trendingItems().length > 0 || feedHook.offset() === 0 /* show skeleton on first load */}>
                      <TrendingSection
                        items={feedHook.trendingItems().map(n => ({ id: n.id, title: n.title, category: n.category ?? 'General' }))}
                        loading={feedHook.trendingItems().length === 0}
                        onItemClick={(item) => {
                          // Try the in-memory feed first (zero network
                          // roundtrip). If the trending item isn't in the
                          // current feed (filtered category, paginated
                          // out, different time window, etc.), fall
                          // through to nav.loadArticleFromId which fetches
                          // it via the API. Without the fallback the
                          // click was a silent no-op for any trending
                          // item not in the visible feed.
                          const full = feedHook.mappedNews().find(n => n.id === item.id);
                          if (full) {
                            nav.handleNewsClick(full);
                          } else {
                            nav.loadArticleFromId(item.id);
                          }
                        }}
                      />
                    </Show>

                     {/* Blindspot: news from sources the user does NOT follow */}
                    <BlindspotSection
                      items={feedHook.blindspotItems()}
                      loading={feedHook.blindspotLoading()}
                      onItemClick={(item) => nav.handleNewsClick(item)}
                    />

                    {/* Map: removed in this iteration — wasn't adding value yet,
                        keeping the slot here for a future geo-density viz
                        built on real data. See MapView/MapSection for the
                        parked components. */}

                    <NewsletterSignup />


                    <PersonalizationBanner
                      showCityHint={!activeLocation() || activeLocation() === ''}
                      showFollowHint={follows.follows().length === 0}
                      showCategoryHint={!activeCategory() || activeCategory() === 'Todas'}
                      onOpenOnboarding={() => setOnboardingVisible(true)}
                    />

                    {/* Feed toolbar: density toggle + Mate mode */}
                    <div class="flex items-center justify-between px-4 pt-3 pb-1">
                      <DensityToggle density={density()} onChange={updateDensity} />
                      <div class="flex items-center gap-2">
                        <button
                          onClick={() => { haptic.vibrate('tap'); setShowFilters(s => !s); }}
                          class="flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-full transition-colors"
                          style={hasActiveFilters(filterState())
                            ? { background: 'var(--accent)', color: '#fff' }
                            : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-base)' }
                          }
                          aria-pressed={showFilters()}
                          aria-label="Filtros"
                        >
                          <MaterialIcon name="tune" size="base" class="text-base " style={{ }} aria-hidden="true" />
                          Filtros
                        </button>
                        <button
                          onClick={() => { haptic.vibrate('tap'); setMateMode(m => !m); }}
                          class="flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-full transition-colors"
                          style={mateMode()
                            ? { background: 'var(--accent)', color: '#fff' }
                            : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-base)' }
                          }
                          aria-pressed={mateMode()}
                        >
                          <MaterialIcon name="record_voice_over" size="base" class="text-base " style={{ }} aria-hidden="true" />
                          Modo Mate
                        </button>
                      </div>
                    </div>

                    {/* Filter panel (collapsible) */}
                    <Show when={showFilters()}>
                      <div
                        class="px-4 py-3 space-y-2 border-b border-border-base"
                        style={{ background: 'var(--bg-elevated)' }}
                      >
                        <div class="flex items-center justify-between mb-1">
                          <p class="text-[10px] font-extrabold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>
                            Período
                          </p>
                          <Show when={hasActiveFilters(filterState())}>
                            <button
                              onClick={() => { haptic.vibrate('tap'); clearFilters(); }}
                              class="text-[11px] font-semibold"
                              style={{ color: 'var(--accent)' }}
                            >
                              Limpiar
                            </button>
                          </Show>
                        </div>
                        <TimeFilters activeFilter={filterState().time} onFilterChange={updateTime} />
                        <p class="text-[10px] font-extrabold uppercase tracking-widest mt-2" style={{ color: 'var(--text-tertiary)' }}>
                          Calidad
                        </p>
                        <QualityFilters activeFilter={filterState().quality} onFilterChange={updateQuality} />
                        <p class="text-[10px] font-extrabold uppercase tracking-widest mt-2" style={{ color: 'var(--text-tertiary)' }}>
                          Sesgo
                        </p>
                        <div class="flex items-center gap-1.5 overflow-x-auto scrollbar-hide py-1">
                          {(['all', 'left', 'right', 'neutral'] as const).map((b) => {
                            const labels: Record<BiasFilter, string> = {
                              all: 'Todos', left: 'Opositor', right: 'Oficialista', neutral: 'Neutral',
                            };
                            const active = () => filterState().bias === b;
                            return (
                              <button
                                onClick={() => updateBias(b)}
                                class="px-3 py-1.5 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors border"
                                style={active()
                                  ? { background: 'var(--accent)', color: '#fff', 'border-color': 'var(--accent)' }
                                  : { background: 'var(--bg-elevated)', color: 'var(--text-tertiary)', 'border-color': 'var(--border-base)' }
                                }
                              >
                                {labels[b]}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </Show>

                    {/* City selector — mobile only, between trending and chips */}
                    <div class="xl:hidden">
                      <CitySelector
                        cities={cities()}
                        activeCityId={null /* we use activeLocation signal but for cities its id, kept null for now */}
                        onSelect={(id) => {
                          setActiveLocation(id ? String(id) : null);
                          updateURL({ loc: id ? String(id) : null });
                          feedHook.resetFeed();
                        }}
                      />
                    </div>

                    <PullToRefresh onRefresh={async () => { feedHook.resetFeed(); }}>
                      <div>
                        <div class="flex flex-col [&>article:last-child]:mb-0">
                          <For each={feedHook.mappedNews()}>
                            {(item) => (
                              <NewsCard
                                news={item}
                                variant={density() === 'compact' ? 'compact' : 'default'}
                                onClick={() => nav.handleNewsClick(item)}
                                onUpvote={(_id, current) => {
                                  haptic.vibrate('tap');
                                  // Fire-and-forget: the optimistic
                                  // count is already shown in the UI.
                                  // On error the local signal stays as
                                  // is (the API may have applied it
                                  // anyway); a real reconciliation
                                  // pass is Sprint 5.
                                  fetchVote(item.id, current).catch(() => {});
                                }}
                                onBookmark={() => { haptic.vibrate('tap'); toggleBookmark(item.id); }}
                                onShare={() => shareNews(item)}
                                onRepost={() => {
                                  haptic.vibrate('success');
                                  fetchRepost(item.id)
                                    .then((res) => {
                                      if (res) toast('Repost publicado', 'info');
                                    })
                                    .catch(() => toast('No se pudo republicar', 'error'));
                                }}
                                onOpenSource={() => {
                                  if (item.sourceUrl) {
                                    haptic.vibrate('tap');
                                    window.open(item.sourceUrl, '_blank', 'noopener,noreferrer');
                                  } else {
                                    toast('Fuente sin enlace', 'warning');
                                  }
                                }}
                                onViewCluster={() => nav.handleNewsClick(item)}
                              />
                            )}
                          </For>
                        </div>

                        <div ref={setObserverTarget} class="h-1" />

                        <Show when={feedHook.feed.loading && feedHook.offset() > 0}>
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

            {/* ── Article view (inline, sidebars visible on desktop) ── */}
            <Show when={nav.currentView() === 'article' && nav.selectedNews()}>
              <ArticleDetail
                news={nav.selectedNews()!}
                onBack={nav.handleBack}
                onArticleSelect={(article) => {
                  nav.setSelectedNews(article);
                  updateURL({ view: 'article', id: article.id });
                }}
              />
            </Show>

            {/* ── Breaking view (En Vivo) ── */}
            <Show when={nav.currentView() === 'breaking'}>
              <BreakingView
                items={feedHook.breakingItems().map(n => ({
                  id: n.id,
                  title: n.title,
                  source: n.source,
                  biasScore: n.biasScore,
                  createdAt: n.createdAt,
                }))}
                onItemClick={(item) => {
                  const full = feedHook.mappedNews().find(n => n.id === item.id) ?? feedHook.breakingItems().find(n => n.id === item.id);
                  if (full) nav.handleNewsClick(mapNewsCard(full as unknown as ApiNewsCard));
                }}
              />
            </Show>

            {/* ── Bookmarks view ── */}
            <Show when={nav.currentView() === 'bookmarks'}>
              <BookmarksView onBack={() => nav.handleViewChange('feed')} onNewsClick={nav.handleNewsClick} />
            </Show>

            <Show when={nav.currentView() === 'readLater'}>
              <ReadLaterView onBack={() => nav.handleViewChange('feed')} onNewsClick={nav.handleNewsClick} />
            </Show>

          </section>

          {rightSidebar}
        </div>

      </div>

      {/* Bottom Nav — mobile only, hidden during article */}
      <Show when={nav.currentView() !== 'article'}>
        <BottomNav
          activeTab={activeTab()}
          onTabChange={(tab) => {
            haptic.vibrate('tap');
            setActiveTab(tab);
            if (tab === 'home') nav.handleViewChange('feed');
            else if (tab === 'bookmarks') nav.handleViewChange('bookmarks');
            else if (tab === 'menu') setDrawerOpen(true);
            else if (tab === 'live') {
              nav.handleViewChange('breaking');
              // refresh breaking
              feedHook.refreshBreaking();
            }
            else if (tab === 'search') {
              if (typeof window !== 'undefined') {
                window.location.href = '/buscar';
              }
            }
          }}
          unreadCount={(() => {
            if (typeof window === 'undefined') return 0;
            try {
              const read = JSON.parse(localStorage.getItem('antena-read') || '[]');
              return Math.max(0, feedHook.allNews().filter(n => !read.includes(n.id)).length);
            } catch { return 0; }
          })()}
      savedCount={bookmarks().length}
      readLaterCount={readLaterQueue().length}
        />
      </Show>

      <ModoMate
        visible={mateMode()}
        newsItems={feedHook.mappedNews().map(n => ({ title: n.title, summary: n.summary }))}
        currentIndex={0}
      />

      {/* Persistent radio player — visible on every page */}
      <RadioPlayer />

      <Show when={onboardingVisible()}>
        <OnboardingView
          onComplete={({ cityId, categorySlugs }) => {
            setOnboardingVisible(false);
            if (cityId) setActiveLocation(String(cityId));
            const firstCat = categorySlugs[0];
            if (firstCat) {
              const cat = categories().find((c) => c.slug === firstCat);
              if (cat) setActiveCategory(cat.name);
            }
            feedHook.resetFeed();
            // Re-load follows so the "Siguiendo" tab works immediately.
            void follows.refresh();
          }}
          onSkip={() => setOnboardingVisible(false)}
        />
      </Show>

      <MobileDrawer
        open={drawerOpen()}
        onClose={() => setDrawerOpen(false)}
        stats={{
          total_news: stats().total_news,
          active_sources: stats().active_sources,
          news_today: stats().news_today ?? 0,
        }}
        savedCount={bookmarks().length}
        readLaterCount={readLaterQueue().length}
        unreadCount={0}
        activeFeedTab={activeFeedTab()}
        onNavigate={(view) => { setDrawerOpen(false); nav.handleViewChange(view); }}
        onSelectTab={(tab) => { haptic.vibrate('tap'); setActiveFeedTab(tab); setDrawerOpen(false); }}
        onSelectCategory={(cat) => {
          setActiveCategory(cat);
          updateURL({ cat: cat === 'Todas' ? null : cat });
          feedHook.resetFeed();
          setDrawerOpen(false);
        }}
        categories={categories()}
        topSources={feedHook.topSourcesForDrawer()}
        activeCategory={activeCategory()}
      />

    </ErrorBoundary>
  );
}
