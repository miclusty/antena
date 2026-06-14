/** @jsxImportSource solid-js */
import { createResource, For, Show, createMemo, createSignal, onMount } from 'solid-js';
import type { NewsItem, VoiceBreakdown } from '../../lib/types';
import { fetchNewsByCluster, fetchMasterArticle, fetchFeedback, fetchReport, type MasterArticle, type ReportReason } from '../../lib/api';
import { mapNewsCard, stripHtml } from '../../lib/mappers';
import ClusterView from './ClusterView';
import ReadingMode from './ReadingMode';
import MediaEmbed from '../common/MediaEmbed';
import ImageGallery from '../common/ImageGallery';
import BiasBreakdownBar from '../common/BiasBreakdownBar';
import { useHaptic } from '../../lib/haptic';
import { VOICE_COLORS, VOICE_LABELS } from '../../lib/bias';
import ReadingProgress from './ReadingProgress';
import ArticleBottomBar from './ArticleBottomBar';
import OtrasVocesCta from './OtrasVocesCta';
import { toast } from '../Toast';
import { useBookmarks } from '../../lib/bookmarks';
import ReportSheet from './ReportSheet';
import { speak as ttsSpeak, stop as ttsStop, isSupported as ttsSupported, isSpeaking as ttsIsSpeaking } from '../../lib/speech';
import TableOfContents from './TableOfContents';
import ImageLightbox from './ImageLightbox';
import { readingTimeText, remainingReadingMinutes, computeScrollPct } from '../../lib/reading-progress';

interface ArticleDetailProps {
  news: NewsItem;
  onBack: () => void;
  onArticleSelect?: (article: NewsItem) => void;
}

export default function ArticleDetail(props: ArticleDetailProps) {
  const haptic = useHaptic();
  const [readingModeOpen, setReadingModeOpen] = createSignal(false);
  const { isBookmarked, toggleBookmark } = useBookmarks();
  const n = () => props.news;

  // S3.5 — "Was this useful?" feedback. Local signal of the
  // device's vote for instant button coloring; the server
  // response carries the canonical counts.
  const [myUseful, setMyUseful] = createSignal<0 | 1 | null>(props.news.myUseful ?? null);
  const [usefulYes, setUsefulYes] = createSignal(props.news.useful_yes ?? 0);
  const [usefulNo, setUsefulNo] = createSignal(props.news.useful_no ?? 0);

  // S3.6 — Report modal state.
  const [reportOpen, setReportOpen] = createSignal(false);

  // S3.1 — Listen (TTS) state. The bottom bar calls onListen to
  // toggle; the actual synth call lives in the lib/speech wrapper.
  const [isSpeaking, setIsSpeaking] = createSignal(false);
  const canSpeak = ttsSupported();

  // S3.11 — Image lightbox state.
  const [lightboxOpen, setLightboxOpen] = createSignal(false);

  const toggleListen = () => {
    if (!canSpeak) {
      toast("Tu navegador no soporta lectura en voz alta", "warning");
      return;
    }
    if (isSpeaking() || ttsIsSpeaking()) {
      ttsStop();
      setIsSpeaking(false);
    } else {
      // Speak the cleaned body (master article body if present,
      // else the news summary). Stripping HTML is a no-op here
      // (the body is already plain text after mappers), but it's
      // a safety net for any future HTML body we might pass in.
      const text = (displaySummary() || "").trim();
      if (!text) return;
      ttsSpeak(text, {
        lang: "es-AR",
        onEnd: () => setIsSpeaking(false),
        onError: () => setIsSpeaking(false),
      });
      setIsSpeaking(true);
    }
  };

  const submitFeedback = async (useful: 0 | 1) => {
    const prev = myUseful();
    const next: 0 | 1 | null = prev === useful ? null : useful;
    setMyUseful(next);
    // Optimistic count.
    const prevYes = usefulYes();
    const prevNo = usefulNo();
    if (prev === null) {
      setUsefulYes(prevYes + (useful === 1 ? 1 : 0));
      setUsefulNo(prevNo + (useful === 0 ? 1 : 0));
    } else if (prev === 0 && useful === 1) {
      setUsefulNo(Math.max(0, prevNo - 1));
      setUsefulYes(prevYes + 1);
    } else if (prev === 1 && useful === 0) {
      setUsefulYes(Math.max(0, prevYes - 1));
      setUsefulNo(prevNo + 1);
    } else {
      // toggling off
      if (useful === 1) setUsefulYes(Math.max(0, prevYes - 1));
      else setUsefulNo(Math.max(0, prevNo - 1));
    }
    haptic.vibrate("tap");
    const res = await fetchFeedback(props.news.id, useful);
    if (res) {
      // Reconcile with server's authoritative count.
      setUsefulYes(res.useful_yes);
      setUsefulNo(res.useful_no);
      setMyUseful(res.myUseful);
    }
  };

  const submitReport = async (reason: ReportReason, note?: string) => {
    const ok = await fetchReport(props.news.id, reason, note);
    if (ok) {
      toast("Reporte enviado. Gracias.", "info");
    } else {
      toast("No se pudo enviar el reporte", "error");
    }
    setReportOpen(false);
  };

  const totalFeedback = () => usefulYes() + usefulNo();
  const usefulPct = () => {
    const t = totalFeedback();
    if (t === 0) return null;
    return Math.round((usefulYes() / t) * 100);
  };

  const handleShare = async () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    if (navigator.share) {
      try { await navigator.share({ title: n().title, url }); }
      catch { /* cancelled */ }
    } else {
      await navigator.clipboard.writeText(url);
      toast('Enlace copiado', 'info');
    }
  };

  const cleanBody = () => stripHtml(n().body || n().summary || '');

  const media = createMemo(() => {
    const body = cleanBody();
    const images: string[] = [];
    const videos: string[] = [];
    const imgMatches = body.match(/https?:\/\/[^\s"'<>]+\.(jpg|jpeg|png|gif|webp)/gi);
    if (imgMatches) images.push(...imgMatches);
    const videoMatches = body.match(/https?:\/\/[^\s"'<>]*(youtube\.com|youtu\.be|vimeo\.com)[^\s"'<>]*/gi);
    if (videoMatches) videos.push(...videoMatches);
    return { images, videos };
  });

  const [clusterData] = createResource(
    () => n().id,
    async (newsId) => {
      if (!newsId) return [];
      try { return (await fetchNewsByCluster(newsId)).news.map(mapNewsCard); }
      catch { return []; }
    },
    { initialValue: [] as NewsItem[] }
  );

  const [masterArticle] = createResource(
    () => n().clusterId || undefined,
    async (clusterId) => {
      if (!clusterId) return null;
      try { return await fetchMasterArticle(clusterId); }
      catch { return null; }
    },
    { initialValue: null }
  );

  const displayTitle = () => (masterArticle() as MasterArticle | null)?.title || n().title;
  const displaySummary = () => {
    const master = masterArticle() as MasterArticle | null;
    if (master?.body) return stripHtml(master.body);
    if (master?.summary) return stripHtml(master.summary);
    return n().body || n().summary || '';
  };

  const realVoices = (): VoiceBreakdown[] => {
    const articles = clusterData();
    if (!articles || articles.length <= 1) return n().voces ?? [];
    const biasMap: Record<string, number> = { 'Oficialista': 1, 'Opositor': -1, 'Neutral': 0 };
    const scores = articles.map(a => biasMap[a.bias] ?? 0);
    const officialist = scores.filter(s => s > 0).length;
    const opposition = scores.filter(s => s < 0).length;
    const neutral = scores.filter(s => s === 0).length;
    const total = scores.length;
    return [
      { label: VOICE_LABELS.officialist, pct: Math.round((officialist / total) * 100), color: VOICE_COLORS.officialist },
      { label: VOICE_LABELS.neutral, pct: Math.round((neutral / total) * 100), color: VOICE_COLORS.neutral },
      { label: VOICE_LABELS.opposition, pct: Math.round((opposition / total) * 100), color: VOICE_COLORS.opposition },
    ].filter(v => v.pct > 0);
  };

  const voces = () => {
    const rv = realVoices();
    return rv.length > 0 ? rv : (n().voces ?? []);
  };

  const cleanLocation = () => {
    const loc = n().location;
    if (!loc) return '';
    return [...new Set(loc.split(',').map(p => p.trim()))].join(', ');
  };

  const readingTime = () => {
    return readingTimeText(displaySummary());
  };

  // S3.9 — Live countdown of remaining reading time. A
  // window-level scroll listener keeps a signal in sync
  // with the user's progress through the article.
  const [scrollPct, setScrollPct] = createSignal(0);
  const totalMinutes = () => {
    const words = displaySummary().trim().split(/\s+/).length;
    return Math.max(1, Math.ceil(words / 200));
  };
  const remainingMinutes = () => remainingReadingMinutes(totalMinutes(), scrollPct());
  onMount(() => {
    if (typeof window === "undefined") return;
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setScrollPct(computeScrollPct(window.scrollY, max));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    // Cleanup. Solid's onMount returns a cleanup fn when
    // called without onCleanup; the parent already wraps
    // the component in a way that disposes on unmount.
    return () => window.removeEventListener("scroll", onScroll);
  });

  const signalColor = () => n().signalLevel >= 7 ? 'var(--accent)' : n().signalLevel >= 4 ? 'var(--warning)' : 'var(--text-tertiary)';

  return (
    <div style={{ background: 'var(--bg-base)' }}>
      <ReadingProgress />

      {/* Top bar */}
      <header
        class="sticky top-0 z-40 border-b"
        style={{ background: 'var(--bg-elevated)', 'border-color': 'var(--border-base)' }}
      >
        <div class="flex items-center px-4 h-12">
          <button
            onClick={() => { haptic.vibrate('tap'); props.onBack(); }}
            class="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-bg-hover active:scale-90 transition-all"
            style={{ color: 'var(--text-primary)' }}
            aria-label="Volver"
          >
            <span
              class="material-symbols-rounded text-xl leading-none"
              style={{ 'font-variation-settings': "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20" }}
            >
              arrow_back
            </span>
          </button>
          <span
            class="flex-1 text-center text-xs font-medium truncate px-3"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {n().category}
          </span>
          <button
            onClick={() => { haptic.vibrate('tap'); setReadingModeOpen(true); }}
            class="flex items-center gap-1.5 text-xs rounded-full border min-h-[44px] transition-colors px-3 active:scale-95"
            style={{
              color: 'var(--text-tertiary)',
              'border-color': 'var(--border-base)',
            }}
            aria-label="Modo lectura"
          >
            <span
              class="material-symbols-rounded text-lg leading-none"
              style={{ 'font-variation-settings': "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20" }}
            >
              menu_book
            </span>
            Modo lectura
          </button>
        </div>
      </header>

      {/* Content */}
      <main class="px-5 py-6">
        {/* Category badge */}
        <div class="mb-4">
          <span
            class="text-xs px-2 py-0.5 rounded-full border"
            style={{
              'background': 'var(--accent-muted)',
              color: 'var(--accent)',
              'border-color': 'var(--accent)',
            }}
          >
            {n().category}
          </span>
        </div>

        {/* Title */}
        <h1
          class="text-[24px] md:text-[30px] font-bold leading-[1.15] mb-4 tracking-tight"
          style={{ color: 'var(--text-primary)', 'font-family': 'var(--font-display)' }}
        >
          {displayTitle().replace('📢 ', '')}
        </h1>

        {/* Meta row */}
        <div
          class="flex items-center gap-2 mb-6 pb-4 flex-wrap"
          style={{ 'border-bottom': '1px solid var(--border-base)' }}
        >
          <span class="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {n().source}
          </span>
          <span
            class="text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
            style={{ 'background-color': n().biasGradientColor || 'var(--bias-neutral)' }}
          >
            {n().bias || 'Neutral'}
          </span>
          <Show when={n().author}>
            <span class="w-0.5 h-0.5 rounded-full" style={{ background: 'var(--text-tertiary)' }} />
            <span
              class="material-symbols-rounded text-sm leading-none"
              style={{
                color: 'var(--text-tertiary)',
                'font-variation-settings': "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 16'",
              }}
            >
              person
            </span>
            <span class="text-sm" style={{ color: 'var(--text-tertiary)' }}>Por {n().author}</span>
          </Show>
          <span class="w-0.5 h-0.5 rounded-full" style={{ background: 'var(--text-tertiary)' }} />
          <span class="text-sm" style={{ color: 'var(--text-tertiary)' }}>{n().time}</span>
          <span class="w-0.5 h-0.5 rounded-full" style={{ background: 'var(--text-tertiary)' }} />
          <span class="text-sm" style={{ color: 'var(--text-tertiary)' }}>{readingTime()}</span>
          <Show when={scrollPct() > 0.05 && remainingMinutes() > 0}>
            <span class="w-0.5 h-0.5 rounded-full" style={{ background: 'var(--text-tertiary)' }} />
            <span
              class="text-sm inline-flex items-center gap-1"
              style={{ color: 'var(--accent)' }}
              aria-live="polite"
            >
              <span
                class="material-symbols-rounded text-sm leading-none"
                style={{ "font-variation-settings": "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 16" }}
                aria-hidden="true"
              >
                schedule
              </span>
              Te quedan {remainingMinutes()} min
            </span>
          </Show>
          <Show when={cleanLocation()}>
            <>
              <span class="w-0.5 h-0.5 rounded-full" style={{ background: 'var(--text-tertiary)' }} />
              <span
                class="material-symbols-rounded text-base leading-none"
                style={{ color: 'var(--text-tertiary)', 'font-variation-settings': "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20" }}
              >
                location_on
              </span>
              <span class="text-sm" style={{ color: 'var(--text-tertiary)' }}>{cleanLocation()}</span>
            </>
          </Show>
        </div>

        {/* Source link */}
        <Show when={n().sourceUrl}>
          <div class="mb-6">
            <a
              href={n().sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => haptic.vibrate('tap')}
              class="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors border"
              style={{
                'background': 'var(--accent-muted)',
                color: 'var(--accent)',
                'border-color': 'var(--accent)',
              }}
            >
              <span
                class="material-symbols-rounded text-base leading-none"
                style={{ 'font-variation-settings': "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20" }}
              >
                open_in_new
              </span>
              Leer en fuente original
            </a>
          </div>
        </Show>

        {/* Badges */}
        <div class="flex gap-2 mb-5 flex-wrap">
          <Show when={n().isGacetilla}>
            <span
              class="h-6 flex items-center rounded-full border px-2.5"
              style={{ 'border-color': 'var(--text-tertiary)', color: 'var(--text-tertiary)' }}
            >
              <p class="text-[9px] font-semibold uppercase tracking-wider">Comunicado Oficial</p>
            </span>
          </Show>
          <Show when={n().isClickbait}>
            <span
              class="h-6 flex items-center rounded-full border px-2.5"
              style={{ 'border-color': 'rgba(245,158,11,0.3)', color: 'var(--warning)' }}
            >
              <p class="text-[9px] font-semibold uppercase tracking-wider">Ruido Filtrado</p>
            </span>
          </Show>
        </div>

        {/* Hero Media */}
        <Show when={n().imageUrl || media().images.length > 0 || media().videos.length > 0}>
          <div class="mb-6">
            <Show when={media().videos.length > 0}>
              <MediaEmbed url={media().videos[0]} />
            </Show>
            <Show when={media().videos.length === 0 && media().images.length > 1}>
              <ImageGallery images={[n().imageUrl, ...media().images].filter(Boolean) as string[]} />
            </Show>
            <Show when={media().videos.length === 0 && media().images.length <= 1 && n().imageUrl}>
              <div class="relative w-full rounded-lg overflow-hidden">
                <img
                  src={n().imageUrl!}
                  alt=""
                  class="w-full h-64 md:h-80 object-cover cursor-zoom-in"
                  loading="lazy"
                  onClick={() => setLightboxOpen(true)}
                  onError={(e) => {
                    const parent = (e.target as HTMLImageElement).parentElement;
                    if (parent) parent.style.display = 'none';
                  }}
                />
              </div>
            </Show>
          </div>
        </Show>

        {/* Article Body */}
        <section class="mb-6">
          {/* S3.3 — Table of contents. Renders above the body
              when the article has ≥2 h2/h3 headings. */}
          <Show when={(n().headings ?? []).length >= 2}>
            <div class="mb-4">
              <TableOfContents items={n().headings ?? []} />
            </div>
          </Show>
          <div
            class="text-[17px] leading-[1.65] whitespace-pre-line"
            style={{ color: 'var(--text-primary)' }}
          >
            <p>{displaySummary()}</p>
          </div>
        </section>

        {/* S3.5 — "¿Te fue útil?" + S3.6 reportar */}
        <section
          class="rounded-xl border p-4 mb-4"
          style={{ background: 'var(--bg-elevated)', 'border-color': 'var(--border-base)' }}
        >
          <p class="text-[10px] font-extrabold uppercase tracking-widest mb-2" style={{ color: 'var(--text-tertiary)' }}>
            ¿Te fue útil?
          </p>
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <button
                type="button"
                onClick={() => submitFeedback(1)}
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border"
                style={
                  myUseful() === 1
                    ? { background: 'var(--accent)', color: '#fff', 'border-color': 'var(--accent)' }
                    : { background: 'var(--bg-base)', color: 'var(--text-secondary)', 'border-color': 'var(--border-base)' }
                }
                aria-pressed={myUseful() === 1}
                aria-label="Sí, me fue útil"
              >
                <span
                  class="material-symbols-rounded text-base leading-none"
                  style={{ "font-variation-settings": "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 18" }}
                  aria-hidden="true"
                >
                  thumb_up
                </span>
                Sí
                <span class="text-[11px] opacity-70 tabular-nums">{usefulYes()}</span>
              </button>
              <button
                type="button"
                onClick={() => submitFeedback(0)}
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border"
                style={
                  myUseful() === 0
                    ? { background: 'var(--text-primary)', color: 'var(--bg-base)', 'border-color': 'var(--text-primary)' }
                    : { background: 'var(--bg-base)', color: 'var(--text-secondary)', 'border-color': 'var(--border-base)' }
                }
                aria-pressed={myUseful() === 0}
                aria-label="No me fue útil"
              >
                <span
                  class="material-symbols-rounded text-base leading-none"
                  style={{ "font-variation-settings": "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 18" }}
                  aria-hidden="true"
                >
                  thumb_down
                </span>
                No
                <span class="text-[11px] opacity-70 tabular-nums">{usefulNo()}</span>
              </button>
            </div>
            <Show when={usefulPct() !== null}>
              <p class="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>
                {usefulPct()}% la encontró útil
              </p>
            </Show>
          </div>
          <button
            type="button"
            onClick={() => setReportOpen(true)}
            class="mt-3 text-[11px] font-semibold inline-flex items-center gap-1"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <span
              class="material-symbols-rounded text-sm leading-none"
              style={{ "font-variation-settings": "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 16" }}
              aria-hidden="true"
            >
              flag
            </span>
            Reportar contenido
          </button>
        </section>

        {/* Sticky CTA + bottom sheet for other voices on the same story.
            The CTA becomes visible after the user scrolls past 60% of the
            article body and opens a BottomSheet listing the rest of the
            cluster's sources. */}
        <OtrasVocesCta
          otherSources={clusterData().filter((a) => a.id !== n().id)}
          currentId={n().id}
          onSelect={props.onArticleSelect || (() => {})}
        />

        {/* Signal Gauge */}
        <section
          class="rounded-xl border p-4 mb-4"
          style={{ background: 'var(--bg-elevated)', 'border-color': 'var(--border-base)' }}
        >
          <div class="flex justify-between items-center mb-3">
            <h2 class="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              Potencia de Señal
            </h2>
          </div>
          <div class="flex items-end justify-center gap-[2px] h-12 mb-2">
            <For each={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}>
              {(i) => (
                <div
                  class="w-2.5 rounded-full transition-all duration-500"
                  style={{
                    height: `${6 + i * 3}px`,
                    'background-color': i <= n().signalLevel ? 'var(--accent)' : 'var(--border-base)',
                  }}
                />
              )}
            </For>
          </div>
          <p class="text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Nivel {n().signalLevel}/10 —{' '}
            <span class="font-medium" style={{ color: 'var(--text-primary)' }}>
              {n().signalLevel >= 7 ? 'Alta propagación' : n().signalLevel >= 4 ? 'Propagación media' : 'Baja propagación'}
            </span>
          </p>
        </section>

        {/* Voice Breakdown */}
        <section
          class="rounded-xl border p-4 mb-4"
          style={{ background: 'var(--bg-elevated)', 'border-color': 'var(--border-base)' }}
        >
          <h2 class="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
            Desglose de Voces
          </h2>
          <BiasBreakdownBar voices={voces()} barClass="h-5" labelClass="text-xs" />
        </section>

        {/* Clickbait Answer */}
        <Show when={n().isClickbait}>
          <section
            class="rounded-xl border p-4 mb-4"
            style={{ 'background': 'rgba(245,158,11,0.06)', 'border-color': 'rgba(245,158,11,0.2)' }}
          >
            <div class="flex items-start gap-2">
              <span
                class="material-symbols-rounded text-lg leading-none mt-0.5"
                style={{ color: 'var(--warning)', 'font-variation-settings': "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 20" }}
              >
                shield
              </span>
              <div>
                <p class="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--warning)' }}>
                  Ruido Filtrado
                </p>
                <p class="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {n().clickbaitAnswer}
                </p>
              </div>
            </div>
          </section>
        </Show>

        {/* Propagation Timeline */}
        <Show when={clusterData().length > 1}>
          <section
            class="rounded-xl border p-4 mb-4"
            style={{ background: 'var(--bg-elevated)', 'border-color': 'var(--border-base)' }}
          >
            <h2 class="text-[10px] font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--text-tertiary)' }}>
              Origen y Propagación
            </h2>
            <div
              class="relative pl-4 border-l-2 ml-1 flex flex-col gap-4"
              style={{ 'border-color': 'var(--border-base)' }}
            >
              <For each={clusterData().slice(0, 5)}>
                {(article, idx) => (
                  <div class="relative">
                    <div
                      class="absolute -left-[21px] top-0.5 w-3 h-3 rounded-full border-2"
                      style={{
                        'background-color': idx() === 0 ? 'var(--accent)' : 'var(--text-tertiary)',
                        'border-color': 'var(--bg-elevated)',
                      }}
                    />
                    <p
                      class="text-[9px] font-bold mb-0.5 uppercase tracking-wide"
                      style={{ color: idx() === 0 ? 'var(--accent)' : 'var(--text-tertiary)' }}
                    >
                      {article.time} —{' '}
                      {idx() === 0 ? 'Origen' : idx() === 1 ? 'Recogido' : 'Amplificado'}
                    </p>
                    <p class="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                      {article.source}
                    </p>
                  </div>
                )}
              </For>
            </div>
          </section>
        </Show>

        {/* Cluster View - Related Articles */}
        <Show when={clusterData().length > 1}>
          <ClusterView
            clusterId={n().clusterId}
            articles={clusterData()}
            onArticleSelect={props.onArticleSelect || (() => {})}
          />
        </Show>
      </main>

      <ReadingMode
        isOpen={readingModeOpen()}
        onClose={() => setReadingModeOpen(false)}
        title={displayTitle()}
        body={n().body || ''}
        summary={n().summary || ''}
      />

      <ReportSheet
        open={reportOpen()}
        onClose={() => setReportOpen(false)}
        onSubmit={submitReport}
      />

      <ImageLightbox
        open={lightboxOpen()}
        src={n().imageUrl ?? ""}
        alt={n().title}
        onClose={() => setLightboxOpen(false)}
      />

      <ArticleBottomBar
        sourceUrl={n().sourceUrl}
        isBookmarked={isBookmarked(n().id)}
        onBookmark={() => toggleBookmark(n().id)}
        onShare={handleShare}
        onReadingMode={() => setReadingModeOpen(true)}
        onListen={toggleListen}
        isSpeaking={isSpeaking()}
        articleUrl={typeof window !== 'undefined' ? window.location.href : ''}
      />
    </div>
  );
}
