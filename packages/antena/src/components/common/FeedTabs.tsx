/** @jsxImportSource solid-js */
import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import type { Category } from '../../lib/types';
import MaterialIcon from '../common/MaterialIcon';

export interface FeedTab {
  id: string;
  label: string;
  /** Optional category slug — present for category tabs, absent for the
   *  built-in home/following/explore tabs. */
  category?: string;
}

interface FeedTabsProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
  /** Tabs that have been added on top of the defaults (excluding
   *  the built-in ones). Used so the user can remove a custom
   *  tab they previously added. */
  customTabs: FeedTab[];
  onAddCustomTab: (category: Category) => void;
  onRemoveCustomTab: (tabId: string) => void;
  /** All categories that can be added as a tab. The picker
   *  shows the ones that aren't already in `customTabs`. */
  availableCategories: Category[];
  tabs?: FeedTab[];
  visible?: boolean;
}

const DEFAULT_TABS: FeedTab[] = [
  { id: 'home', label: 'Para vos' },
  { id: 'following', label: 'Siguiendo' },
  { id: 'explore', label: 'Explorar' },
];

export default function FeedTabs(props: FeedTabsProps) {
  const tabs = () => props.tabs || DEFAULT_TABS;
  const visible = () => props.visible !== false;

  const [pickerOpen, setPickerOpen] = createSignal(false);
  let pickerRef: HTMLDivElement | undefined;

  // Close the picker when clicking outside it. The listener is
  // attached on mount (client-only) and detached on cleanup.
  // We can't attach during the component's top-level evaluation
  // because that runs during SSR, where `document` doesn't exist.
  const onDocClick = (e: MouseEvent) => {
    if (!pickerRef) return;
    if (!pickerOpen()) return;
    if (e.target instanceof Node && !pickerRef.contains(e.target)) {
      setPickerOpen(false);
    }
  };
  onMount(() => {
    document.addEventListener('click', onDocClick);
  });
  onCleanup(() => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('click', onDocClick);
    }
  });

  // Categories already added as custom tabs (by slug) — hide them
  // from the picker so the user can't add duplicates.
  const pickedSlugs = () => new Set(props.customTabs.map((t) => t.category));
  const pickable = () =>
    props.availableCategories.filter((c) => !pickedSlugs().has(c.slug));

  return (
    <div
      class="sticky top-[var(--header-height)] z-30 bg-bg-base/85 backdrop-blur-xl border-b border-border-base/10 transition-transform duration-200 ease-out"
      classList={{ '-translate-y-full': !visible() }}
      style={{ 'will-change': 'transform' }}
    >
      <div
        class="flex items-center overflow-x-auto scrollbar-hide px-4"
        style={{ 'scrollbar-width': 'none', '-ms-overflow-style': 'none' }}
      >
        <For each={tabs()}>
          {(tab) => {
            const isActive = () => props.activeTab === tab.id;
            return (
              <button
                onClick={() => props.onTabChange(tab.id)}
                class="relative flex items-center gap-1.5 min-h-[44px] px-3 py-3 text-sm font-semibold whitespace-nowrap transition-colors duration-150 active:scale-95"
                style={{ color: isActive() ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                aria-current={isActive() ? 'page' : undefined}
              >
                <span>{tab.label}</span>
                <Show when={isActive()}>
                  <span
                    class="absolute bottom-0 left-2 right-2 h-0.5 rounded-full"
                    style={{ 'background-color': 'var(--accent)' }}
                  />
                </Show>
              </button>
            );
          }}
        </For>

        <For each={props.customTabs}>
          {(tab) => {
            const isActive = () => props.activeTab === tab.id;
            return (
              <div class="relative flex items-center">
                <button
                  onClick={() => props.onTabChange(tab.id)}
                  class="relative flex items-center gap-1.5 min-h-[44px] pl-3 pr-1 py-3 text-sm font-semibold whitespace-nowrap transition-colors duration-150 active:scale-95"
                  style={{ color: isActive() ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                  aria-current={isActive() ? 'page' : undefined}
                >
                  <span>{tab.label}</span>
                  <Show when={isActive()}>
                    <span
                      class="absolute bottom-0 left-2 right-2 h-0.5 rounded-full"
                      style={{ 'background-color': 'var(--accent)' }}
                    />
                  </Show>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onRemoveCustomTab(tab.id);
                  }}
                  class="flex items-center justify-center w-7 h-7 rounded-full hover:bg-bg-hover text-text-tertiary"
                  aria-label={`Quitar pestaña ${tab.label}`}
                >
                  <MaterialIcon name="close" size="base" class="text-base " style={{ }} />
                </button>
              </div>
            );
          }}
        </For>

        {/* "+" add tab button + picker */}
        <div class="relative ml-1" ref={pickerRef}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPickerOpen((v) => !v);
            }}
            class="flex items-center justify-center w-10 h-10 rounded-full hover:bg-bg-hover transition-colors"
            aria-label="Añadir pestaña"
            aria-expanded={pickerOpen()}
            aria-haspopup="listbox"
          >
            <MaterialIcon name="add" size="lg" class="text-lg text-text-tertiary" style={{ }} />
          </button>

          <Show when={pickerOpen()}>
            <div
              class="absolute left-0 top-full mt-2 z-40 min-w-[200px] rounded-2xl border border-border-base overflow-hidden"
              style={{
                'background-color': 'var(--bg-elevated)',
                'box-shadow': 'var(--shadow-md)',
              }}
              role="listbox"
            >
              <Show
                when={pickable().length > 0}
                fallback={
                  <p class="px-4 py-3 text-sm text-text-tertiary">
                    Ya agregaste todas las categorías.
                  </p>
                }
              >
                <For each={pickable()}>
                  {(cat) => (
                    <button
                      type="button"
                      role="option"
                      onClick={() => {
                        props.onAddCustomTab(cat);
                        setPickerOpen(false);
                      }}
                      class="w-full flex items-center gap-3 px-4 min-h-[44px] py-2 text-left hover:bg-bg-hover active:bg-bg-hover transition-colors"
                    >
                      <MaterialIcon name={cat.icon} size="lg" class="text-lg text-text-tertiary" style={{ 'font-variation-settings': "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20" }} aria-hidden="true" />
                      <span class="text-sm font-medium text-text-primary">
                        {cat.name}
                      </span>
                    </button>
                  )}
                </For>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
