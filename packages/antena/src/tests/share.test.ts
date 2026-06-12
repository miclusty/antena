import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildWhatsAppUrl, buildShareMessage } from "../lib/share";
import { createMockNews } from "./helpers";

describe("buildWhatsAppUrl", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    if (originalWindow) {
      globalThis.window = originalWindow;
    } else {
      delete (globalThis as { window?: Window }).window;
    }
  });

  it("uses wa.me deep link with encoded text and URL", () => {
    const news = createMockNews({ id: "abc-123", title: "Hola Mundo" });
    const url = buildWhatsAppUrl(news);
    expect(url).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });

  it("wraps the title in asterisks for bold formatting", () => {
    const news = createMockNews({ id: "n1", title: "Dólar blue sube" });
    const url = buildWhatsAppUrl(news);
    const decoded = decodeURIComponent(url.split("text=")[1]);
    expect(decoded).toContain("*Dólar blue sube*");
  });

  it("appends 'N medios cubren esto en Antena' when sourcesCount > 1", () => {
    const news = createMockNews({ id: "n1", title: "T", sourcesCount: 7 });
    const url = buildWhatsAppUrl(news);
    const decoded = decodeURIComponent(url.split("text=")[1]);
    expect(decoded).toContain("— 7 medios cubren esto en Antena");
  });

  it("does NOT append sources tagline when sourcesCount <= 1", () => {
    const news = createMockNews({ id: "n1", title: "T", sourcesCount: 1 });
    const url = buildWhatsAppUrl(news);
    const decoded = decodeURIComponent(url.split("text=")[1]);
    expect(decoded).not.toContain("medios cubren");
  });

  it("appends signed bias score when biasScore is present", () => {
    const news = createMockNews({ id: "n1", title: "T", biasScore: 0.42 });
    const url = buildWhatsAppUrl(news);
    const decoded = decodeURIComponent(url.split("text=")[1]);
    expect(decoded).toContain("(sesgo: +0.42)");
  });

  it("formats negative bias score with leading minus sign", () => {
    const news = createMockNews({ id: "n1", title: "T", biasScore: -0.15 });
    const url = buildWhatsAppUrl(news);
    const decoded = decodeURIComponent(url.split("text=")[1]);
    expect(decoded).toContain("(sesgo: -0.15)");
  });

  it("omits bias annotation when biasScore is null", () => {
    const news = createMockNews({ id: "n1", title: "T", biasScore: null });
    const url = buildWhatsAppUrl(news);
    const decoded = decodeURIComponent(url.split("text=")[1]);
    expect(decoded).not.toContain("sesgo:");
  });

  it("includes the brand suffix 'Antena.ar'", () => {
    const news = createMockNews({ id: "n1", title: "T" });
    const url = buildWhatsAppUrl(news);
    const decoded = decodeURIComponent(url.split("text=")[1]);
    expect(decoded).toContain("Antena.ar");
  });

  it("uses window.location.origin when available", () => {
    Object.defineProperty(globalThis, "window", {
      value: { location: { origin: "https://antena.ar" } },
      configurable: true,
    });
    const news = createMockNews({ id: "abc", title: "T" });
    const url = buildWhatsAppUrl(news);
    const decoded = decodeURIComponent(url.split("text=")[1]);
    expect(decoded).toContain("https://antena.ar/noticia/abc");
  });

  it("falls back to relative /noticia/ URL when window is undefined", () => {
    delete (globalThis as { window?: Window }).window;
    const news = createMockNews({ id: "abc", title: "T" });
    const url = buildWhatsAppUrl(news);
    const decoded = decodeURIComponent(url.split("text=")[1]);
    expect(decoded).toContain("/noticia/abc");
  });
});

describe("buildShareMessage", () => {
  it("returns whatsapp, telegram, and web share URLs", () => {
    const news = createMockNews({ id: "n1", title: "Hola" });
    const msgs = buildShareMessage(news);
    expect(msgs.whatsapp).toMatch(/^https:\/\/wa\.me\//);
    expect(msgs.telegram).toMatch(/^https:\/\/t\.me\/share\/url\?/);
    expect(msgs.web).toBe("/noticia/n1");
  });

  it("telegram URL encodes the article id and title", () => {
    const news = createMockNews({ id: "x-9", title: "Mi Noticia" });
    const msgs = buildShareMessage(news);
    expect(msgs.telegram).toContain("url=");
    expect(decodeURIComponent(msgs.telegram)).toContain("/noticia/x-9");
    expect(decodeURIComponent(msgs.telegram)).toContain("Mi Noticia");
  });
});
