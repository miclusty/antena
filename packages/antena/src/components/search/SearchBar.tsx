/** @jsxImportSource solid-js */
import { Show, createSignal, createEffect, onCleanup } from 'solid-js';
import { useHaptic } from '../../lib/haptic';
import { searchNews, type SearchResult } from '../../lib/search';

interface SearchBarProps {
  onSubmit: (query: string) => void;
  onSelect?: (result: SearchResult) => void;
  placeholder?: string;
  autoFocus?: boolean;
  initialValue?: string;
  showSuggestions?: boolean;
}

const DEBOUNCE_MS = 250;

export default function SearchBar(props: SearchBarProps) {
  const haptic = useHaptic();
  const [value, setValue] = createSignal(props.initialValue || '');
  const [suggestions, setSuggestions] = createSignal<SearchResult[]>([]);
  const [showList, setShowList] = createSignal(false);
  const [loading, setLoading] = createSignal(false);

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let reqSeq = 0;
  let inputRef: HTMLInputElement | undefined;

  createEffect(() => {
    const v = value();
    if (!props.showSuggestions) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    if (v.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    debounceTimer = setTimeout(async () => {
      const mySeq = ++reqSeq;
      setLoading(true);
      try {
        const res = await searchNews(v.trim(), 5);
        if (mySeq === reqSeq) setSuggestions(res.results.slice(0, 5));
      } catch {
        if (mySeq === reqSeq) setSuggestions([]);
      } finally {
        if (mySeq === reqSeq) setLoading(false);
      }
    }, DEBOUNCE_MS);
  });

  onCleanup(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
  });

  const onInput = (e: InputEvent & { currentTarget: HTMLInputElement }) => {
    setValue(e.currentTarget.value);
    if (e.currentTarget.value.trim().length > 0) setShowList(true);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      setShowList(false);
      inputRef?.blur();
    }
  };

  const submit = () => {
    const v = value().trim();
    if (!v) return;
    haptic.vibrate('tap');
    setShowList(false);
    props.onSubmit(v);
  };

  const onSelect = (r: SearchResult) => {
    haptic.vibrate('selection');
    setShowList(false);
    setValue(r.title);
    if (props.onSelect) props.onSelect(r);
    else props.onSubmit(r.title);
  };

  const onClear = () => {
    setValue('');
    setSuggestions([]);
    setShowList(false);
    inputRef?.focus();
  };

  const onBlur = () => {
    setTimeout(() => setShowList(false), 120);
  };

  return (
    <div class="relative w-full">
      <div
        class="flex items-center h-11 px-3.5 rounded-full border border-border-base transition-all"
        style={{
          background: 'var(--bg-elevated)',
        }}
      >
        <span
          class="material-symbols-rounded text-lg leading-none mr-2"
          style={{
            color: 'var(--text-tertiary)',
            'font-variation-settings': "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20",
          }}
          aria-hidden="true"
        >
          search
        </span>
        <input
          ref={inputRef}
          type="search"
          value={value()}
          onInput={onInput}
          onKeyDown={onKeyDown}
          onFocus={() => value().trim().length > 0 && setShowList(true)}
          onBlur={onBlur}
          placeholder={props.placeholder || 'Buscar en Antena...'}
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck={false}
          class="flex-1 min-w-0 h-full bg-transparent text-sm text-text-primary placeholder-text-tertiary focus:outline-none"
          style={{ 'min-height': '44px' }}
        />
        <Show when={loading()}>
          <span
            class="material-symbols-rounded text-lg leading-none ml-1 animate-spin"
            style={{
              color: 'var(--text-tertiary)',
              'font-variation-settings': "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20",
              animation: 'spin 1s linear infinite',
            }}
            aria-hidden="true"
          >
            progress_activity
          </span>
        </Show>
        <Show when={!loading() && value().length > 0}>
          <button
            type="button"
            onClick={onClear}
            aria-label="Limpiar busqueda"
            class="ml-1 w-7 h-7 rounded-full flex items-center justify-center hover:bg-bg-hover active:scale-90 transition-all"
          >
            <span
              class="material-symbols-rounded text-base leading-none"
              style={{
                color: 'var(--text-tertiary)',
                'font-variation-settings': "'FILL' 1, 'wght' 300, 'GRAD' 0, 'opsz' 20",
              }}
              aria-hidden="true"
            >
              close
            </span>
          </button>
        </Show>
      </div>
      <Show when={showList() && suggestions().length > 0}>
        <div
          class="absolute left-0 right-0 top-full mt-1.5 z-40 rounded-2xl border border-border-base overflow-hidden"
          style={{
            background: 'var(--bg-elevated)',
            'box-shadow': 'var(--shadow-md)',
          }}
          role="listbox"
        >
          {suggestions().map((s) => (
            <button
              type="button"
              onClick={() => onSelect(s)}
              class="w-full flex items-start gap-3 px-4 min-h-[44px] py-2.5 text-left hover:bg-bg-hover active:bg-bg-hover transition-colors border-b border-border-base last:border-b-0"
              role="option"
            >
              <span
                class="material-symbols-rounded text-lg leading-none mt-0.5"
                style={{
                  color: 'var(--text-tertiary)',
                  'font-variation-settings': "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20",
                }}
                aria-hidden="true"
              >
                article
              </span>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-text-primary truncate">
                  {s.title}
                </div>
                <Show when={s.source || s.category}>
                  <div class="text-xs text-text-tertiary truncate mt-0.5">
                    <Show when={s.source}>{s.source}</Show>
                    <Show when={s.source && s.category}> · </Show>
                    <Show when={s.category}>{s.category}</Show>
                  </div>
                </Show>
              </div>
            </button>
          ))}
        </div>
      </Show>
    </div>
  );
}
