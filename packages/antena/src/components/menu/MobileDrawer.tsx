/** @jsxImportSource solid-js */
import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import SourceLogo from '../common/SourceLogo';
import MaterialIcon from '../common/MaterialIcon';

export interface DrawerStats {
  total_news: number;
  active_sources: number;
  news_today: number;
}

export interface DrawerCategory {
  name: string;
  slug: string;
  icon: string;
}

export interface DrawerSource {
  name: string;
  biasColor: string;
  count: number;
}

export interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  stats: DrawerStats | null;
  savedCount: number;
  unreadCount: number;
  activeFeedTab: string;
  onNavigate: (view: 'feed' | 'bookmarks') => void;
  onSelectTab: (tab: string) => void;
  onSelectCategory: (cat: string) => void;
  categories: DrawerCategory[];
  topSources: DrawerSource[];
  activeCategory: string;
}

interface AccordionProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: any;
}

function Accordion(props: AccordionProps) {
  return (
    <div>
      <button
        type="button"
        onClick={props.onToggle}
        class="w-full flex items-center justify-between px-4 pt-4 pb-2"
        aria-expanded={props.open}
      >
        <span
          class="text-[10px] font-extrabold uppercase tracking-widest"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {props.title}
        </span>
        <MaterialIcon name="expand_more" size="base" class="text-base transition-transform duration-200" style={{ color: 'var(--text-tertiary)', transform: props.open ? 'rotate(180deg)' : 'rotate(0deg)' }} aria-hidden="true" />
      </button>
      <Show when={props.open}>
        <div>{props.children}</div>
      </Show>
    </div>
  );
}

export default function MobileDrawer(props: MobileDrawerProps) {
  const [activityOpen, setActivityOpen] = createSignal(true);
  const [exploreOpen, setExploreOpen] = createSignal(true);
  const [sourcesOpen, setSourcesOpen] = createSignal(true);

  let touchStartX = 0;
  let touchStartY = 0;
  let touchCurrentX = 0;
  let dragging = false;

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && props.open) {
        e.preventDefault();
        props.onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    touchStartX = t.clientX;
    touchStartY = t.clientY;
    touchCurrentX = touchStartX;
    dragging = true;
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!dragging) return;
    const t = e.touches[0];
    if (!t) return;
    touchCurrentX = t.clientX;
  };

  const onTouchEnd = () => {
    if (!dragging) return;
    dragging = false;
    const dx = touchCurrentX - touchStartX;
    const dy = Math.abs(touchCurrentX - touchStartX ? (touchCurrentX - touchStartX) : 0);
    if (dx < -50 && Math.abs(touchCurrentX - touchStartX) > Math.abs(touchCurrentX - touchStartY)) {
      props.onClose();
    }
    touchStartX = 0;
    touchStartY = 0;
    touchCurrentX = 0;
    void dy;
  };

  const handleNavigateFeed = () => {
    props.onNavigate('feed');
    props.onClose();
  };

  const handleNavigateBookmarks = () => {
    props.onNavigate('bookmarks');
    props.onClose();
  };

  const handleSelectTab = (tab: string) => {
    props.onSelectTab(tab);
    props.onClose();
  };

  const handleSelectCategory = (cat: string) => {
    props.onSelectCategory(cat);
    props.onClose();
  };

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-[var(--backdrop-z)] bg-black/50 animate-[fadeIn_200ms_ease]"
        onClick={props.onClose}
        aria-hidden="true"
      />
      <aside
        class="fixed top-0 left-0 h-full z-[var(--drawer-z)] overflow-y-auto transition-transform duration-300 ease-out"
        style={{
          width: 'var(--drawer-width)',
          'max-width': '420px',
          background: 'var(--bg-elevated)',
          'box-shadow': 'var(--drawer-shadow)',
          transform: 'translateX(0)',
          'padding-top': 'env(safe-area-inset-top, 0px)',
          'padding-bottom': 'env(safe-area-inset-bottom, 0px)',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        role="dialog"
        aria-modal="true"
        aria-label="Menú principal"
      >
        <header
          class="flex items-center justify-between px-4 py-4 border-b border-border-base"
        >
          <div class="flex items-center gap-3 min-w-0">
            <div
              class="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
              style={{ background: 'var(--accent)' }}
            >
              <span
                class="text-white font-extrabold text-lg leading-none"
                style={{ 'font-family': 'var(--font-display)' }}
              >
                A
              </span>
            </div>
            <div class="min-w-0">
              <p
                class="text-base font-extrabold truncate"
                style={{ color: 'var(--text-primary)', 'font-family': 'var(--font-display)' }}
              >
                Antena
              </p>
              <p
                class="text-[10px] font-semibold uppercase tracking-wider truncate"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Noticias en vivo
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            class="w-10 h-10 flex items-center justify-center rounded-full transition-colors hover:bg-bg-hover shrink-0"
            aria-label="Cerrar menú"
          >
            <MaterialIcon name="close" size="xl" class="text-[24px] " style={{ color: 'var(--text-secondary)' }} />
          </button>
        </header>

        <Show when={props.stats}>
          <div
            class="px-4 py-3 border-b border-border-base"
            style={{ background: 'var(--bg-base)' }}
          >
            <p
              class="text-[11px] font-semibold"
              style={{ color: 'var(--text-secondary)' }}
            >
              Hoy: <strong style={{ color: 'var(--text-primary)' }}>{props.stats!.news_today}</strong> notas
              {' · '}
              <strong style={{ color: 'var(--text-primary)' }}>{props.stats!.active_sources}</strong> medios activos
              {' · '}
              <strong style={{ color: 'var(--text-primary)' }}>{props.stats!.total_news}</strong> totales
            </p>
          </div>
        </Show>

        <Accordion
          title="Mi actividad"
          open={activityOpen()}
          onToggle={() => setActivityOpen(!activityOpen())}
        >
          <button
            type="button"
            onClick={handleNavigateFeed}
            class="w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-bg-hover"
            style={{
              color: 'var(--text-primary)',
              'font-weight': props.activeFeedTab === 'home' ? '700' : '500',
            }}
          >
            <MaterialIcon name="home" size="lg" class="text-[20px] " style={{ color: props.activeFeedTab === 'home' ? 'var(--accent)' : 'var(--text-secondary)' }} />
            Inicio
            <Show when={props.unreadCount > 0}>
              <span
                class="ml-auto text-[10px] font-extrabold px-1.5 py-0.5 rounded-full"
                style={{ background: 'var(--accent)', color: '#fff' }}
              >
                {props.unreadCount}
              </span>
            </Show>
          </button>
          <button
            type="button"
            onClick={() => handleSelectTab('for-you')}
            class="w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-bg-hover"
            style={{
              color: 'var(--text-primary)',
              'font-weight': props.activeFeedTab === 'for-you' ? '700' : '500',
            }}
          >
            <MaterialIcon name="auto_awesome" size="lg" class="text-[20px] " style={{ color: props.activeFeedTab === 'for-you' ? 'var(--accent)' : 'var(--text-secondary)' }} />
            Para vos
          </button>
          <button
            type="button"
            onClick={() => handleSelectTab('following')}
            class="w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-bg-hover"
            style={{
              color: 'var(--text-primary)',
              'font-weight': props.activeFeedTab === 'following' ? '700' : '500',
            }}
          >
            <MaterialIcon name="group" size="lg" class="text-[20px] " style={{ color: props.activeFeedTab === 'following' ? 'var(--accent)' : 'var(--text-secondary)' }} />
            Siguiendo
          </button>
          <button
            type="button"
            onClick={handleNavigateBookmarks}
            class="w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-bg-hover"
            style={{ color: 'var(--text-primary)', 'font-weight': '500' }}
          >
            <MaterialIcon name="bookmark" size="lg" class="text-[20px] " style={{ color: 'var(--text-secondary)' }} />
            Guardados
            <Show when={props.savedCount > 0}>
              <span
                class="ml-auto text-[10px] font-extrabold px-1.5 py-0.5 rounded-full"
                style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
              >
                {props.savedCount}
              </span>
            </Show>
          </button>
          <button
            type="button"
            class="w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-bg-hover"
            style={{ color: 'var(--text-primary)', 'font-weight': '500' }}
          >
            <MaterialIcon name="history" size="lg" class="text-[20px] " style={{ color: 'var(--text-secondary)' }} />
            Historial
          </button>
        </Accordion>

        <Accordion
          title="Explorar"
          open={exploreOpen()}
          onToggle={() => setExploreOpen(!exploreOpen())}
        >
          <div class="flex flex-wrap gap-1.5 px-4 pb-3">
            <For each={props.categories}>
              {(cat) => {
                const isActive = () => props.activeCategory === cat.slug;
                return (
                  <button
                    type="button"
                    onClick={() => handleSelectCategory(cat.slug)}
                    class="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-full min-h-[32px] transition-colors"
                    style={
                      isActive()
                        ? { background: 'var(--accent)', color: '#fff' }
                        : { background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border-base)' }
                    }
                  >
                    <MaterialIcon name={cat.icon} size="xs" class="text-[14px] " style={{ 'font-variation-settings': "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 16" }} aria-hidden="true" />
                    {cat.name}
                  </button>
                );
              }}
            </For>
          </div>
        </Accordion>

        <Accordion
          title="Medios"
          open={sourcesOpen()}
          onToggle={() => setSourcesOpen(!sourcesOpen())}
        >
          <ul class="pb-2" role="list">
            <For each={props.topSources.slice(0, 5)}>
              {(source) => (
                <li>
                  <div
                    class="w-full flex items-center gap-3 px-4 py-2.5 text-sm"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    <SourceLogo
                      source={source.name}
                      size={28}
                      showBiasDot={false}
                    />
                    <span class="flex-1 min-w-0 truncate font-medium">{source.name}</span>
                    <span
                      class="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ 'background-color': source.biasColor }}
                      aria-hidden="true"
                    />
                    <span
                      class="text-[10px] font-bold uppercase tracking-wider shrink-0"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      {source.count}
                    </span>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Accordion>

        <div class="px-4 py-4 border-t border-border-base">
          <a
            href="/settings"
            class="w-full flex items-center gap-3 px-0 py-2 text-sm transition-colors"
            style={{ color: 'var(--text-secondary)' }}
          >
            <MaterialIcon name="settings" size="lg" class="text-[20px] " style={{ color: 'var(--text-tertiary)' }} />
            Configuración
          </a>
        </div>
      </aside>
    </Show>
  );
}
