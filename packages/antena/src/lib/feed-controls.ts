// Helpers for resolving FeedTabs selections in the App component.
// Extracted so the logic is testable and so the inline onTabChange
// callback in App.tsx stays declarative.

export interface CategoryOption {
  /** Display name in the user's language (matches what the API
   *  expects in the `?category=` query param, e.g. "Tecnología"). */
  name: string;
  /** URL-safe slug used inside the `cat:<slug>` tab id, e.g.
   *  "tecnologia". The picker in FeedTabs uses this to dedupe. */
  slug: string;
}

export interface ResolvedCustomTab {
  /** Category name to send to the API. `null` means "no category
   *  filter, show the home/explore/following feed". */
  categoryName: string | null;
  /** Slug extracted from the tab id, useful for telemetry and
   *  for keying the new custom-tab list. `null` for built-in tabs. */
  slug: string | null;
  /** True when switching to this tab should reset the feed's
   *  offset and accumulated `allNews` — i.e. a category tab
   *  (custom or unknown) that filters the results. */
  shouldReset: boolean;
}

const BUILT_IN_TABS = new Set(["home", "following", "explore", "for-you", "foryou"]);

/**
 * Pure function: given a `tabId` from FeedTabs and the full list
 * of available categories, returns the new feed filter state.
 *
 * Use this in `onTabChange` to decide whether to call
 * `setActiveCategory(...)` AND `resetFeed()` atomically — fixing
 * the bug where switching between custom category tabs left stale
 * news on screen until the new fetch returned.
 */
export function resolveCustomTabSelection(
  tabId: string,
  categories: CategoryOption[],
): ResolvedCustomTab {
  if (BUILT_IN_TABS.has(tabId)) {
    return { categoryName: null, slug: null, shouldReset: false };
  }

  if (tabId.startsWith("cat:")) {
    const slug = tabId.slice(4);
    const cat = categories.find((c) => c.slug === slug);
    return {
      categoryName: cat?.name ?? null,
      slug,
      shouldReset: true,
    };
  }

  return { categoryName: null, slug: null, shouldReset: false };
}
