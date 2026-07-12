import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@solidjs/testing-library";
import FeedView, { type FeedViewProps } from "../components/feed/FeedView";
import { createMockNews } from "./helpers";

vi.mock("../components/common/NewsCard", () => ({ default: (props: any) => <article>{props.news.title}</article> }));
vi.mock("../components/common/FeedTabs", () => ({ default: (props: any) => <nav><button onClick={() => props.onTabChange("following")}>Siguiendo</button><button>Para vos</button></nav> }));
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
vi.mock("../components/PullToRefresh", () => ({ default: (props: any) => <div>{props.children}</div> }));

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
    feedHook: { mappedNews: () => [news], featuredCluster: () => null, trendingItems: () => [], blindspotItems: () => [], blindspotLoading: () => false, emergingClusterIds: () => new Set(), feed: { error: null, loading: false }, offset: () => 0, searchQuery: () => "", setSearchQuery: vi.fn(), resetFeed: vi.fn() },
    filters: { filterState: () => ({ time: "all", quality: 0, bias: "all" }), showFilters: () => false, setShowFilters: vi.fn(), updateTime: vi.fn(), updateQuality: vi.fn(), updateBias: vi.fn(), clearFilters: vi.fn(), hasActiveFilters: () => false },
    discovery: { categories: () => [{ name: "Todas", slug: "all", icon: "home" }], cities: () => [], customTabs: () => [], feedTabsVisible: () => true, onAddCustomTab: vi.fn(), onRemoveCustomTab: vi.fn() },
    follows: { follows: () => [], followedIds: () => new Set() },
    chrome: { setOnboardingVisible: vi.fn(), setMateMode: vi.fn(), mateMode: () => false },
    nav: { currentView: () => "feed", handleNewsClick: vi.fn(), loadArticleFromId: vi.fn(), handleViewChange: vi.fn() },
    haptic: { vibrate: vi.fn() },
    setObserverTarget: vi.fn(),
    updateURL: vi.fn(),
    shareNews: vi.fn(),
    toggleBookmark: vi.fn(),
    ...overrides,
  };
}

describe("FeedView smoke", () => {
  it("renders feed controls and the first card", () => {
    const props = makeProps();
    const { getByText } = render(() => <FeedView {...props} />);
    expect(getByText("Para vos")).toBeInTheDocument();
    expect(getByText("Nota principal")).toBeInTheDocument();
    expect(getByText("Filtros")).toBeInTheDocument();
  });

  it("changes tab through FeedTabs", () => {
    const props = makeProps();
    const { getByText } = render(() => <FeedView {...props} />);
    fireEvent.click(getByText("Siguiendo"));
    expect(props.setActiveFeedTab).toHaveBeenCalledWith("following");
    expect(props.haptic.vibrate).toHaveBeenCalledWith("tap");
  });
});
