# WebLLM Agent Experiment

> **Status**: Archived. The WebLLM agent is **not** in v1.0. The code lives on the `feature/webllm-agent` branch as a historical record.

## What we tried

A conversational news assistant that runs **entirely in the browser** via [@mlc-ai/web-llm](https://github.com/mlc-ai/web-llm). The user would speak or type a question ("¿qué pasó en Córdoba hoy?") and the agent would pull news from the API and synthesize a spoken answer, with the LLM running on the user's GPU.

## Why we tried it

In late 2025 we explored the idea of a **differentiated product story** for Antena. Most news apps are read-only; the conversation-with-your-news angle was original and demo-worthy. The "runs in your browser, no data leaves your device" pitch was a strong privacy story for Argentina's media-conscious users.

We built a working prototype in Q1 2026:

- `/chat` route in Antena
- WebLLM loaded `@mlc-ai/Llama-3.2-3B-Instruct-q4f16_1-MLC` (3B param Llama 3.2 quantized)
- Voice input via Web Speech API (`SpeechRecognition`)
- Voice output via Web Speech API (`SpeechSynthesis`)
- "Memory" persisted in IndexedDB (bookmarks, conversation history)
- 18 community-service stubs in the sidebar ("Sintonizar", "Pulso", "Radio AI", …)

The prototype worked on a 2023 MacBook Pro with WebGPU.

## Why it didn't fit v1

The WebLLM agent hit five walls that made it incompatible with the Antena v1 brief ("mobile-first, edge-native, fast, low-bandwidth"):

### 1. Not edge-native

A 3 GB WebAssembly bundle is the opposite of edge-native. Antena's whole architecture is "no big payload, no server round-trip, runs on a $200 phone on 3G." A WebLLM agent inverts that: big payload, GPU-required, fails on weak hardware.

### 2. Not mobile-first

WebLLM requires **WebGPU**. As of June 2026, WebGPU is on:

- Chrome/Edge desktop
- Safari desktop (16.4+)
- Chrome Android (since Chrome 121, but only on flags in many devices)
- Safari iOS: **not yet** (still behind a flag in Safari Technology Preview)

iOS — the dominant mobile platform in Argentina — **does not support WebGPU** in production. Shipping a feature that breaks on the device most of our users have is a non-starter.

### 3. 2-4 GB model download kills the mobile UX

Llama-3.2-3B q4f16_1 is **~1.8 GB**. The first load requires the user to download 1.8 GB. On a typical Argentine 4G connection (~10 Mbps median), that's **~25 minutes**. Even cached, the model sits in browser cache and re-downloads on browser update.

For comparison, the entire Antena v1 bundle (HTML + JS + CSS + service worker) is **< 200 KB** gzipped. The WebLLM model is **9,000x larger** than the entire app.

### 4. RAM and battery

The 3B model in q4 needs ~3 GB of GPU memory. Most phones in our target market have 4-6 GB of **total** RAM. Running the model in the background or alongside the feed means:

- The feed is throttled
- Other apps get killed
- Battery drains in ~30 minutes of active use
- The phone gets hot

### 5. Not actually conversational

After two weeks of testing, we found that the conversational UX was a **net negative** for a news product:

- News is meant to be **scannable**, not narrated
- A 30-second voice answer covers 5 stories; the feed shows 20+ in the same time
- Users on a bus or in a café don't want their phone reading the news aloud
- Transcription errors on Argentine Spanish accents were ~25%
- Latency from "user stops typing" to "agent answers" was 4-8s on a desktop, 12-20s on mobile

The "conversational" angle was solving a problem users didn't have.

## What we kept from the experiment

A few ideas from the WebLLM experiment survived in v1 in stripped-down form:

- **Bias spectrum UI** (the dual color stripe on cards) — originally built to feed the agent context, kept as a direct visual signal
- **Cluster view** — synthesized article from multiple sources. We now generate the synthesis **server-side** via MiniMax API (small, fast, no GPU) and cache the result
- **Long-press action sheet** — the "ask about this article" hook was removed but the menu survived
- **Argentine political color palette** — kept as the bias visualization

## Where the code lives

The prototype is on the `feature/webllm-agent` branch:

```bash
git fetch origin
git checkout feature/webllm-agent
```

Files of interest:

- `packages/antena/src/lib/local-llm.ts` — WebLLM wrapper
- `packages/antena/src/lib/voice.ts` — SpeechRecognition + SpeechSynthesis
- `packages/antena/src/lib/agent.ts` — tool-calling agent loop
- `packages/antena/src/lib/memory.ts` — IndexedDB conversation history
- `packages/antena/src/lib/antenas.ts` — 18 community-service stubs
- `packages/antena/src/components/agent/` — chat UI components

These are **not in main** and are **not in v1.0**. They are kept for historical reference and as a starting point if a future version wants to revisit the idea.

## Future consideration: Workers AI

When (and if) we revisit conversational news, the right path is **Cloudflare Workers AI**, not WebLLM:

- Edge-native (runs in the Worker, not the browser)
- No client-side download
- Works on any device, including iOS
- Pay-per-use, no per-user bundle tax
- Models: `@cf/meta/llama-3.1-8b-instruct` (8B), `@cf/mistral/mistral-7b-instruct-v0.1` (7B), or smaller distilled models

Cost estimate: at 1M users × 5 queries/day × ~2k input tokens + ~500 output tokens, Workers AI is ~$3-5k/month — affordable, and zero PII leaves Cloudflare's network.

This is a v2 or v3 idea, not v1. We mention it in [CHANGELOG.md](../../CHANGELOG.md) under "Future".

## Lesson

**Edge-native is a constraint, not a limitation.** The hardest part of v1 wasn't building the feed — it was saying no to features that would have been cool in a desktop browser but break on a 4-year-old Android phone on 3G. The WebLLM agent was the biggest "no" of the project. We're better for it.
