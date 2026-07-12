/** @jsxImportSource solid-js */
import { For, Show, createMemo } from "solid-js";
import type { ApiNewsCard, EntityDetail, EntitySummary, EntityTimelinePoint } from "../../lib/api";
import { articleCanonicalPath } from "../../lib/urlState";
import { entitySlugify } from "../../lib/slugify";
import MentionSparkline from "./MentionSparkline";
import MaterialIcon from "../common/MaterialIcon";

// ═══════════════════════════════════════════
// EntityDetailView
// ═══════════════════════════════════════════
// Renders the entity profile: header (name + type badge + counts),
// 30-day mention sparkline, recent articles, top sources covering
// this entity, and co-occurrence neighbors. All data is passed in
// as props — the Astro page (`/entidad/[slug].astro`) does the
// fetch at build time so this view stays static-friendly.

const TYPE_LABEL: Record<EntityDetail["type"], string> = {
  person: "Persona",
  place: "Lugar",
  org: "Organización",
  event: "Evento",
};

const TYPE_ICON: Record<EntityDetail["type"], string> = {
  person: "person",
  place: "place",
  org: "domain",
  event: "event",
};

const TYPE_COLOR: Record<EntityDetail["type"], string> = {
  person: "var(--accent)",
  place: "var(--info)",
  org: "var(--warning)",
  event: "var(--bias-neutral)",
};

export interface EntitySourceRef {
  id: number;
  name: string;
  slug: string;
  articleCount: number;
}

export interface EntityDetailViewProps {
  entity: EntityDetail;
  timeline: EntityTimelinePoint[];
  articles: ApiNewsCard[];
  topSources: EntitySourceRef[];
}

function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-AR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatMentionCount(n: number | null | undefined): string {
  const v = n ?? 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toLocaleString("es-AR");
}

export default function EntityDetailView(props: EntityDetailViewProps) {
  // Prefer the canonical /<y>/<m>/<d>/<slug>/ URL when the article
  // has both slug and slug_date; otherwise fall back to the legacy
  // /noticia/<id> route so older (un-backfilled) cards still work.
  const articleHref = (a: ApiNewsCard): string => {
    if (a.slug && a.slug_date) {
      const canonical = articleCanonicalPath(a.slug, a.slug_date, a.id);
      if (canonical.startsWith("/") && !canonical.startsWith("/?")) return canonical;
    }
    return `/noticia/${encodeURIComponent(a.id)}`;
  };

  const related = createMemo<EntitySummary[]>(() => props.entity.related ?? []);

  return (
    <div class="w-full max-w-2xl mx-auto px-4 py-6" data-testid="entity-detail-view">
      {/* ── Header ─────────────────────────────────────────── */}
      <header class="mb-6">
        <div class="flex items-start gap-3">
          <span
            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider shrink-0"
            style={{
              background: "var(--bg-elevated)",
              color: TYPE_COLOR[props.entity.type] ?? "var(--text-secondary)",
              border: `1px solid ${TYPE_COLOR[props.entity.type] ?? "var(--border-base)"}`,
            }}
            aria-label={`Tipo de entidad: ${TYPE_LABEL[props.entity.type] ?? props.entity.type}`}
          >
            <MaterialIcon name={TYPE_ICON[props.entity.type] ?? "label"} size="sm" class="text-sm" aria-hidden="true" />
            {TYPE_LABEL[props.entity.type] ?? props.entity.type}
          </span>
          <h1
            class="text-2xl md:text-3xl font-bold leading-tight flex-1"
            style={{ color: "var(--text-primary)", "font-family": "var(--font-display)" }}
          >
            {props.entity.name}
          </h1>
        </div>
        <p class="mt-3 text-sm" style={{ color: "var(--text-secondary)" }}>
          <strong class="tabular-nums" style={{ color: "var(--accent)" }}>
            {formatMentionCount(props.entity.mention_count)}
          </strong>{" "}
          menciones en Antena
        </p>
        <p class="mt-1 text-xs" style={{ color: "var(--text-tertiary)" }}>
          Primera mención: {formatDate(props.entity.first_seen)}
          {" · "}
          Última mención: {formatDate(props.entity.last_seen)}
        </p>
      </header>

      <hr class="my-4" style={{ "border-color": "var(--border-base)" }} />

      {/* ── Sparkline ─────────────────────────────────────── */}
      <section class="mb-6" aria-labelledby="sparkline-h">
        <h2
          id="sparkline-h"
          class="text-[10px] font-extrabold uppercase tracking-widest mb-2"
          style={{ color: "var(--text-tertiary)" }}
        >
          <MaterialIcon name="trending_up" size="sm" class="text-sm mr-1 align-middle" aria-hidden="true" />
          Menciones por día (últimos 30 días)
        </h2>
        <MentionSparkline data={props.timeline} days={30} />
      </section>

      <hr class="my-4" style={{ "border-color": "var(--border-base)" }} />

      {/* ── Top sources covering this entity ───────────────── */}
      <Show when={props.topSources.length > 0}>
        <section class="mb-6" aria-labelledby="sources-h">
          <h2
            id="sources-h"
            class="text-[10px] font-extrabold uppercase tracking-widest mb-3"
            style={{ color: "var(--text-tertiary)" }}
          >
            <MaterialIcon name="campaign" size="sm" class="text-sm mr-1 align-middle" aria-hidden="true" />
            Cubierto por
          </h2>
          <ul class="flex flex-col gap-2">
            <For each={props.topSources}>
              {(s) => (
                <li>
                  <a
                    href={`/fuentes/${s.slug}`}
                    class="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border transition-colors hover:bg-bg-hover"
                    style={{ "border-color": "var(--border-base)" }}
                  >
                    <span class="flex items-center gap-2 min-w-0">
                      <span
                        class="w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold shrink-0"
                        style={{ background: "var(--accent-muted)", color: "var(--accent)" }}
                        aria-hidden="true"
                      >
                        {s.name.charAt(0).toUpperCase()}
                      </span>
                      <span class="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                        {s.name}
                      </span>
                    </span>
                    <span class="text-xs tabular-nums shrink-0" style={{ color: "var(--text-tertiary)" }}>
                      {formatMentionCount(s.articleCount)} notas
                    </span>
                  </a>
                </li>
              )}
            </For>
          </ul>
        </section>
        <hr class="my-4" style={{ "border-color": "var(--border-base)" }} />
      </Show>

      {/* ── Recent articles mentioning this entity ─────────── */}
      <section class="mb-6" aria-labelledby="articles-h">
        <h2
          id="articles-h"
          class="text-[10px] font-extrabold uppercase tracking-widest mb-3"
          style={{ color: "var(--text-tertiary)" }}
        >
          <MaterialIcon name="article" size="sm" class="text-sm mr-1 align-middle" aria-hidden="true" />
          Artículos recientes
        </h2>
        <Show
          when={props.articles.length > 0}
          fallback={
            <p class="text-sm italic" style={{ color: "var(--text-tertiary)" }}>
              Aún no tenemos notas para esta entidad.
            </p>
          }
        >
          <ul class="flex flex-col gap-3">
            <For each={props.articles}>
              {(a) => (
                <li>
                  <a
                    href={articleHref(a)}
                    class="block rounded-xl border p-3 transition-colors hover:bg-bg-hover"
                    style={{ "border-color": "var(--border-base)" }}
                  >
                    <p
                      class="text-[10px] font-bold uppercase tracking-wider mb-1"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      {a.source_name ?? a.source_names?.[0] ?? "Antena"}
                      {a.published_at && (
                        <>
                          {" · "}
                          <time datetime={a.published_at}>{formatDate(a.published_at)}</time>
                        </>
                      )}
                    </p>
                    <h3
                      class="text-sm font-semibold leading-snug line-clamp-2"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {a.title}
                    </h3>
                  </a>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      {/* ── Co-occurrence neighbors ────────────────────────── */}
      <Show when={related().length > 0}>
        <hr class="my-4" style={{ "border-color": "var(--border-base)" }} />
        <section class="mb-6" aria-labelledby="related-h">
          <h2
            id="related-h"
            class="text-[10px] font-extrabold uppercase tracking-widest mb-3"
            style={{ color: "var(--text-tertiary)" }}
          >
            <MaterialIcon name="hub" size="sm" class="text-sm mr-1 align-middle" aria-hidden="true" />
            Relacionado con
          </h2>
          <ul class="flex flex-wrap gap-2">
            <For each={related()}>
              {(r) => (
                <li>
                  <a
                    href={`/entidad/${entitySlugify(r.name)}`}
                    class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold transition-colors hover:opacity-80"
                    style={{
                      background: "var(--accent-muted)",
                      color: "var(--accent)",
                      border: "1px solid var(--border-base)",
                    }}
                    title={`${TYPE_LABEL[r.type] ?? r.type} · ${formatMentionCount(r.mention_count)} menciones`}
                  >
                    <MaterialIcon
                      name={TYPE_ICON[r.type] ?? "label"}
                      size="sm"
                      class="text-sm"
                      aria-hidden="true"
                    />
                    <span class="truncate max-w-[16ch]">{r.name}</span>
                  </a>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
    </div>
  );
}