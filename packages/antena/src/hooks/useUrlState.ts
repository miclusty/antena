/** @jsxImportSource solid-js */
import { createSignal, onMount, onCleanup } from "solid-js";
import { fetchNewsById } from "../lib/api";
import { parseURLState, pushPath, updateURL, clearURL, articleCanonicalPath } from "../lib/urlState";
import { saveScrollPos, restoreScrollPos } from "../lib/scroll";
import { markAsRead } from "../lib/db";
import { mapNewsCard } from "../lib/mappers";
import { toast } from "../components/Toast";
import type { NewsItem } from "../lib/types";

export type ViewType = "feed" | "article" | "menu" | "bookmarks" | "breaking" | "readLater" | "history";

export type UseUrlStateOptions = {
  activeCategory?: () => string;
  setActiveCategory?: (v: string) => void;
  activeLocation?: () => string | null;
  setActiveLocation?: (v: string | null) => void;
};

export function useUrlState(opts: UseUrlStateOptions = {}) {
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [currentView, setCurrentView] = createSignal<ViewType>("feed");
  const [selectedNews, setSelectedNews] = createSignal<NewsItem | null>(null);

  const handleViewChange = (view: ViewType) => {
    setCurrentView(view);
    if (view === "feed") {
      setSelectedId(null);
      setSelectedNews(null);
      restoreScrollPos();
    }
  };

  const handleNewsClick = async (news: NewsItem) => {
    saveScrollPos();
    await loadArticleFromId(news.id);
    pushPath(articleCanonicalPath(news.slug, news.slugDate, news.id));
  };

  const handleBack = () => {
    setSelectedId(null);
    setSelectedNews(null);
    setCurrentView("feed");
    restoreScrollPos();
    clearURL();
  };

  const loadArticleFromId = async (articleId: string) => {
    markAsRead(articleId);
    setSelectedId(articleId);
    setCurrentView("article");
    setSelectedNews(null);
    const card = await fetchNewsById(articleId);
    if (card) {
      setSelectedNews(mapNewsCard(card));
    } else {
      setSelectedNews(null);
      toast("No se pudo cargar la noticia", "error");
      handleBack();
    }
  };

  onMount(() => {
    const initial = parseURLState();
    if (opts.setActiveCategory && initial.category) opts.setActiveCategory(initial.category);
    if (opts.setActiveLocation && initial.locationId) opts.setActiveLocation(initial.locationId);
    if (initial.view === "article" && initial.articleId) {
      void loadArticleFromId(initial.articleId);
    }

    const onPopState = async () => {
      const state = parseURLState();
      if (state.view === "article" && state.articleId) {
        await loadArticleFromId(state.articleId);
      } else {
        handleViewChange("feed");
      }
      if (opts.setActiveCategory && state.category) opts.setActiveCategory(state.category);
      if (opts.setActiveLocation && state.locationId !== null) opts.setActiveLocation(state.locationId);
    };

    window.addEventListener("popstate", onPopState);
    onCleanup(() => window.removeEventListener("popstate", onPopState));
  });

  return {
    selectedId,
    setSelectedId,
    currentView,
    setCurrentView,
    selectedNews,
    setSelectedNews,
    handleViewChange,
    handleNewsClick,
    handleBack,
    loadArticleFromId,
  };
}
