/** @jsxImportSource solid-js */
import { For, Show } from 'solid-js';
import MaterialIcon from '../common/MaterialIcon';

export type TabId = 'home' | 'search' | 'bookmarks' | 'menu' | 'live';

interface Tab {
  id: TabId;
  label: string;
  icon: string;
  iconOutline: string;
  smallLabel?: boolean;
  live?: boolean;
}

const TABS: Tab[] = [
  { id: 'home',      label: 'Inicio',    icon: 'home',           iconOutline: 'home' },
  { id: 'live',      label: 'En Vivo',   icon: 'flash_on',       iconOutline: 'flash_on', smallLabel: true, live: true },
  { id: 'search',    label: 'Buscar',    icon: 'search',         iconOutline: 'search' },
  { id: 'bookmarks', label: 'Guardados', icon: 'bookmark',       iconOutline: 'bookmark_border' },
  { id: 'menu',      label: 'Menú',      icon: 'menu',           iconOutline: 'menu' },
];

interface BottomNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  unreadCount?: number;
  savedCount?: number;
}

export default function BottomNav(props: BottomNavProps) {
  return (
    <nav
      class="fixed bottom-0 left-0 right-0 z-50 bg-bg-elevated/85 backdrop-blur-xl border-t border-border-base/10"
      style={{ 'padding-bottom': 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="Navegación principal"
    >
      <div class="flex items-center justify-around h-[var(--bottom-nav-height)] max-w-screen-md mx-auto">
        <For each={TABS}>
          {(tab) => {
            const isActive = () => props.activeTab === tab.id;
            const badge = () => {
              if (tab.id === 'home') return props.unreadCount ?? 0;
              if (tab.id === 'bookmarks') return props.savedCount ?? 0;
              return 0;
            };
            return (
              <button
                onClick={() => props.onTabChange(tab.id)}
                class="relative flex flex-col items-center justify-center gap-0.5 min-h-[48px] min-w-[64px] px-3 py-2 transition-transform duration-100 active:scale-90"
                aria-label={tab.label}
                aria-current={isActive() ? 'page' : undefined}
              >
                <span class="relative">
                  <MaterialIcon name={isActive() ? tab.icon : tab.iconOutline} size="2xl" class="text-[26px] transition-colors duration-100" style={{ color: isActive() ? 'var(--accent)' : 'var(--text-tertiary)', 'font-variation-settings': isActive() ? "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" : "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24", }} />
                  <Show when={badge() > 0}>
                    <span
                      class="absolute -top-1 -right-2 min-w-[16px] h-[16px] px-1 rounded-full text-[10px] font-extrabold leading-[16px] text-white text-center tabular-nums"
                      style={{
                        'background-color': tab.id === 'home' ? 'var(--accent)' : 'var(--text-tertiary)',
                        'box-shadow': '0 0 0 2px var(--bg-elevated)',
                      }}
                    >
                      {badge() > 99 ? '99+' : badge()}
                    </span>
                  </Show>
                </span>
                <span
                  class="leading-none font-semibold transition-colors duration-100"
                  classList={{ 'text-[11px]': !tab.smallLabel, 'text-[10px]': tab.smallLabel }}
                  style={{ color: isActive() ? 'var(--accent)' : 'var(--text-tertiary)' }}
                >
                  {tab.label}
                </span>
                <Show when={isActive() && tab.live}>
                  <span
                    class="absolute bottom-0.5 w-1 h-1 rounded-full animate-pulse"
                    style={{ 'background-color': 'var(--live-red)' }}
                  />
                </Show>
                <Show when={isActive() && !tab.live}>
                  <span
                    class="absolute bottom-0.5 w-1 h-1 rounded-full"
                    style={{ 'background-color': 'var(--accent)' }}
                  />
                </Show>
              </button>
            );
          }}
        </For>
      </div>
    </nav>
  );
}
