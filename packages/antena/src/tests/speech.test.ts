import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  speak,
  stop,
  pause,
  resume,
  isSpeaking,
  isPaused,
  isSupported,
  type SpeakOptions,
} from "../lib/speech";

// Minimal web speech API shim for the tests. We use vi.stubGlobal
// because happy-dom's window.speechSynthesis is a no-op stub that
// doesn't fire the events we'd need to observe state.
class FakeUtterance {
  text: string;
  lang = "es-AR";
  rate = 1;
  pitch = 1;
  volume = 1;
  onstart: ((e: Event) => void) | null = null;
  onend: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onpause: ((e: Event) => void) | null = null;
  onresume: ((e: Event) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

const fakeSynth = {
  speak: vi.fn(),
  cancel: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  speaking: false,
  paused: false,
  getVoices: () => [] as SpeechSynthesisVoice[],
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

beforeEach(() => {
  vi.stubGlobal("window", {
    speechSynthesis: fakeSynth,
    SpeechSynthesisUtterance: FakeUtterance,
  });
  vi.stubGlobal("speechSynthesis", fakeSynth);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  fakeSynth.speak.mockClear();
  fakeSynth.cancel.mockClear();
  fakeSynth.pause.mockClear();
  fakeSynth.resume.mockClear();
  fakeSynth.speaking = false;
  fakeSynth.paused = false;
});

describe("speech helpers", () => {
  it("isSupported returns false when speechSynthesis is missing", () => {
    const original = (globalThis as any).window;
    (globalThis as any).window = {};
    expect(isSupported()).toBe(false);
    (globalThis as any).window = original;
  });

  it("isSupported returns true when speechSynthesis is present", () => {
    expect(isSupported()).toBe(true);
  });

  it("speak() creates an utterance and calls synth.speak", () => {
    speak("Hola mundo", { lang: "es-AR" });
    expect(fakeSynth.speak).toHaveBeenCalledTimes(1);
    const utt = fakeSynth.speak.mock.calls[0][0];
    expect(utt).toBeInstanceOf(FakeUtterance);
    expect(utt.text).toBe("Hola mundo");
    expect(utt.lang).toBe("es-AR");
  });

  it("speak() is a no-op when not supported", () => {
    const original = (globalThis as any).window;
    (globalThis as any).window = {};
    speak("test");
    expect(fakeSynth.speak).not.toHaveBeenCalled();
    (globalThis as any).window = original;
  });

  it("stop() calls synth.cancel", () => {
    stop();
    expect(fakeSynth.cancel).toHaveBeenCalledTimes(1);
  });

  it("pause() calls synth.pause when speaking", () => {
    fakeSynth.speaking = true;
    pause();
    expect(fakeSynth.pause).toHaveBeenCalledTimes(1);
  });

  it("pause() is a no-op when not speaking", () => {
    fakeSynth.speaking = false;
    pause();
    expect(fakeSynth.pause).not.toHaveBeenCalled();
  });

  it("resume() calls synth.resume when paused", () => {
    fakeSynth.paused = true;
    resume();
    expect(fakeSynth.resume).toHaveBeenCalledTimes(1);
  });

  it("isSpeaking/isPaused reflect the synth state", () => {
    fakeSynth.speaking = true;
    fakeSynth.paused = false;
    expect(isSpeaking()).toBe(true);
    expect(isPaused()).toBe(false);
    fakeSynth.speaking = false;
    fakeSynth.paused = true;
    expect(isSpeaking()).toBe(false);
    expect(isPaused()).toBe(true);
  });
});
