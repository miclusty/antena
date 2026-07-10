import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@solidjs/testing-library";
import App from "../App";

const state = vi.hoisted(() => ({
  handleViewChange: vi.fn(),
  resetFeed: vi.fn(),
  loadMore: vi.fn(),
  setObserverTarget: vi.fn(),
}));

vi.mock("../components/feed/FeedView", () => ({ default: () => <section>Feed principal</section> }));
vi.mock("../components/layout/Header", () => ({ default: () => <header>antena</header> }));
vi.mock("../components/layout/LeftSidebar", () => ({ default: () => <aside>izquierda</aside> }));
vi.mock("../components/layout/RightSidebar", () => ({ default: () => <aside>derecha</aside> }));
vi.mock("../components/ConnectionStatus", () => ({ default: () => null }));
vi.mock("../components/Toast", () => ({ default: () => null, toast: vi.fn() }));
vi.mock("../components/PwaInstallPrompt", () => ({ default: () => null }));
vi.mock("../components/PersonalizationBanner", () => ({ default: () => null }));
vi.mock("../components/common/ModoMate", () => ({ default: () => null }));
vi.mock("../components/common/RadioPlayer", () => ({ default: () => null }));
vi.mock("../components/menu/MobileDrawer", () => ({ default: () => null }));
vi.mock("../components/onboarding/OnboardingView", () => ({ default: () => null, isOnboarded: () => true }));
vi.mock("../lib/haptic", () => ({ useHaptic: () => ({ vibrate: vi.fn() }) }));
vi.mock("../lib/hooks", () => ({ useInfiniteScroll: () => ({ setObserverTarget: state.setObserverTarget }) }));
vi.mock("../lib/bookmarks", () => ({ useBookmarks: () => ({ bookmarks: () => [], isBookmarked: () => false, toggleBookmark: vi.fn() }) }));
vi.mock("../lib/read-later", () => ({ useReadLater: () => ({ queue: () => [] }) }));
vi.mock("../lib/follows", () => ({ useFollows: () => ({ follows: () => [], followedIds: () => new Set(), refresh: vi.fn() }) }));
vi.mock("../hooks/useFeedFilters", () => ({ useFeedFilters: () => ({ filterState: () => ({ time: "all", quality: "all", bias: "all" }), showFilters: () => false, setShowFilters: vi.fn(), updateTime: vi.fn(), updateQuality: vi.fn(), updateBias: vi.fn(), clearFilters: vi.fn(), hasActiveFilters: () => false, setReset: vi.fn() }) }));
vi.mock("../hooks/useDiscovery", () => ({ useDiscovery: () => ({ categories: () => [{ name: "Todas", slug: "all", icon: "home" }], stats: () => ({ total_news: 1, active_sources: 1, total_locations: 1, news_today: 1 }), cities: () => [], customTabs: () => [], feedTabsVisible: () => true, onAddCustomTab: vi.fn(), onRemoveCustomTab: vi.fn() }) }));
vi.mock("../hooks/useChromeUi", () => ({ useChromeUi: () => ({ drawerOpen: () => false, setDrawerOpen: vi.fn(), mateMode: () => false, setMateMode: vi.fn(), onboardingVisible: () => false, setOnboardingVisible: vi.fn() }) }));
vi.mock("../hooks/useUrlState", () => ({ useUrlState: () => ({ currentView: () => "feed", selectedNews: () => null, setSelectedNews: vi.fn(), handleViewChange: state.handleViewChange, handleNewsClick: vi.fn(), handleBack: vi.fn(), loadArticleFromId: vi.fn() }) }));
vi.mock("../hooks/useFeed", () => ({ useFeed: () => ({ allNews: () => [{ id: "n1" }], mappedNews: () => [], feed: { loading: false, error: null }, hasMore: () => false, offset: () => 0, searchQuery: () => "", setSearchQuery: vi.fn(), resetFeed: state.resetFeed, loadMore: state.loadMore, refreshBreaking: vi.fn(), featuredCluster: () => null, trendingItems: () => [], breakingItems: () => [], blindspotItems: () => [], blindspotLoading: () => false, topSourcesForDrawer: () => [] }) }));
vi.mock("../lib/preferences", () => ({ readDensity: () => "comfortable", writeDensity: vi.fn(), readFontScale: () => 1, readDataSaver: () => false }));
vi.mock("../lib/urlState", () => ({ parseURLState: () => ({ view: "feed", articleId: null, category: null, locationId: null }), updateURL: vi.fn(), clearURL: vi.fn(), pushPath: vi.fn(), articleCanonicalPath: () => "/nota" }));
vi.mock("../lib/db", () => ({ cacheNews: vi.fn(), getCachedNews: vi.fn(), markAsRead: vi.fn() }));
vi.mock("../lib/api", () => ({ fetchFeed: vi.fn(), fetchNewsById: vi.fn(), fetchCategories: vi.fn(), fetchStats: vi.fn(), fetchBreaking: vi.fn(), fetchTrending: vi.fn(), fetchCities: vi.fn(), fetchFeaturedStory: vi.fn(), fetchBlindspot: vi.fn(), fetchVote: vi.fn(), fetchRepost: vi.fn() }));

afterEach(cleanup);

describe("App smoke", () => {
  beforeEach(() => {
    state.handleViewChange.mockClear();
    window.history.replaceState({}, "", "/");
  });

  it("renders the feed shell", () => {
    const { getByText, getByLabelText, getAllByText } = render(() => <App />);
    expect(getByText("antena")).toBeInTheDocument();
    expect(getAllByText("Feed principal").length).toBeGreaterThan(0);
    expect(getByLabelText("Buscar")).toBeInTheDocument();
  });

  it("routes BottomNav search through SPA navigation", () => {
    const { getByLabelText } = render(() => <App />);
    fireEvent.click(getByLabelText("Buscar"));
    expect(state.handleViewChange).toHaveBeenCalledWith("search");
    expect(window.location.pathname).toBe("/");
  });
});
