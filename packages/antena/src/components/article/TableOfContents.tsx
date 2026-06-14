/** @jsxImportSource solid-js */
import { For, Show, createSignal } from "solid-js";
import MaterialIcon from '../common/MaterialIcon';

interface TocItem {
  level: 2 | 3;
  text: string;
  id: string;
}

interface TableOfContentsProps {
  items: TocItem[];
}

/**
 * Table of contents. Sticky on the right side on desktop
 * (rendered separately by the parent), inline-collapsible on
 * mobile (parent decides). Click → smooth-scroll to the
 * heading; the body sections are rendered with the matching
 * id by the parent.
 *
 * Renders nothing when fewer than 2 entries (a single
 * heading doesn't justify the chrome).
 */
export default function TableOfContents(props: TableOfContentsProps) {
  const [collapsed, setCollapsed] = createSignal(false);

  const handleClick = (e: MouseEvent, id: string) => {
    const el = typeof document !== "undefined" ? document.getElementById(id) : null;
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    // Update the URL hash without jumping.
    if (typeof history !== "undefined" && history.replaceState) {
      history.replaceState(null, "", `#${id}`);
    }
  };

  return (
    <Show when={props.items.length >= 2}>
      <nav
        class="rounded-xl border p-3"
        style={{ background: "var(--bg-elevated)", "border-color": "var(--border-base)" }}
        aria-label="Tabla de contenidos"
      >
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          class="w-full flex items-center justify-between gap-2"
          aria-expanded={!collapsed()}
          aria-controls="toc-list"
        >
          <span
            class="text-[10px] font-extrabold uppercase tracking-widest"
            style={{ color: "var(--text-tertiary)" }}
          >
            Contenido
          </span>
          <MaterialIcon name="expand_more" size="base" class="text-base transition-transform" style={{ color: "var(--text-tertiary)", "font-variation-settings": "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 18", transform: collapsed() ? "rotate(-90deg)" : "rotate(0deg)", }} aria-hidden="true" />
        </button>
        <Show when={!collapsed()}>
          <ol id="toc-list" class="mt-2 space-y-0.5">
            <For each={props.items}>
              {(item) => (
                <li>
                  <a
                    href={`#${item.id}`}
                    onClick={(e) => handleClick(e, item.id)}
                    class="block text-sm leading-snug py-1 pr-1 rounded hover:bg-bg-hover transition-colors"
                    style={{
                      "padding-left": item.level === 3 ? "0.75rem" : "0.25rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {item.text}
                  </a>
                </li>
              )}
            </For>
          </ol>
        </Show>
      </nav>
    </Show>
  );
}
