/** @jsxImportSource solid-js */
import { createSignal } from 'solid-js';
import MaterialIcon from '../common/MaterialIcon';

interface ModoMateProps {
  newsItems: { title: string; summary: string }[];
  currentIndex: number;
  visible?: boolean;
}

export default function ModoMate(props: ModoMateProps) {
  const [isSpeaking, setIsSpeaking] = createSignal(false);
  const [rate, setRate] = createSignal(1);

  const speak = () => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const items = props.newsItems;
    if (!items.length) return;
    let idx = props.currentIndex;
    const speakNext = () => {
      if (idx >= items.length) { setIsSpeaking(false); return; }
      const item = items[idx];
      try {
        const utterance = new SpeechSynthesisUtterance(`${item.title}. ${item.summary}`);
        utterance.lang = 'es-AR';
        utterance.rate = rate();
        utterance.onend = () => { idx++; speakNext(); };
        utterance.onerror = () => setIsSpeaking(false);
        window.speechSynthesis.speak(utterance);
      } catch (e) { console.debug('TTS failed:', e); }
    };
    setIsSpeaking(true);
    speakNext();
  };

  const stop = () => { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); setIsSpeaking(false); };
  if (!props.visible) return null;

  return (
    <div
      class="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 rounded-full px-4 py-2 flex items-center gap-3 border shadow-lg"
      style={{
        background: 'var(--bg-elevated)',
        'border-color': 'var(--border-base)',
        'box-shadow': '0 4px 24px rgba(0,0,0,0.3)',
      }}
    >
      <button
        onClick={isSpeaking() ? stop : speak}
        class="flex items-center gap-2 text-sm font-medium transition-colors"
        style={{ color: 'var(--accent)' }}
      >
        <MaterialIcon name={isSpeaking() ? 'stop' : 'record_voice_over'} size="lg" class="text-lg " style={{ 'font-variation-settings': "'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 20" }} />
        {isSpeaking() ? 'Detener' : 'Modo Mate'}
      </button>

      {isSpeaking() && (
        <>
          <span class="w-px h-4" style={{ background: 'var(--border-base)' }} />
          <div class="flex items-center gap-1">
            <button
              onClick={() => setRate(Math.max(0.5, rate() - 0.1))}
              class="w-6 h-6 flex items-center justify-center rounded-full text-xs transition-colors"
              style={{ color: 'var(--text-tertiary)', background: 'transparent' }}
            >
              −
            </button>
            <span
              class="text-[10px] font-mono w-8 text-center"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {rate().toFixed(1)}x
            </span>
            <button
              onClick={() => setRate(Math.min(2, rate() + 0.1))}
              class="w-6 h-6 flex items-center justify-center rounded-full text-xs transition-colors"
              style={{ color: 'var(--text-tertiary)', background: 'transparent' }}
            >
              +
            </button>
          </div>
        </>
      )}
    </div>
  );
}
