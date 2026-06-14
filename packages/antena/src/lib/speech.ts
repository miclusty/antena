// Thin wrapper around the browser's SpeechSynthesis API. The
// goal is to (a) gracefully degrade when the API is unavailable
// (server-render, Firefox before 49, etc.) and (b) expose a
// pure-function-style API that the test suite can exercise
// without spinning up a real Web Speech backend.
//
// We deliberately do NOT import the type definitions for the
// Web Speech API — they're not part of the default tsconfig
// and we want this helper to work even when @types/dom-speech
// isn't installed. The structural shape we depend on is tiny.

export interface SpeakOptions {
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: unknown) => void;
}

interface SpeechSynthesisLike {
  speak(u: unknown): void;
  cancel(): void;
  pause(): void;
  resume(): void;
  speaking: boolean;
  paused: boolean;
  getVoices(): unknown[];
  addEventListener?: (t: string, fn: EventListener) => void;
  removeEventListener?: (t: string, fn: EventListener) => void;
}

interface SpeechSynthesisUtteranceLike {
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
  onstart: ((e: Event) => void) | null;
  onend: ((e: Event) => void) | null;
  onerror: ((e: Event) => void) | null;
  onpause: ((e: Event) => void) | null;
  onresume: ((e: Event) => void) | null;
}

function synth(): SpeechSynthesisLike | null {
  if (typeof window === "undefined") return null;
  const s = (window as unknown as { speechSynthesis?: SpeechSynthesisLike }).speechSynthesis;
  return s ?? null;
}

function Utterance(text: string): SpeechSynthesisUtteranceLike {
  // Use the browser's constructor when available; fall back to a
  // minimal plain object so tests can exercise the wrapper
  // without a real Web Speech implementation.
  const Ctor = (typeof window !== "undefined"
    ? (window as unknown as { SpeechSynthesisUtterance?: new (t: string) => SpeechSynthesisUtteranceLike }).SpeechSynthesisUtterance
    : undefined);
  if (Ctor) return new Ctor(text);
  return {
    text,
    lang: "es-AR",
    rate: 1,
    pitch: 1,
    volume: 1,
    onstart: null,
    onend: null,
    onerror: null,
    onpause: null,
    onresume: null,
  };
}

export function isSupported(): boolean {
  return synth() !== null;
}

export function speak(text: string, opts: SpeakOptions = {}): void {
  const s = synth();
  if (!s) return;
  // Defensive: cancel any in-flight speech first so the queue
  // doesn't overlap. Browsers throw if you call speak() while
  // another utterance is playing without first calling cancel.
  try { s.cancel(); } catch { /* ignore */ }
  const u = Utterance(text);
  u.lang = opts.lang ?? "es-AR";
  u.rate = opts.rate ?? 1;
  u.pitch = opts.pitch ?? 1;
  u.volume = opts.volume ?? 1;
  if (opts.onStart) u.onstart = () => opts.onStart?.();
  if (opts.onEnd) u.onend = () => opts.onEnd?.();
  if (opts.onError) u.onerror = () => opts.onError?.(new Error("speech-error"));
  try {
    s.speak(u);
  } catch (e) {
    if (opts.onError) opts.onError(e);
  }
}

export function stop(): void {
  const s = synth();
  if (!s) return;
  try { s.cancel(); } catch { /* ignore */ }
}

export function pause(): void {
  const s = synth();
  if (!s || !s.speaking) return;
  try { s.pause(); } catch { /* ignore */ }
}

export function resume(): void {
  const s = synth();
  if (!s || !s.paused) return;
  try { s.resume(); } catch { /* ignore */ }
}

export function isSpeaking(): boolean {
  return synth()?.speaking ?? false;
}

export function isPaused(): boolean {
  return synth()?.paused ?? false;
}
