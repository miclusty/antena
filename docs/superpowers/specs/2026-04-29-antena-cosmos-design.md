# Antena Cosmos — Design Spec

## Overview

Antena Cosmos is a spatial news visualization that replaces the traditional scroll-based feed with an orbital information space. The user sits at the center of a live cosmos where news stories orbit around them, organized by time (radial distance) and political bias (angular position). A local LLM serves as an ambient co-pilot, whispering context when the user focuses on a story.

## Architecture

```
┌──────────────────────────────────────────┐
│  CosmosView.tsx                          │
│  ┌─ Canvas 2D (orbital rendering) ────┐  │
│  │  CosmosEngine.ts (physics, layout) │  │
│  │  OrbitalBody.ts (per-item render)  │  │
│  └────────────────────────────────────┘  │
│  ┌─ UI Overlay (HTML) ────────────────┐  │
│  │  VoiceLayer.tsx (mic button)       │  │
│  │  FocusPanel.tsx (article reader)   │  │
│  │  CopilotBubble.tsx (ambient text)  │  │
│  └────────────────────────────────────┘  │
├──────────────────────────────────────────┤
│  CopilotBrain.ts (WebLLM Qwen 3.5 2B)   │
│  └─ contextual whispers, summarization   │
├──────────────────────────────────────────┤
│  Existing Antena layer (unchanged)        │
│  └─ api.ts, bias.ts, types, bookmarks    │
└──────────────────────────────────────────┘
```

## Spatial Layout

- **Radial distance** = recency (breaking news near center, older further out)
- **Angular position** = bias_score mapped to polar angle (0°=strong opposition, 180°=neutral, 360°=strong officialist)
- **Orbit ring** = category (politics inner ring, sports outer ring, etc.)
- **Body size** = source_count (more sources = bigger)
- **Color** = getBiasGradientColor() from bias.ts
- **Pulse/opacity** = signal_level (breaking = pulsating)
- **Connecting arcs** = same cluster_id (thin curve between bodies in same cluster)

## Interaction

### Touch
- Pinch/spread = zoom (camera distance)
- One-finger drag = pan/rotate the cosmos
- Tap on body = focus mode (zoom in, show article preview)
- Double-tap = open article in FocusPanel
- Long press = trigger Copilot whisper

### Voice (push-to-talk)
- Hold mic button → transcribe via Web Speech API
- Parse intent: "mostrame Córdoba", "solo opositores", "leeme este"
- Filter/zoom the cosmos based on command

### Copilot (ambient LLM)
- When user focuses a cluster: whisper context via TTS
- Detects blindspots (5+ officialist, 0 opposition sources)
- Proactive alerts for fast-growing stories

## MVP Scope

### In this iteration
- Canvas 2D orbital rendering with CosmosEngine
- Touch gestures (zoom, pan, tap, double-tap)
- Toggle between Feed and Cosmos views in App.tsx
- Voice push-to-talk via Web Speech API
- Focus panel for article reading
- CopilotBrain with WebLLM for contextual whispers

### Out of scope (future)
- Three.js 3D rendering
- Whisper-WebGPU local transcription (Web Speech API cloud-first)
- Force-directed layout for cluster grouping
- Timeline slider for historical view
