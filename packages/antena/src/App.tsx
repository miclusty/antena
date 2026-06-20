/** @jsxImportSource solid-js */
import { createSignal, createResource, createEffect, createMemo, For, Show, onMount, onCleanup, lazy, Suspense, untrack } from 'solid-js';
import type { NewsItem } from './lib/types';
import NewsCard from './components/common/NewsCard';
import FeedView from './components/feed/FeedView';
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
import { useFeedFilters } from './hooks/useFeedFilters';
import { useDiscovery } from './hooks/useDiscovery';
import { useChromeUi } from './hooks/useChromeUi';
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
const HistoryView = lazy(() => import('./components/history/HistoryView'));
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

export default function App(props?: { initialFeed?: unknown[]; initialBlindspot?: unknown[] }) {
  const [activeCategory, setActiveCategory] = createSignal('Todas');
  const [activeLocation, setActiveLocation] = createSignal<string | null>(null);
  const [activeTab, setActiveTab] = createSignal<TabId>('home');
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [activeFeedTab, setActiveFeedTab] = createSignal<string>('home');
  const [density, setDensity] = createSignal<Density>(readDensity());

  const haptic = useHaptic();

  const { bookmarks, isBookmarked, toggleBookmark } = useBookmarks();
  const { queue: readLaterQueue } = useReadLater();
  const follows = useFollows();

  const filters = useFeedFilters();

  const feedHook = useFeed({
    initialFeed: props?.initialFeed,
    initialBlindspot: props?.initialBlindspot,
    activeCategory,
    activeLocation,
    activeFeedTab,
    filterState: filters.filterState,
    follows,
  });

  filters.setReset(feedHook.resetFeed);

  const nav = useUrlState({
    activeCategory,
    setActiveCategory,
    activeLocation,
    setActiveLocation,
  });

  const discovery = useDiscovery();
  const chrome = useChromeUi();

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
      categories={discovery.categories()}
      stats={discovery.stats()}
      news={feedHook.mappedNews()}
      savedCount={bookmarks().length}
      readLaterCount={readLaterQueue().length}
      onOpenReadLater={() => nav.handleViewChange('readLater')}
      bookmarks={bookmarks()}
      followsCount={follows.followedIds().size}
      feedTab={activeFeedTab()}
      onFeedTabChange={(tab) => { haptic.vibrate('tap'); setActiveFeedTab(tab); }}
      onOpenBookmarks={() => nav.handleViewChange('bookmarks')}
      onOpenHistory={() => nav.handleViewChange('history')}
    />
  );

  const rightSidebar = (
    <RightSidebar
      news={feedHook.mappedNews()}
      onNewsClick={nav.handleNewsClick}
      totalNews={discovery.stats().total_news}
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
          <FeedView
            activeCategory={activeCategory}
            setActiveCategory={setActiveCategory}
            activeLocation={activeLocation}
            setActiveLocation={setActiveLocation}
            activeFeedTab={activeFeedTab}
            setActiveFeedTab={setActiveFeedTab}
            density={density}
            updateDensity={updateDensity}
            feedHook={feedHook}
            filters={filters}
            discovery={discovery}
            follows={follows}
            chrome={chrome}
            nav={nav}
            haptic={haptic}
            setObserverTarget={setObserverTarget}
            updateURL={updateURL}
            shareNews={shareNews}
            toggleBookmark={toggleBookmark}
          />
        </Show>

        {/* ── Persistent 3-column layout (desktop) ── */}
        <div class="flex justify-center min-[1800px]:justify-between min-[1800px]:px-6 mx-auto w-full">
          {leftSidebar}

          {/* ── Center column ── */}
          <section aria-label="Feed de noticias" class="flex-1 min-w-0 max-w-[640px] xl:max-w-[960px] border-r border-border-base">

            {/* ── Feed view ── */}
            <Show when={nav.currentView() === 'feed'}>
              <FeedView
                activeCategory={activeCategory}
                setActiveCategory={setActiveCategory}
                activeLocation={activeLocation}
                setActiveLocation={setActiveLocation}
                activeFeedTab={activeFeedTab}
                setActiveFeedTab={setActiveFeedTab}
                density={density}
                updateDensity={updateDensity}
                feedHook={feedHook}
                filters={filters}
                discovery={discovery}
                follows={follows}
                chrome={chrome}
                nav={nav}
                haptic={haptic}
                setObserverTarget={setObserverTarget}
                updateURL={updateURL}
                shareNews={shareNews}
                toggleBookmark={toggleBookmark}
              />
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

            {/* ── History view (Historial) ── */}
            <Show when={nav.currentView() === 'history'}>
              <HistoryView onBack={() => nav.handleViewChange('feed')} onNewsClick={nav.handleNewsClick} />
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
            if (tab === 'home') {
              nav.handleViewChange('feed');
              setActiveFeedTab('home');
            }
            else if (tab === 'bookmarks') nav.handleViewChange('bookmarks');
            else if (tab === 'menu') chrome.setDrawerOpen(true);
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
        visible={chrome.mateMode()}
        newsItems={feedHook.mappedNews().map(n => ({ title: n.title, summary: n.summary }))}
        currentIndex={0}
      />

      {/* Persistent radio player — visible on every page */}
      <RadioPlayer />

      <Show when={chrome.onboardingVisible()}>
        <OnboardingView
          onComplete={({ cityId, categorySlugs }) => {
            chrome.setOnboardingVisible(false);
            if (cityId) setActiveLocation(String(cityId));
            const firstCat = categorySlugs[0];
            if (firstCat) {
              const cat = discovery.categories().find((c) => c.slug === firstCat);
              if (cat) setActiveCategory(cat.name);
            }
            feedHook.resetFeed();
            // Re-load follows so the "Siguiendo" tab works immediately.
            void follows.refresh();
          }}
          onSkip={() => chrome.setOnboardingVisible(false)}
        />
      </Show>

      <MobileDrawer
        open={chrome.drawerOpen()}
        onClose={() => chrome.setDrawerOpen(false)}
        stats={{
          total_news: discovery.stats().total_news,
          active_sources: discovery.stats().active_sources,
          news_today: discovery.stats().news_today ?? 0,
        }}
        savedCount={bookmarks().length}
        readLaterCount={readLaterQueue().length}
        unreadCount={0}
        activeFeedTab={activeFeedTab()}
        onNavigate={(view) => { chrome.setDrawerOpen(false); nav.handleViewChange(view); }}
        onSelectTab={(tab) => { haptic.vibrate('tap'); setActiveFeedTab(tab); chrome.setDrawerOpen(false); }}
        onSelectCategory={(cat) => {
          setActiveCategory(cat);
          updateURL({ cat: cat === 'Todas' ? null : cat });
          feedHook.resetFeed();
          chrome.setDrawerOpen(false);
        }}
        categories={discovery.categories()}
        topSources={feedHook.topSourcesForDrawer()}
        activeCategory={activeCategory()}
      />

    </ErrorBoundary>
  );
}
