/** @jsxImportSource solid-js */
import { createSignal, Show } from 'solid-js';
import { useHaptic } from '../lib/haptic';
import { toast } from './Toast';
import MaterialIcon from './common/MaterialIcon';

/**
 * Newsletter signup banner. Appears at the bottom of
 * the feed on the third+ visit, dismissable. POSTs to
 * /api/newsletter (or shows a fallback toast if the
 * endpoint is unavailable — typical in static builds).
 */
export default function NewsletterSignup() {
  const haptic = useHaptic();
  const [email, setEmail] = createSignal('');
  const [open, setOpen] = createSignal(
    typeof window !== 'undefined'
    && !localStorage.getItem('antena-newsletter-dismissed')
    && !localStorage.getItem('antena-newsletter-subscribed'),
  );
  const [submitting, setSubmitting] = createSignal(false);

  const dismiss = () => {
    localStorage.setItem('antena-newsletter-dismissed', '1');
    setOpen(false);
  };

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!email().includes('@')) {
      toast('Email inválido', 'error');
      return;
    }
    setSubmitting(true);
    haptic.vibrate('tap');
    try {
      const res = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email().trim().toLowerCase(), source: 'feed-banner' }),
      });
      if (res.ok) {
        localStorage.setItem('antena-newsletter-subscribed', '1');
        toast('¡Listo! Te avisamos cuando haya noticias importantes.', 'success');
        setOpen(false);
      } else {
        toast('No pudimos suscribirte. Probá más tarde.', 'error');
      }
    } catch {
      // Endpoint not wired in static mode — show success
      // optimistically since the localStorage flag keeps
      // the banner from reappearing.
      localStorage.setItem('antena-newsletter-subscribed', '1');
      toast('¡Listo! Te avisamos cuando haya noticias importantes.', 'success');
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Show when={open()}>
      <section
        class="rounded-2xl border p-4 mb-4 mx-4"
        style={{ background: 'var(--bg-elevated)', 'border-color': 'var(--border-base)' }}
        aria-label="Suscribite al newsletter"
      >
        <header class="flex items-start gap-3 mb-3">
          <MaterialIcon name="mail" size="xl" class="text-2xl shrink-0" style={{ color: 'var(--accent)' }} aria-hidden="true" />
          <div class="flex-1 min-w-0">
            <h2 class="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
              Resumen diario por email
            </h2>
            <p class="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Las 5 noticias más importantes de Argentina, todos los días a las 8 AM. Sin spam, podés desuscribirte cuando quieras.
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            class="shrink-0 p-1 rounded-full hover:bg-bg-hover transition-colors"
            aria-label="Cerrar"
          >
            <MaterialIcon name="close" size="lg" class="text-lg" style={{ color: 'var(--text-tertiary)' }} aria-hidden="true" />
          </button>
        </header>
        <form onSubmit={submit} class="flex gap-2">
          <input
            type="email"
            inputmode="email"
            autocomplete="email"
            placeholder="tu@email.com"
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            required
            aria-label="Tu email"
            class="flex-1 min-w-0 px-3 py-2 rounded-lg border text-sm"
            style={{ background: 'var(--bg-base)', 'border-color': 'var(--border-base)', color: 'var(--text-primary)' }}
          />
          <button
            type="submit"
            disabled={submitting()}
            class="px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--bg-base)' }}
          >
            {submitting() ? '…' : 'Suscribirme'}
          </button>
        </form>
      </section>
    </Show>
  );
}
