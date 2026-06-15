/** @jsxImportSource solid-js */
import { createSignal, createResource, createEffect, createMemo, For, Show, onMount, onCleanup, lazy, Suspense } from 'solid-js';
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
import { parseURLState, updateURL, clearURL } from './lib/urlState';
import { resolveCustomTabSelection } from './lib/feed-controls';
import { readDensity, writeDensity, type Density } from './lib/preferences';
import { readFontScale, readDataSaver } from './lib/preferences';
import DensityToggle from './components/common/DensityToggle';
import ModoMate from './components/common/ModoMate';
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

export default function App() {
  const [activeCategory, setActiveCategory] = createSignal('Todas');
  const [searchQuery, setSearchQuery] = createSignal('');
  const [activeLocation, setActiveLocation] = createSignal<string | null>(null);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [currentView, setCurrentView] = createSignal<ViewType>('feed');
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
  const [offset, setOffset] = createSignal(0);
  const [allNews, setAllNews] = createSignal<NewsItem[]>([]);
  const [hasMore, setHasMore] = createSignal(true);
  const [isLoadingMore, setIsLoadingMore] = createSignal(false);
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
  const [trendingItems, setTrendingItems] = createSignal<ApiNewsCard[]>([]);
  const [breakingItems, setBreakingItems] = createSignal<ApiNewsCard[]>([]);
  const [blindspotItems, setBlindspotItems] = createSignal<Array<{ id: string; title: string; summary: string; source: string; sourceUrl?: string; sourceId?: number | null; category?: string; biasColor?: string }>>([]);
  const [blindspotLoading, setBlindspotLoading] = createSignal(false);
  const [density, setDensity] = createSignal<Density>(readDensity());
  const [mateMode, setMateMode] = createSignal(false);
  const [filterState, setFilterState] = createSignal<FeedFilterState>({ ...DEFAULT_FILTERS });
  const [showFilters, setShowFilters] = createSignal(false);
  const [onboardingVisible, setOnboardingVisible] = createSignal(false);

  const updateTime = (t: TimeFilter) => { setFilterState(s => ({ ...s, time: t })); resetFeed(); };
  const updateQuality = (q: QualityFilter) => { setFilterState(s => ({ ...s, quality: q })); resetFeed(); };
  const updateBias = (b: BiasFilter) => { setFilterState(s => ({ ...s, bias: b })); resetFeed(); };
  const clearFilters = () => { setFilterState({ ...DEFAULT_FILTERS }); resetFeed(); };

  const haptic = useHaptic();

  const { bookmarks, isBookmarked, toggleBookmark } = useBookmarks();
  const { queue: readLaterQueue } = useReadLater();
  const follows = useFollows();

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

  const [feed, { refetch }] = createResource(
    () => `${activeCategory()}:${searchQuery()}:${activeLocation() ?? 'all'}:${activeFeedTab()}:${follows.followedIds().size}:${JSON.stringify(filterState())}`,
    async (): Promise<FeedResponse> => {
      try {
        const catParam = activeCategory() === 'Todas' ? undefined : activeCategory();
        const result = await fetchFeed({
          category: catParam,
          location_id: activeLocation() ? parseInt(activeLocation()!) : undefined,
          limit: 20,
          offset: 0,
          // "Siguiendo" is strict: only news from followed sources.
          // "Para vos" (foryou) is permissive: quality-ranked mix that
          // may include non-followed sources. The two are mutually
          // exclusive — the API treats foryou=true as a different sort,
          // not an extra filter.
          following: activeFeedTab() === "following",
          foryou: activeFeedTab() === "foryou",
          ...buildFeedFilterParams(filterState()),
        });
        return result as FeedResponse;
      } catch (e) {
        console.error('fetchFeed failed:', e);
        if (typeof window === 'undefined') throw e;
        if (!navigator.onLine) {
          const cached = await getCachedNews(50);
          if (cached?.length) {
            toast('Sin conexión — mostrando artículos guardados', 'warning');
            return { news: cached as unknown as ApiNewsCard[], total: cached.length, page: 1, per_page: cached.length, location: null, category: null };
          }
        }
        throw e;
      }
    }
  );

  const resetFeed = () => { setOffset(0); setAllNews([]); setHasMore(true); refetch(); };

  const loadMore = () => {
    if (!hasMore() || isLoadingMore()) return;
    setIsLoadingMore(true);
    const data = feed();
    if (!data?.news) { setIsLoadingMore(false); return; }
    const newItems = data.news.map(mapNewsCard);
    setAllNews(prev => [...prev, ...newItems]);
    setOffset(prev => prev + 20);
    setHasMore(data.news.length >= 20);
    setIsLoadingMore(false);
  };

  const updateDensity = (d: Density) => {
    setDensity(d);
    writeDensity(d);
  };

  const { setObserverTarget } = useInfiniteScroll({ onLoadMore: loadMore, hasMore, isLoading: () => feed.loading });

  const featuredCluster = createMemo(() => {
    const data = feed();
    if (!data?.news) return null;
    const newsList = data.news as unknown as ApiNewsCard[];
    const featured = newsList.find(n => (n.sources_count ?? 0) >= 3);
    if (!featured) return null;
    return {
      primary: mapNewsCard(featured),
      clusterId: featured.cluster_id ?? '',
      sourcesCount: featured.sources_count ?? 1,
      sourceNames: (featured.source_names ?? (featured.source_name ? [featured.source_name] : [])).slice(0, 5),
    };
  });

  createEffect(() => {
    const data = feed();
    if (data?.news && offset() === 0) {
      setAllNews(data.news.map(mapNewsCard));
      setHasMore(data.news.length >= 20);
      cacheNews(data.news).catch(() => {});

      const newsList = data.news as unknown as ApiNewsCard[];
      setTrendingItems(newsList.filter(n => (n.sources_count ?? 1) >= 1).slice(0, 10));
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      setBreakingItems(newsList.filter(n => new Date(n.created_at).getTime() >= twoHoursAgo));
    }
  });

  const [selectedNews, setSelectedNews] = createSignal<NewsItem | null>(null);

  const handleViewChange = (view: ViewType) => {
    haptic.vibrate('tap');
    setCurrentView(view);
    setActiveTab(
      view === 'feed' ? 'home'
      : view === 'bookmarks' ? 'bookmarks'
      : view === 'menu' ? 'menu'
      : 'home'
    );
    if (view === 'feed') { setSelectedId(null); setSelectedNews(null); restoreScrollPos(); }
  };

  const handleNewsClick = async (news: NewsItem) => {
    saveScrollPos();
    await loadArticleFromId(news.id);
    updateURL({ view: 'article', id: news.id });
  };

  const handleBack = () => {
    setSelectedId(null);
    setSelectedNews(null);
    setCurrentView('feed');
    restoreScrollPos();
    clearURL();
  };

  const loadArticleFromId = async (articleId: string) => {
    markAsRead(articleId);
    setSelectedId(articleId);
    setCurrentView('article');
    setSelectedNews(null);
    const card = await fetchNewsById(articleId);
    if (card) {
      setSelectedNews(mapNewsCard(card));
    } else {
      setSelectedNews(null);
      toast('No se pudo cargar la noticia', 'error');
      handleBack();
    }
  };

  const mappedNews = createMemo<NewsItem[]>(() => {
    let items = allNews();
    const tab = activeFeedTab();
    if (tab === 'following') {
      // Filter by the user's followed source ids (loaded from
      // server-side D1 via useFollows).
      const followedIds = follows.followedIds();
      if (followedIds.size > 0) {
        items = items.filter(
          (n) => n.sourceId != null && followedIds.has(n.sourceId),
        );
      } else {
        // No follows yet — empty the tab so the user is prompted
        // to follow a source.
        items = [];
      }
    }
    const q = searchQuery().toLowerCase().trim();
    if (q) items = items.filter(n => n.title.toLowerCase().includes(q) || n.summary.toLowerCase().includes(q) || n.category.toLowerCase().includes(q));
    return items;
  });

  const topSourcesForDrawer = createMemo<{ name: string; count: number; biasColor: string }[]>(() => {
    const counts: Record<string, { name: string; count: number; biasColor: string }> = {};
    for (const n of mappedNews()) {
      if (!counts[n.source]) counts[n.source] = { name: n.source, count: 0, biasColor: n.biasColor };
      counts[n.source].count++;
    }
    return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 5);
  });

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
      await loadArticleFromId(urlState.articleId);
    }

    const onPopState = async () => {
      const state = parseURLState();
      if (state.view === 'article' && state.articleId) {
        await loadArticleFromId(state.articleId);
      } else {
        handleViewChange('feed');
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

    // Blindspot is per-device, so it can't share the feed
    // resource. The createEffect below runs on mount AND
    // whenever followedIds changes — that's the only place
    // we need to call it (the previous version had an extra
    // explicit call before the effect, which caused a
    // duplicate /api/news/blindspot request on every page load,
    // showing up as a 1.7s critical path latency in Lighthouse).
    const refreshBlindspot = () => {
      setBlindspotLoading(true);
      fetchBlindspot(10)
        .then((res) => res && setBlindspotItems(res.items.map((it: any) => ({
          id: it.id,
          title: it.title,
          summary: it.summary,
          source: it.source_name ?? it.source ?? 'Fuente',
          sourceUrl: it.source_url ?? undefined,
          sourceId: it.source_id ?? null,
          category: it.category ?? undefined,
          biasColor: it.biasColor ?? undefined,
        }))))
        .catch(() => setBlindspotItems([]))
        .finally(() => setBlindspotLoading(false));
    };
    createEffect(() => {
      // Re-fetch whenever the followed set changes. createEffect
      // runs once on mount automatically — no need for an
      // explicit refreshBlindspot() call before this.
      follows.followedIds();
      refreshBlindspot();
    });
  });

  // ── Shared sidebar component ─────────────────────────────────────────────────
  const leftSidebar = (
    <LeftSidebar
      activeCategory={activeCategory()}
      onCategoryChange={(cat) => {
        setActiveCategory(cat);
        updateURL({ cat: cat === 'Todas' ? null : cat });
        resetFeed();
        handleViewChange('feed');
      }}
      activeLocation={activeLocation()}
      onLocationChange={(locId) => {
        setActiveLocation(locId);
        updateURL({ loc: locId });
        handleViewChange('feed');
        resetFeed();
      }}
      categories={categories()}
      stats={stats()}
      news={mappedNews()}
      savedCount={bookmarks().length}
      readLaterCount={readLaterQueue().length}
      onOpenReadLater={() => handleViewChange('readLater')}
      bookmarks={bookmarks()}
      followsCount={follows.followedIds().size}
      feedTab={activeFeedTab()}
      onFeedTabChange={(tab) => { haptic.vibrate('tap'); setActiveFeedTab(tab); }}
      onOpenBookmarks={() => handleViewChange('bookmarks')}
    />
  );

  const rightSidebar = (
    <RightSidebar
      news={mappedNews()}
      onNewsClick={handleNewsClick}
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
            setSearchQuery('');
            handleViewChange('feed');
            resetFeed();
          }}
          onSearch={(query) => setSearchQuery(query)}
          searchOpen={searchOpen()}
          onSearchOpenChange={setSearchOpen}
        />

        <Show when={currentView() === 'feed'}>
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
              if (resolved.shouldReset) resetFeed();
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
            <Show when={currentView() === 'feed'}>
              {/* Mobile-only: location + category chips */}
              <div class="xl:hidden">
                <div class="px-4 py-2">
                  <LocationSelector
                    activeLocation={activeLocation()}
                    onLocationChange={(locId) => {
                      setActiveLocation(locId);
                      updateURL({ loc: locId });
                      handleViewChange('feed');
                      resetFeed();
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
                          resetFeed();
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
                when={!feed.error}
                fallback={
                  <div class="px-4 py-8">
                    <EmptyState
                      icon="wifi_off"
                      title="No se pudieron cargar las noticias"
                      description="Revisá tu conexión a internet y volvé a intentarlo."
                      action={{ label: 'Reintentar', onClick: () => { resetFeed(); refetch(); } }}
                    />
                  </div>
                }
              >
                <Show
                  when={!feed.loading || offset() > 0}
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
                     when={mappedNews().length > 0}
                     fallback={
                       <div class="px-4 py-8">
                         <EmptyState
                           icon="inbox"
                           title={`No hay noticias en ${activeCategory()}`}
                           description={activeLocation()
                             ? 'Probá con otra ubicación o quitá el filtro.'
                             : 'Probá con otra categoría o esperá unos minutos.'}
                           action={searchQuery()
                             ? { label: 'Limpiar búsqueda', onClick: () => setSearchQuery('') }
                             : { label: 'Ver todas', onClick: () => {
                                 setActiveCategory('Todas');
                                 updateURL({ cat: null });
                                 resetFeed();
                               } }}
                         />
                       </div>
                     }
                     >
                    {/* Featured story hero — only when there's a multi-source story */}
                    <Show when={featuredCluster()}>
                      {(cluster) => (
                        <div class="px-4 pt-3">
                          <FeaturedStory
                            primary={cluster().primary}
                            clusterId={cluster().clusterId}
                            sourcesCount={cluster().sourcesCount}
                            sourceNames={cluster().sourceNames}
                            onClick={() => handleNewsClick(cluster().primary)}
                          />
                        </div>
                      )}
                    </Show>

                    {/* Trending horizontal scroll */}
                    <Show when={trendingItems().length > 0 || offset() === 0 /* show skeleton on first load */}>
                      <TrendingSection
                        items={trendingItems().map(n => ({ id: n.id, title: n.title, category: n.category ?? 'General' }))}
                        loading={trendingItems().length === 0}
                        onItemClick={(item) => {
                          // Try the in-memory feed first (zero network
                          // roundtrip). If the trending item isn't in the
                          // current feed (filtered category, paginated
                          // out, different time window, etc.), fall
                          // through to loadArticleFromId which fetches
                          // it via the API. Without the fallback the
                          // click was a silent no-op for any trending
                          // item not in the visible feed.
                          const full = mappedNews().find(n => n.id === item.id);
                          if (full) {
                            handleNewsClick(full);
                          } else {
                            loadArticleFromId(item.id);
                          }
                        }}
                      />
                    </Show>

                     {/* Blindspot: news from sources the user does NOT follow */}
                    <BlindspotSection
                      items={blindspotItems()}
                      loading={blindspotLoading()}
                      onItemClick={(item) => handleNewsClick(item)}
                    />

                    {/* Map: removed in this iteration — wasn't adding value yet,
                        keeping the slot here for a future geo-density viz
                        built on real data. See MapView/MapSection for the
                        parked components. */}

                    <NewsletterSignup />


                    <PersonalizationBanner
                      showCityHint={!activeLocation() || activeLocation() === ''}
                      showFollowHint={follows.follows.length === 0}
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
                          resetFeed();
                        }}
                      />
                    </div>

                    <PullToRefresh onRefresh={async () => { resetFeed(); }}>
                      <div>
                        <div class="flex flex-col [&>article:last-child]:mb-0">
                          <For each={mappedNews()}>
                            {(item) => (
                              <NewsCard
                                news={item}
                                variant={density() === 'compact' ? 'compact' : 'default'}
                                onClick={() => handleNewsClick(item)}
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
                                onViewCluster={() => handleNewsClick(item)}
                              />
                            )}
                          </For>
                        </div>

                        <div ref={setObserverTarget} class="h-1" />

                        <Show when={feed.loading && offset() > 0}>
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
            <Show when={currentView() === 'article' && selectedNews()}>
              <ArticleDetail
                news={selectedNews()!}
                onBack={handleBack}
                onArticleSelect={(article) => {
                  setSelectedNews(article);
                  updateURL({ view: 'article', id: article.id });
                }}
              />
            </Show>

            {/* ── Breaking view (En Vivo) ── */}
            <Show when={currentView() === 'breaking'}>
              <BreakingView
                items={breakingItems().map(n => ({
                  id: n.id,
                  title: n.title,
                  source: n.source_name ?? 'Fuente',
                  biasScore: n.bias_score ?? undefined,
                  createdAt: n.created_at,
                }))}
                onItemClick={(item) => {
                  const full = mappedNews().find(n => n.id === item.id) ?? breakingItems().find(n => n.id === item.id);
                  if (full) handleNewsClick(mapNewsCard(full as ApiNewsCard));
                }}
              />
            </Show>

            {/* ── Bookmarks view ── */}
            <Show when={currentView() === 'bookmarks'}>
              <BookmarksView onBack={() => handleViewChange('feed')} onNewsClick={handleNewsClick} />
            </Show>

            <Show when={currentView() === 'readLater'}>
              <ReadLaterView onBack={() => handleViewChange('feed')} onNewsClick={handleNewsClick} />
            </Show>

          </section>

          {rightSidebar}
        </div>

      </div>

      {/* Bottom Nav — mobile only, hidden during article */}
      <Show when={currentView() !== 'article'}>
        <BottomNav
          activeTab={activeTab()}
          onTabChange={(tab) => {
            haptic.vibrate('tap');
            setActiveTab(tab);
            if (tab === 'home') handleViewChange('feed');
            else if (tab === 'bookmarks') handleViewChange('bookmarks');
            else if (tab === 'menu') setDrawerOpen(true);
            else if (tab === 'live') {
              handleViewChange('breaking');
              // refresh breaking
              fetchBreaking(50).then(r => r && setBreakingItems(r.news)).catch(() => {});
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
              return Math.max(0, allNews().filter(n => !read.includes(n.id)).length);
            } catch { return 0; }
          })()}
      savedCount={bookmarks().length}
      readLaterCount={readLaterQueue().length}
        />
      </Show>

      <ModoMate
        visible={mateMode()}
        newsItems={mappedNews().map(n => ({ title: n.title, summary: n.summary }))}
        currentIndex={0}
      />

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
            resetFeed();
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
        onNavigate={(view) => { setDrawerOpen(false); handleViewChange(view); }}
        onSelectTab={(tab) => { haptic.vibrate('tap'); setActiveFeedTab(tab); setDrawerOpen(false); }}
        onSelectCategory={(cat) => {
          setActiveCategory(cat);
          updateURL({ cat: cat === 'Todas' ? null : cat });
          resetFeed();
          setDrawerOpen(false);
        }}
        categories={categories()}
        topSources={topSourcesForDrawer()}
        activeCategory={activeCategory()}
      />

    </ErrorBoundary>
  );
}
