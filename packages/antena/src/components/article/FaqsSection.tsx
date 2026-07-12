/** @jsxImportSource solid-js */
import { createResource, createSignal, Show, For } from 'solid-js';
import { fetchFaqs, type FAQ } from '../../lib/api';
import MaterialIcon from '../common/MaterialIcon';
import { useHaptic } from '../../lib/haptic';

interface FaqsSectionProps {
  clusterId: string | undefined;
}

export default function FaqsSection(props: FaqsSectionProps) {
  const haptic = useHaptic();
  const [open, setOpen] = createSignal(false);

  const [faqs] = createResource(
    () => props.clusterId,
    async (clusterId) => {
      if (!clusterId) return null;
      return await fetchFaqs(clusterId);
    },
    { initialValue: null }
  );

  // Don't render until loaded, and only if there are FAQs.
  const list = () => {
    const res = faqs();
    if (!res || !res.faqs || res.faqs.length === 0) return null;
    return res.faqs as FAQ[];
  };

  return (
    <Show when={list()}>
      <section
        class="rounded-xl border p-4 mb-4"
        style={{ background: 'var(--bg-elevated)', 'border-color': 'var(--border-base)' }}
      >
        <button
          type="button"
          onClick={() => {
            haptic.vibrate('tap');
            setOpen(!open());
          }}
          class="flex items-center justify-between w-full text-left gap-3"
          aria-expanded={open()}
          aria-label={open() ? 'Ocultar preguntas frecuentes' : 'Mostrar preguntas frecuentes'}
        >
          <div class="flex items-center gap-2">
            <MaterialIcon
              name="quiz"
              size="base"
              class="text-base"
              style={{ color: 'var(--accent)' }}
              aria-hidden="true"
            />
            <h2
              class="text-[10px] font-extrabold uppercase tracking-widest"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Preguntas Frecuentes
            </h2>
            <span
              class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}
            >
              {list()!.length}
            </span>
          </div>
          <MaterialIcon
            name={open() ? 'expand_less' : 'expand_more'}
            size="base"
            class="text-base"
            style={{ color: 'var(--text-tertiary)' }}
            aria-hidden="true"
          />
        </button>

        <Show when={open()}>
          <ul class="mt-3 flex flex-col gap-3">
            <For each={list()!}>
              {(faq, i) => (
                <li
                  class="rounded-lg p-3"
                  style={{ background: 'var(--bg-base)', border: '1px solid var(--border-base)' }}
                >
                  <div class="flex items-start gap-2 mb-1.5">
                    <span
                      class="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold"
                      style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                      aria-hidden="true"
                    >
                      {i() + 1}
                    </span>
                    <p
                      class="text-sm font-semibold leading-snug flex-1"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {faq.question}
                    </p>
                  </div>
                  <p
                    class="text-sm leading-relaxed ml-7 mb-2"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {faq.answer}
                  </p>
                  <div class="ml-7">
                    <span
                      class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border"
                      style={{
                        'border-color': 'var(--border-base)',
                        color: 'var(--text-tertiary)',
                        background: 'var(--bg-elevated)',
                      }}
                      title={`Respuesta respaldada por ${faq.source_count} fuente${faq.source_count === 1 ? '' : 's'} del cluster`}
                    >
                      <MaterialIcon
                        name="source"
                        size="sm"
                        class="text-[10px]"
                        style={{ "font-variation-settings": "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 12" }}
                        aria-hidden="true"
                      />
                      {faq.source_count} {faq.source_count === 1 ? 'fuente' : 'fuentes'}
                    </span>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </Show>
  );
}