/** @jsxImportSource solid-js */
import { createSignal, createEffect } from 'solid-js';
import MaterialIcon from '../common/MaterialIcon';

interface SearchBarProps {
  onSearch: (query: string) => void;
}

export default function SearchBar(props: SearchBarProps) {
  const [value, setValue] = createSignal('');
  let debounceTimer: ReturnType<typeof setTimeout>;

  createEffect(() => {
    const v = value();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      props.onSearch(v);
    }, 300);
  });

  return (
    <div class="relative">
      <MaterialIcon name="search" size="lg" class="absolute left-3 top-1/2 -translate-y-1/2 text-lg " style={{ color: 'var(--text-tertiary)' }} />
      <input
        type="text"
        value={value()}
        onInput={(e) => setValue(e.currentTarget.value)}
        placeholder="Buscar en Antena..."
        class="w-full h-9 pl-10 pr-4 rounded-full bg-bg-elevated border border-border-base text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20 transition-all"
      />
    </div>
  );
}
