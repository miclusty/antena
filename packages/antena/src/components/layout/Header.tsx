/** @jsxImportSource solid-js */
import { createSignal, Show } from 'solid-js';
import SearchBar from '../common/SearchBar';
import { useTheme } from '../../lib/theme';
import MaterialIcon from '../common/MaterialIcon';

interface HeaderProps {
  activeCategory?: string;
  onCategoryChange?: (cat: string) => void;
  onSearch?: (query: string) => void;
  showBack?: boolean;
  onBack?: () => void;
  title?: string;
  children?: any;
  searchOpen?: boolean;
  onSearchOpenChange?: (open: boolean) => void;
}

export default function Header(props: HeaderProps) {
  const [localSearchOpen, setLocalSearchOpen] = createSignal(false);
  const { theme, toggleTheme } = useTheme();
  const searchOpen = () => props.searchOpen ?? localSearchOpen();
  const setSearchOpen = (v: boolean) => {
    if (props.onSearchOpenChange) props.onSearchOpenChange(v);
    else setLocalSearchOpen(v);
  };

  const themeIcon = () => {
    if (theme() === "light") return "light_mode";
    if (theme() === "dark") return "dark_mode";
    return "brightness_auto";
  };
  const themeLabel = () => {
    if (theme() === "light") return "Tema claro";
    if (theme() === "dark") return "Tema oscuro";
    return "Tema automático";
  };

  return (
    <header class="sticky top-0 bg-bg-elevated/85 backdrop-blur-xl border-b border-border-base/10" style={{ 'padding-top': 'env(safe-area-inset-top, 0px)', 'z-index': 'var(--z-sticky)' }}>
      <div class="flex items-center justify-between h-12 sm:h-14 px-3 sm:px-4">
        {/* Left: back or logo */}
        <div class="flex items-center gap-3 min-w-[80px]">
          <Show
            when={props.showBack}
            fallback={
              <div class="flex items-center gap-2">
                {/* Logo mark */}
                <div class="w-8 h-8 rounded-full flex items-center justify-center" style={{ 'background-color': 'var(--accent)' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h2v-6h-4v2h2v4zm0-8h2v6h-2V9z"/>
                    <circle cx="12" cy="12" r="3" fill="white"/>
                    <path d="M12 6v2M12 16v2M6 12h2M16 12h2" stroke="white" stroke-width="1.5"/>
                  </svg>
                </div>
                <span class="font-display font-bold text-lg tracking-tight text-text-primary hidden sm:block">
                  antena<span class="text-accent">.</span>
                </span>
              </div>
            }
          >
            <button
              onClick={props.onBack}
              class="flex items-center justify-center w-11 h-11 rounded-full hover:bg-bg-hover transition-colors"
              aria-label="Volver"
            >
              <MaterialIcon name="arrow_back" size="xl" class="text-xl text-text-primary" style={{ }} />
            </button>
          </Show>
        </div>

        {/* Center: title (for article view) */}
        <Show when={props.title}>
          <h1 class="font-display font-semibold text-base text-text-primary truncate max-w-[200px] sm:max-w-none">
            {props.title}
          </h1>
        </Show>

        {/* Right: actions */}
        <div class="flex items-center gap-1">
          {/* Theme toggle — cycles light → auto → dark */}
          <button
            onClick={toggleTheme}
            class="flex items-center justify-center w-11 h-11 rounded-full hover:bg-bg-hover transition-colors"
            aria-label={themeLabel()}
            title={themeLabel()}
          >
            <MaterialIcon name={themeIcon()} size="xl" class="text-xl text-text-secondary" style={{ 'font-variation-settings': "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20" }} />
          </button>

          {/* Search button */}
          <button
            onClick={() => setSearchOpen(!searchOpen())}
            class="flex items-center justify-center w-11 h-11 rounded-full hover:bg-bg-hover transition-colors"
            aria-label="Buscar"
          >
            <MaterialIcon name="search" size="xl" class="text-xl text-text-secondary" style={{ }} />
          </button>

          {/* Settings link */}
          <a
            href="/settings"
            class="flex items-center justify-center w-11 h-11 rounded-full hover:bg-bg-hover transition-colors"
            aria-label="Configuración"
            title="Configuración"
          >
            <MaterialIcon name="settings" size="xl" class="text-xl text-text-secondary" style={{ }} />
          </a>
        </div>
      </div>

      {/* Inline search bar (toggles open) */}
      <Show when={searchOpen()}>
        <div class="px-4 pb-3 border-b border-border-base">
          <SearchBar onSearch={(q) => {
            props.onSearch?.(q);
            setSearchOpen(false);
          }} />
        </div>
      </Show>
    </header>
  );
}