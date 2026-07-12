/** @jsxImportSource solid-js */
import { For, Show } from "solid-js";
import type { EntitySummary } from "../../lib/api";
import MaterialIcon from "./MaterialIcon";

const TYPE_LABEL: Record<EntitySummary["type"], string> = {
  person: "Persona",
  place: "Lugar",
  org: "Organización",
  event: "Evento",
};

const TYPE_ICON: Record<EntitySummary["type"], string> = {
  person: "person",
  place: "place",
  org: "domain",
  event: "event",
};

export interface EntityChipRowProps {
  entities: EntitySummary[];
  /** Translation key prefix for the section heading, e.g.
   *  "Personas/entidades mencionadas" or "Personas que más cubre".
   *  Plain string — i18n happens at the call site by passing the
   *  already-translated heading text. */
  heading: string;
}

export default function EntityChipRow(props: EntityChipRowProps) {
  return (
    <Show when={props.entities.length > 0}>
      <section class="px-4 py-3 border-t border-border-base">
        <h2
          class="text-[10px] font-extrabold uppercase tracking-widest mb-3"
          style={{ color: "var(--text-tertiary)" }}
        >
          {props.heading}
        </h2>
        <ul class="flex flex-wrap gap-2">
          <For each={props.entities}>
            {(e) => (
              <li>
                <a
                  href={`/buscar?q=${encodeURIComponent(e.name)}`}
                  class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold transition-colors hover:opacity-80"
                  style={{
                    background: "var(--accent-muted)",
                    color: "var(--accent)",
                    border: "1px solid var(--border-base)",
                  }}
                  title={`${TYPE_LABEL[e.type] ?? e.type} · ${e.mention_count ?? 0} menciones`}
                >
                  <MaterialIcon
                    name={TYPE_ICON[e.type] ?? "label"}
                    size="sm"
                    class="text-sm"
                    aria-hidden="true"
                  />
                  <span class="truncate max-w-[12ch]">{e.name}</span>
                </a>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}
