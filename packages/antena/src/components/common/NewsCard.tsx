/** @jsxImportSource solid-js */
import { createSignal, createMemo, Show, onMount, onCleanup } from 'solid-js';
import type { NewsItem } from '../../lib/types';
import { useHaptic } from '../../lib/haptic';
import { isRead } from '../../lib/db';
import { buildWhatsAppUrl } from '../../lib/share';
import { trackEvent, trackCardView, trackBookmark } from '../../lib/analytics';
import { articleCanonicalPath } from '../../lib/urlState';
import SourceLogo from './SourceLogo';
import FollowButton from './FollowButton';
import MaterialIcon from '../common/MaterialIcon';

// ─── Avatar ──────────────────────────────────────────────────
const AVATAR_COLORS = ['#FF4D5A','#F59E0B','#10B981','#3B82F6','#8B5CF6','#06B6D4','#EC4899','#EF4444'];

function avatarColor(name: string): string {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}

function initials(name: string): string {
  return name.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
}

// ─── Category palette ────────────────────────────────────────
const CAT_COLOR: Record<string, string> = {
  'Política':'#FF4D5A','Economía':'#F59E0B','Deportes':'#10B981','Policiales':'#EF4444',
  'Cultura':'#8B5CF6','Tecnología':'#3B82F6','Sociedad':'#06B6D4','Internacional':'#6366F1',
  'Clima':'#0EA5E9','Espectáculos':'#EC4899',
};

function catColor(cat: string) { return CAT_COLOR[cat] || '#6B7280'; }

// ─── Icons ───────────────────────────────────────────────────
const SVG_UP = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
const SVG_DOWN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';
const SVG_CMMT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
const SVG_RPST = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/></svg>';
const SVG_BKMK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
const SVG_SHR = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>';

const SVG_UP_20 = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
const SVG_DOWN_20 = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';
const SVG_CMMT_20 = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
const SVG_RPST_20 = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/></svg>';
const SVG_BKMK_20 = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
const SVG_SHR_20 = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>';

const SVG_OPEN = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>';
const SVG_HUB = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="2"/><circle cx="4" cy="4" r="2"/><circle cx="20" cy="4" r="2"/><circle cx="4" cy="20" r="2"/><circle cx="20" cy="20" r="2"/><path d="M9.5 9.5L5.5 5.5M14.5 9.5L18.5 5.5M9.5 14.5L5.5 18.5M14.5 14.5L18.5 18.5"/></svg>';

const LONG_PRESS_MS = 600;

// ─── Props ───────────────────────────────────────────────────
export interface NewsCardProps {
  news: NewsItem;
  onClick: () => void;
  variant?: 'default' | 'compact';
  isBookmarked?: boolean;
  onUpvote?: (id: string, current: 0 | 1 | -1) => void;
  onBookmark?: (id: string) => void;
  onShare?: (id: string) => void;
  onRepost?: (id: string) => void;
  onOpenSource?: (id: string) => void;
  onViewCluster?: (id: string) => void;
  /** Optional: when set, clicking the source avatar on the
   *  card navigates to that source's profile page. Cards
   *  without a known source id leave the avatar inert. */
  onSourceClick?: (sourceId: number) => void;
  /** Eager-load this card's thumbnail (skip lazy loading and
   *  signal fetchpriority=high). Use for the first card above
   *  the fold so LCP doesn't wait for the IntersectionObserver. */
  priority?: boolean;
}

export default function NewsCard(props: NewsCardProps) {
  const haptic = useHaptic();
  const compact = () => props.variant === 'compact';

  /**
   * Canonical article URL for the underlying `<a>`. Lets users:
   *  - middle-click / cmd-click to open in a new tab (native browser),
   *  - right-click → copy link,
   *  - tab to focus + Enter to activate (keyboard a11y),
   *  - screen-reader announces as a real link with a meaningful name.
   * The plain click handler still calls props.onClick() (the parent's
   * `nav.handleNewsClick`) which does the SPA navigation; we
   * `preventDefault()` only for plain left-clicks so the SPA path stays
   * intact while native semantic behaviors still work.
   */
  const articleHref = () => articleCanonicalPath(props.news.slug, props.news.slugDate, props.news.id);

  const [vote, setVote] = createSignal<0|1|-1>(props.news.myVote ?? 0);
  const [voteN, setVoteN] = createSignal(props.news.upvotes ?? 0);
  const [cmtN] = createSignal(0);
  const [rpstN, setRpstN] = createSignal(props.news.reposts ?? 0);
  const [reposted, setReposted] = createSignal(false);
  const [actionSheetOpen, setActionSheetOpen] = createSignal(false);

  // ─── Long-press detection ─────────────────────────────────
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressActive = false;
  let pressStartCoords: { x: number; y: number } | null = null;

  const cancelPress = () => {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    pressStartCoords = null;
  };

  const onPressStart = (clientX: number, clientY: number) => {
    pressActive = false;
    pressStartCoords = { x: clientX, y: clientY };
    cancelPress();
    pressTimer = setTimeout(() => {
      if (!pressStartCoords) return;
      pressActive = true;
      haptic.vibrate('long');
      setActionSheetOpen(true);
    }, LONG_PRESS_MS);
  };

  const onPressMove = (clientX: number, clientY: number) => {
    if (!pressStartCoords) return;
    const dx = Math.abs(clientX - pressStartCoords.x);
    const dy = Math.abs(clientY - pressStartCoords.y);
    if (dx > 10 || dy > 10) cancelPress();
  };

  const onPressEnd = () => {
    cancelPress();
  };

  const onCardClick = (e: MouseEvent) => {
    if (pressActive) { pressActive = false; e.preventDefault(); e.stopPropagation(); return; }
    haptic.vibrate('selection');
    props.onClick();
  };

  // ─── Action sheet handlers ────────────────────────────────
  const closeSheet = () => setActionSheetOpen(false);

  const handleShare = () => {
    haptic.vibrate('tap');
    closeSheet();
    props.onShare?.(props.news.id);
  };

  const handleShareWhatsApp = (e: MouseEvent) => {
    e.stopPropagation();
    haptic.vibrate('success');
    trackEvent({ type: 'share', newsId: props.news.id, source: 'whatsapp' });
    const url = buildWhatsAppUrl(props.news);
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener');
    }
  };
  const handleBookmark = () => {
    haptic.vibrate('success');
    closeSheet();
    trackBookmark(props.news.id);
    props.onBookmark?.(props.news.id);
  };
  const handleOpenSource = () => {
    haptic.vibrate('tap');
    closeSheet();
    props.onOpenSource?.(props.news.id);
  };
  const handleViewCluster = () => {
    haptic.vibrate('tap');
    closeSheet();
    props.onViewCluster?.(props.news.id);
  };

  const handleVote = (d: 1|-1, e: Event) => {
    e.stopPropagation();
    haptic.vibrate('tap');
    const cur = vote();
    const ns: 0|1|-1 = cur === d ? 0 : d;
    setVote(ns);
    // Optimistic count update. If the API call later fails or
    // returns a different total, the local signal is reconciled
    // in a future Sprint (S5: feedback sync).
    let diff = 0;
    if (cur === d) diff = -d;
    else if (cur === 0) diff = d;
    else diff = d * 2;
    setVoteN((c) => Math.max(0, c + diff));
    props.onUpvote?.(props.news.id, ns);
  };

  const handleRepost = (e: Event) => {
    e.stopPropagation();
    if (reposted()) {
      haptic.vibrate('tap');
      return;
    }
    haptic.vibrate('success');
    setReposted(true);
    setRpstN((c) => c + 1);
    props.onRepost?.(props.news.id);
  };

  const read = createMemo(() => isRead(props.news.id));
  const cc = createMemo(() => catColor(props.news.category));
  const ac = createMemo(() => avatarColor(props.news.source));
  const ini = createMemo(() => initials(props.news.source));

  const ago = createMemo(() => {
    const d = Math.floor((Date.now() - new Date(props.news.publishedAt||props.news.time||Date.now()).getTime())/60000);
    return d < 60 ? `${d}m` : d < 1440 ? `${Math.floor(d/60)}h` : `${Math.floor(d/1440)}d`;
  });

  const up = createMemo(() => vote()===1 ? 'var(--accent)' : 'var(--text-tertiary)');
  const dn = createMemo(() => vote()===-1 ? '#75AADB' : 'var(--text-tertiary)');

  // ─── Compact ──────────────────────────────────────────────
  if (compact()) {
    return (
      <article
        class="border-b border-border-base hover:bg-bg-hover transition-all"
        classList={{'opacity-50': read()}}
      >
        <a
          href={articleHref()}
          onClick={(e) => {
            // Let the browser handle modified clicks (cmd/ctrl/middle)
            // so users can open in a new tab. Plain left-clicks go
            // through the SPA handler.
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            props.onClick();
          }}
          aria-label={props.news.title}
          class="flex items-center gap-3 px-5 py-3 cursor-pointer active:scale-[0.99] no-underline text-inherit"
        >
          <div class="flex-1 min-w-0">
            <Show when={props.news.category}>
              <span class="text-[12px] xl:text-[13px] font-bold uppercase tracking-wider" style={{color:cc()}}>{props.news.category}</span>
            </Show>
            <h3 class="text-[16px] xl:text-[17px] font-semibold leading-snug truncate mt-0.5 text-text-primary">{props.news.title}</h3>
            <div class="flex items-center gap-1.5 mt-1 text-[13px] xl:text-[14px] text-text-tertiary">
              <span class="font-medium text-text-secondary">{props.news.source}</span>
              <span>·</span><span>{ago()}</span>
              <Show when={props.news.sourcesCount > 1}>
                <span>·</span><span class="text-accent font-semibold">{props.news.sourcesCount} fuentes</span>
              </Show>
            </div>
          </div>
        </a>
      </article>
    );
  }

  // ─── Default ──────────────────────────────────────────────
  const showThumb = () => !!props.news.imageUrl;
  const trending = () => props.news.sourcesCount >= 5;

  let cardRef: HTMLElement | undefined;
  let hasFiredCardView = false;
  onMount(() => {
    if (!cardRef || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !hasFiredCardView) {
            hasFiredCardView = true;
            trackCardView(props.news.id, props.news.category);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(cardRef);
    onCleanup(() => observer.disconnect());
  });

  return (
    <article
      ref={cardRef}
      onTouchStart={(e) => onPressStart(e.touches[0].clientX, e.touches[0].clientY)}
      onTouchMove={(e) => onPressMove(e.touches[0].clientX, e.touches[0].clientY)}
      onTouchEnd={onPressEnd}
      onTouchCancel={onPressEnd}
      onMouseDown={(e) => onPressStart(e.clientX, e.clientY)}
      onMouseMove={(e) => onPressMove(e.clientX, e.clientY)}
      onMouseUp={onPressEnd}
      onMouseLeave={onPressEnd}
      class="group border-b border-border-base hover:bg-bg-hover active:scale-[0.98] active:bg-bg-hover transition-all duration-100 mb-3"
      classList={{'opacity-50': read()}}
    >
      <div class="px-5 py-4">
        {/*
          ── Primary clickable region (a11y C9) ──
          The headline / image / meta row is wrapped in a single <a> so
          the card is reachable by keyboard, announces as a link to
          screen-readers, and supports cmd/middle-click for native new-
          tab behavior. The action row below sits OUTSIDE the anchor
          so each button's stopPropagation keeps it from triggering
          navigation. Long-press still works because the touch handlers
          live on the surrounding <article>.
        */}
        <a
          href={articleHref()}
          onClick={(e) => {
            // Hand off to native browser for modified clicks so the
            // user can open in a new tab / window.
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            // Skip the SPA nav when a long-press just released — the
            // pressActive flag is flipped in `onPressEnd`/the click
            // guard.
            if (pressActive) { pressActive = false; return; }
            haptic.vibrate('selection');
            props.onClick();
          }}
          aria-label={props.news.title}
          class="block no-underline text-inherit cursor-pointer active:scale-[0.98]"
        >
          {/* ── Meta row ── */}
          <div class="flex items-center gap-2 mb-2.5 flex-wrap">
            <Show when={props.news.category}>
              <span class="inline-flex items-center gap-1.5 text-[15px] xl:text-[16px] font-semibold" style={{color:cc()}}>
                <span class="w-2 h-2 rounded-full shrink-0" style={{'background-color':cc()}} />
                {props.news.category}
              </span>
              <span class="text-text-tertiary">·</span>
            </Show>
            <SourceLogo
              source={props.news.source}
              size={24}
              biasScore={props.news.biasScore}
              showBiasDot={true}
              sourceId={props.news.sourceId ?? null}
              onClick={props.onSourceClick}
            />
            <span class="text-[16px] xl:text-[17px] text-text-secondary font-semibold">{props.news.source}</span>
            <span class="text-[16px] xl:text-[17px] text-text-tertiary">{ago()}</span>
            <Show when={trending()}>
              <span class="text-[12px] xl:text-[13px] font-extrabold text-accent uppercase tracking-wider ml-auto inline-flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full bg-accent" />
                Trending
              </span>
            </Show>
          </div>

          {/* ── Content area (flex row if image) ── */}
          <div class="flex gap-4" classList={{'flex-row-reverse': showThumb()}}>
            <Show when={showThumb()}>
              <div
                class="shrink-0 w-[130px] h-[85px] rounded-xl overflow-hidden bg-bg-hover"
                data-hide-on-data-saver="true"
              >
                {(() => {
                  const u = props.news.imageUrl;
                  if (!u) return null;
                  const base = `https://akira-api.miclusty.workers.dev/api/img?url=${encodeURIComponent(u)}&q=72&fmt=webp&fit=cover`;
                  return (
                    <img
                      src={`${base}&w=260`}
                      srcset={`${base}&w=260 260w, ${base}&w=390 390w, ${base}&w=520 520w`}
                      sizes="(max-width: 768px) 130px, 260px"
                      alt=""
                      class="w-full h-full object-cover"
                      loading={props.priority ? "eager" : "lazy"}
                      fetchpriority={props.priority ? "high" : "auto"}
                      decoding="async"
                      width="130"
                      height="85"
                    />
                  );
                })()}
              </div>
            </Show>

            <div class="flex-1 min-w-0">
              <h2 class="text-[22px] xl:text-[24px] font-bold leading-snug text-text-primary group-hover:underline group-hover:decoration-text-tertiary/30">
                {props.news.title}
              </h2>
              <p class="text-[16px] xl:text-[17px] text-text-secondary mt-1.5 leading-relaxed line-clamp-2">
                {props.news.summary}
              </p>
            </div>
          </div>
        </a>

        {/* ── Footer: sources pill + actions (outside the <a> so each
                button keeps its own click semantics) ── */}
        <div class="mt-3 space-y-2">
          <Show when={props.news.sourcesCount > 1}>
            <span class="inline-flex items-center gap-1.5 text-[13px] xl:text-[14px] font-semibold text-accent bg-accent/5 px-2.5 min-h-[28px] rounded-md">
              <span class="w-1.5 h-1.5 rounded-full bg-accent" />
              {props.news.sourcesCount} fuentes
            </span>
          </Show>

          <div class="flex items-center justify-between gap-1 -mx-1.5 flex-wrap">
            <button
              onClick={(e)=>{e.stopPropagation();haptic.vibrate('tap');}}
              aria-label="Comentarios"
              class="flex items-center justify-center gap-1 min-h-[44px] min-w-[44px] px-2.5 py-2 rounded-full hover:bg-sky-500/10 active:scale-90 transition-all text-text-tertiary hover:text-sky-500"
            >
              <span class="w-[20px] h-[20px] flex items-center justify-center" innerHTML={SVG_CMMT_20} />
              <span class="text-[15px] xl:text-[16px] font-medium tabular-nums">{cmtN()}</span>
            </button>
            <button
              onClick={handleRepost}
              aria-label="Repost"
              class="flex items-center justify-center gap-1 min-h-[44px] min-w-[44px] px-2.5 py-2 rounded-full hover:bg-green-500/10 active:scale-90 transition-all"
              style={{ color: reposted() ? 'var(--green-500, #10B981)' : 'var(--text-tertiary)' }}
            >
              <span class="w-[20px] h-[20px] flex items-center justify-center" innerHTML={SVG_RPST_20} />
              <span class="text-[15px] xl:text-[16px] font-medium tabular-nums">{rpstN()}</span>
            </button>
            <button
              onClick={(e)=>handleVote(1,e)}
              aria-label="Voto positivo"
              class="flex items-center justify-center gap-1 min-h-[44px] min-w-[44px] px-2.5 py-2 rounded-full hover:bg-accent/10 active:scale-90 transition-all"
              style={{color:up()}}
            >
              <span class="w-[20px] h-[20px] flex items-center justify-center" innerHTML={SVG_UP_20} style={vote()===1 ? 'fill:var(--accent)' : ''} />
              <span class="text-[15px] xl:text-[16px] font-semibold tabular-nums">{voteN()>999?`${(voteN()/1000).toFixed(1)}k`:voteN()}</span>
            </button>
            <button
              onClick={(e)=>handleVote(-1,e)}
              aria-label="Voto negativo"
              class="flex items-center justify-center min-h-[44px] min-w-[44px] px-2 py-2 rounded-full hover:bg-blue-500/10 active:scale-90 transition-all"
              style={{color:dn()}}
            >
              <span class="w-[20px] h-[20px] flex items-center justify-center" innerHTML={SVG_DOWN_20} />
            </button>
            <button
              onClick={(e)=>{e.stopPropagation();haptic.vibrate('tap');trackBookmark(props.news.id);props.onBookmark?.(props.news.id);}}
              aria-label="Guardar"
              class="flex items-center justify-center min-h-[44px] min-w-[44px] px-2 py-2 rounded-full hover:bg-bg-hover active:scale-90 transition-all text-text-tertiary hover:text-accent"
            >
              <span class="w-[20px] h-[20px] flex items-center justify-center" innerHTML={SVG_BKMK_20} />
            </button>
            <Show when={props.news.sourceId != null && props.news.sourceId > 0}>
              <FollowButton sourceId={props.news.sourceId!} size="sm" />
            </Show>
            <button
              onClick={handleShareWhatsApp}
              aria-label="Compartir por WhatsApp"
              class="flex items-center justify-center gap-1.5 min-h-[44px] px-2.5 py-2 rounded-full hover:bg-accent/10 active:scale-90 transition-all text-text-tertiary hover:text-accent"
            >
              <span
                class="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ 'background-color': '#25D366' }}
                aria-hidden="true"
              />
              {/* Hide the text label on small screens — the green dot
                  is enough signal for "WhatsApp" and the full label
                  was pushing the row past the card edge. Show it
                  again on xl+ (≥1280px) where there's room. */}
              <span class="hidden xl:inline text-[15px] xl:text-[16px] font-medium">Compartir</span>
            </button>
            <button
              type="button"
              onClick={() => { setActionSheetOpen(true); haptic.vibrate('tap'); }}
              aria-label="Más acciones"
              class="flex items-center justify-center min-h-[44px] min-w-[44px] px-2 py-2 rounded-full hover:bg-bg-hover active:scale-90 transition-all text-text-tertiary"
            >
              <MaterialIcon name="more_horiz" size="base" class="text-[20px]" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Long-press action sheet ── */}
      <Show when={actionSheetOpen()}>
        <div
          class="fixed inset-0 flex items-end justify-center"
          style={{ background: 'rgba(0,0,0,0.45)', 'backdrop-filter': 'blur(2px)', 'z-index': 'var(--z-modal-back)' }}
          onClick={closeSheet}
        >
          <div
            class="w-full max-w-md rounded-t-2xl border border-border-base overflow-hidden"
            style={{ background: 'var(--bg-elevated)', 'padding-bottom': 'env(safe-area-inset-bottom, 0px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="flex flex-col">
              <div class="px-5 pt-3 pb-2 flex items-center justify-center">
                <div class="w-10 h-1 rounded-full" style={{ background: 'var(--border-base)' }} />
              </div>
              <button
                onClick={handleShare}
                class="flex items-center gap-4 px-5 min-h-[56px] hover:bg-bg-hover active:bg-bg-hover transition-colors text-left"
              >
                <MaterialIcon name="share" size="2xl" class="text-2xl text-accent" style={{ }} />
                <span class="text-base font-medium text-text-primary">Compartir</span>
              </button>
              <button
                onClick={handleBookmark}
                class="flex items-center gap-4 px-5 min-h-[56px] hover:bg-bg-hover active:bg-bg-hover transition-colors text-left"
              >
                <MaterialIcon name="bookmark" size="2xl" class="text-2xl text-accent" style={{ }} />
                <span class="text-base font-medium text-text-primary">Guardar</span>
              </button>
              <button
                onClick={handleOpenSource}
                class="flex items-center gap-4 px-5 min-h-[56px] hover:bg-bg-hover active:bg-bg-hover transition-colors text-left"
              >
                <span innerHTML={SVG_OPEN} class="text-accent" />
                <span class="text-base font-medium text-text-primary">Abrir en fuente original</span>
              </button>
              <button
                onClick={handleViewCluster}
                class="flex items-center gap-4 px-5 min-h-[56px] hover:bg-bg-hover active:bg-bg-hover transition-colors text-left"
              >
                <span innerHTML={SVG_HUB} class="text-accent" />
                <span class="text-base font-medium text-text-primary">Ver cluster ({props.news.sourcesCount} fuentes)</span>
              </button>
              <div class="border-t border-border-base mx-3" />
              <button
                onClick={closeSheet}
                class="flex items-center justify-center px-5 min-h-[56px] text-base font-semibold text-accent active:bg-bg-hover transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      </Show>
    </article>
  );
}
