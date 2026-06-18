/** @jsxImportSource solid-js */
import { createSignal, onMount, onCleanup } from "solid-js";
import { fetchCategories, fetchStats, fetchCities } from "../lib/api";
import { toast } from "../components/Toast";
import { CATEGORIES, type Category } from "../lib/types";

export type Stats = { total_news: number; active_sources: number; total_locations: number; news_today?: number };
export type CityOption = { id: number; name: string; province: string; count: number };
export type CustomTab = { id: string; label: string; category: string };

const CUSTOM_TABS_KEY = "antena-custom-tabs";

const defaultCategories: Category[] = CATEGORIES.filter((c) => c.slug !== "all").map((c) => ({
  name: c.name,
  slug: c.slug,
  icon: c.icon,
}));

const loadCustomTabs = (): CustomTab[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CUSTOM_TABS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomTab[]) : [];
  } catch {
    return [];
  }
};

const saveCustomTabs = (tabs: CustomTab[]) => {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CUSTOM_TABS_KEY, JSON.stringify(tabs));
  } catch {
    // localStorage may be unavailable (private mode);
    // the in-memory state is still usable for the session.
  }
};

export type UseDiscoveryOptions = {
  onCityChange?: (id: number | null) => void;
};

export function useDiscovery(opts: UseDiscoveryOptions = {}) {
  const [categories, setCategories] = createSignal<Category[]>(defaultCategories);
  const [stats, setStats] = createSignal<Stats>({ total_news: 0, active_sources: 0, total_locations: 0 });
  const [cities, setCities] = createSignal<CityOption[]>([]);
  const [customTabs, setCustomTabs] = createSignal<CustomTab[]>(loadCustomTabs());
  const [feedTabsVisible, setFeedTabsVisible] = createSignal(true);

  const SCROLL_THRESHOLD = 8;
  let lastScrollY = 0;
  const onScroll = () => {
    if (typeof window === "undefined") return;
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

  onMount(() => {
    window.addEventListener("scroll", onScroll, { passive: true });
    onCleanup(() => window.removeEventListener("scroll", onScroll));

    void Promise.all([
      fetchCategories().catch(() => []),
      fetchStats().catch(() => ({ status: "ok" as const, stats: { total_news: 0, active_sources: 0, total_locations: 0 } })),
    ])
      .then(([cats, s]) => {
        if (cats.length > 0) {
          setCategories(
            [
              { name: "Todas", icon: "home", slug: "all" } as Category,
              ...cats.map((c) => ({ name: c.name, icon: c.icon, slug: c.slug })),
            ] as Category[],
          );
        }
        setStats(s.stats);
      })
      .catch(() => toast("Error al cargar categorias", "warning"));

    fetchCities()
      .then((c) => setCities(c as CityOption[]))
      .catch(() => setCities([]));
  });

  const onAddCustomTab = (cat: { slug: string; name: string }) => {
    const newTab: CustomTab = { id: `cat:${cat.slug}`, label: cat.name, category: cat.slug };
    const next = [...customTabs(), newTab];
    setCustomTabs(next);
    saveCustomTabs(next);
  };

  const onRemoveCustomTab = (tabId: string) => {
    const next = customTabs().filter((t) => t.id !== tabId);
    setCustomTabs(next);
    saveCustomTabs(next);
  };

  return {
    categories,
    stats,
    cities,
    customTabs,
    feedTabsVisible,
    setCategories,
    setStats,
    setCities,
    setCustomTabs,
    onAddCustomTab,
    onRemoveCustomTab,
  };
}
