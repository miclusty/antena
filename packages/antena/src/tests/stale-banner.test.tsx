import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import FeedView, { type FeedViewProps } from "../components/feed/FeedView";
import { createMockNews } from "./helpers";

// The banner lives inside FeedView. To test it in isolation we mock
// every other heavy component so the feed renders cleanly. The banner
// should only appear when the `feedHook.isStale()` accessor is true.
vi.mock("../components/common/NewsCard", () => ({
  default: (props: { news: { title: string } }) => <article>{props.news.title}</article>,
}));
vi.mock("../components/common/FeedTabs", () => ({ default: () => <nav /> }));
vi.mock("../components/common/LocationSelector", () => ({ default: () => <div>Ubicación</div> }));
vi.mock("../components/common/CitySelector", () => ({ default: () => <div>Ciudades</div> }));
vi.mock("../components/common/DensityToggle", () => ({ default: () => <button>Densidad</button> }));
vi.mock("../components/common/TimeFilters", () => ({ default: () => <div>Tiempo</div> }));
vi.mock("../components/common/QualityFilters", () => ({ default: () => <div>Calidad</div> }));
vi.mock("../components/feed/FeaturedStory", () => ({ default: () => <section>Destacada</section> }));
vi.mock("../components/feed/TrendingSection", () => ({ default: () => <section>Tendencias</section> }));
vi.mock("../components/feed/BlindspotSection", () => ({ default: () => <section>Sesgo del día</section> }));
vi.mock("../components/PersonalizationBanner", () => ({ default: () => <section>Personalización</section> }));
vi.mock("../components/NewsletterSignup", () => ({ default: () => <section>Newsletter</section> }));
vi.mock("../components/PullToRefresh", () => ({ default: (props: { children: unknown }) => <div>{props.children as any}</div> }));

afterEach(cleanup);

function makeProps(overrides: Partial<FeedViewProps> = {}): FeedViewProps {
  const news = createMockNews({ title: "Nota principal" });
  return {
    activeCategory: () => "Todas",
    setActiveCategory: vi.fn(),
    activeLocation: () => null,
    setActiveLocation: vi.fn(),
    activeFeedTab: () => "home",
    setActiveFeedTab: vi.fn(),
    density: () => "comfortable",
    updateDensity: vi.fn(),
    feedHook: {
      mappedNews: () => [news],
      featuredCluster: () => null,
      trendingItems: () => [],
      blindspotItems: () => [],
      blindspotLoading: () => false,
      emergingClusterIds: () => new Set<string>(),
      feed: { error: null, loading: false },
      offset: () => 0,
      searchQuery: () => "",
      setSearchQuery: vi.fn(),
      resetFeed: vi.fn(),
      isStale: () => false,
      daysSinceLastNews: () => null,
    } as any,
    filters: {
      filterState: () => ({ time: "all", quality: 0, bias: "all" }),
      showFilters: () => false,
      setShowFilters: vi.fn(),
      updateTime: vi.fn(),
      updateQuality: vi.fn(),
      updateBias: vi.fn(),
      clearFilters: vi.fn(),
      hasActiveFilters: () => false,
    },
    discovery: {
      categories: () => [{ name: "Todas", slug: "all", icon: "home" }],
      cities: () => [],
      customTabs: () => [],
      feedTabsVisible: () => true,
      onAddCustomTab: vi.fn(),
      onRemoveCustomTab: vi.fn(),
    },
    follows: { follows: () => [], followedIds: () => new Set<number>() },
    chrome: { setOnboardingVisible: vi.fn(), setMateMode: vi.fn(), mateMode: () => false },
    nav: {
      currentView: () => "feed",
      handleNewsClick: vi.fn(),
      loadArticleFromId: vi.fn(),
      handleViewChange: vi.fn(),
    },
    haptic: { vibrate: vi.fn() },
    setObserverTarget: vi.fn(),
    updateURL: vi.fn(),
    shareNews: vi.fn(),
    toggleBookmark: vi.fn(),
    ...overrides,
  };
}

describe("Stale banner", () => {
  it("renders the banner when feedHook.isStale() === true", () => {
    const props = makeProps({
      feedHook: {
        ...makeProps().feedHook,
        isStale: () => true,
        daysSinceLastNews: () => 23,
      } as any,
    });
    const { getByText } = render(() => <FeedView {...props} />);
    expect(getByText(/Sin noticias nuevas/i)).toBeInTheDocument();
  });

  it("renders the '23 días' message when daysSinceLastNews is 23", () => {
    const props = makeProps({
      feedHook: {
        ...makeProps().feedHook,
        isStale: () => true,
        daysSinceLastNews: () => 23,
      } as any,
    });
    const { getByText } = render(() => <FeedView {...props} />);
    expect(getByText(/23 días/i)).toBeInTheDocument();
  });

  it("does NOT render the banner when feedHook.isStale() === false", () => {
    const props = makeProps({
      feedHook: { ...makeProps().feedHook, isStale: () => false } as any,
    });
    const { queryByText } = render(() => <FeedView {...props} />);
    expect(queryByText(/Sin noticias nuevas/i)).not.toBeInTheDocument();
  });

  it("does NOT render the banner when the feed is empty (EmptyState takes over)", () => {
    const props = makeProps({
      feedHook: {
        ...makeProps().feedHook,
        mappedNews: () => [],
        isStale: () => true,
      } as any,
    });
    const { queryByText } = render(() => <FeedView {...props} />);
    expect(queryByText(/Sin noticias nuevas/i)).not.toBeInTheDocument();
  });
});
