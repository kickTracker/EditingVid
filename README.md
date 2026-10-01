# OpenCap — Local-First Video Editor

A video editor that runs entirely on your machine. No account, no upload, no
watermark, no paywall.

> **Status: working prototype.** The editing model, live preview and the FFmpeg
> export compiler are implemented and tested. Several features from the original
> design are *not* built yet — see [Not yet implemented](#not-yet-implemented).
> This document describes what the code actually does today.

---

## Running it

```bash
npm install
npm run dev      # http://localhost:1420
```

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server with hot reload on port 1420 |
| `npm run build` | Typecheck + production build into `dist/` |
| `npm run preview` | Serve the built output |
| `npm test` | 76 store unit tests |
| `npm run test:ffmpeg` | 32 export tests that render real video (needs FFmpeg) |

**Requirements:** Node 18+, and FFmpeg on `PATH` for exporting. There is no
Rust/Tauri shell yet, so this runs as a web app in the browser despite the
"desktop" framing of the original design.

---

## Architecture

- **UI:** React 19 + TypeScript + Vite, hand-written CSS (no Tailwind, no Radix).
- **State:** Zustand. `useTimelineStore` holds the document; `useHistoryStore`
  keeps whole-snapshot undo/redo; `useFontStore` tracks uploaded fonts.
- **Preview:** Canvas 2D compositor (`engine/canvasCompositor.ts`) behind a
  `Compositor` interface, so a WebGL2 backend can replace it later.
- **Playback:** `requestAnimationFrame` loop accumulating a float frame cursor,
  so the playhead lands on whole frames without drift.
- **Export:** `engine/ffmpegBuilder.ts` compiles the document into a single
  FFmpeg filtergraph. Pure and framework-free so it can be asserted in tests
  without spawning a process.

### Time is stored in frames, never seconds

`types/timeline.ts` keeps every position and duration as an integer frame count.
Floating-point seconds accumulate drift and make frame-accurate trimming
impossible. Conversion to seconds happens only at the edges — playback, and
FFmpeg filter expressions.

### Track model

Tracks are **created automatically**. `ensureTrackFor(kind, start, duration,
preferTop)` returns the lowest (or highest) track of a kind that is free across
the requested range, and creates one only when every track is occupied. Clips
that merely abut share a boundary legally and do not count as overlapping.

There is deliberately **no "add track" button**: you drop media or a text
overlay wherever you want and the timeline grows to accommodate it. Text uses
`preferTop` so it always layers *above* the footage.

---
## Feature status

### Working and tested

**Timeline editing**
- Frame-accurate split at the playhead (`Ctrl+B`), with source offsets preserved
- Trim via drag handles on either edge, correctly bounded by source duration
- Speed changes that recompute duration and refuse to overrun the source
- Reverse playback (video and audio)
- Drag clips between tracks; drag media in from the Library or the desktop,
  with a drop indicator showing the exact landing frame
- Per-track mute / hide / lock
- **Magnetic snapping** to the playhead and to every other clip's head/tail,
  picking whichever edge lands closest. Toggleable from the toolbar.
- **Ripple delete** — deleting a clip closes the gap on its own track only.
  Deleting a contiguous run shifts by the combined duration exactly once.
  Toggleable from the toolbar.
- **Transitions** on a clip's head (dissolve, wipes, slides, blur, zoom) with an
  adjustable length, previewed as a cross-fade in the canvas.

**Presets**
- **8 text presets** (Plain, Outline, Neon, Sunset, Boxed, Cinema, Pop,
  Typewriter) applied in one click
- **9 colour looks** (Original, Cinematic, Vlog, Warm, Cool, B&W, Punch, Retro,
  Fade) layered on top of the manual adjustment sliders

**Preview**
- Live compositing of video, image, text and sticker layers
- On-canvas **gizmo**: drag to move, corner handle to scale, top handle to
  rotate, on any selected clip
- Colour grading: brightness, contrast, saturation, exposure, temperature,
  vignette — applied to text as well as media
- Chroma key with similarity and smoothness
- Masks: rectangle, circle, star, linear-split, with feather and invert
- Transform: position, scale, rotation, opacity — with keyframes
- Keyframed properties evaluated per frame (position, scale, rotation, opacity)

**Text**
- Content, font family (system or uploaded `.ttf`/`.otf`/`.woff2`), size, weight,
  colour, alignment
- Stroke width + colour, shadow blur/colour/X/Y, glow blur + colour
- Gradient fill **with both colour stops**, background badge + padding
- In animations: typewriter, bounce, fade, glitch, flip

**Canvas**
- Aspect-ratio presets (9:16, 16:9, 1:1, 4:5, 4:3, 21:9) plus custom W/H
- The first media imported adopts its own aspect ratio, so a landscape clip is
  not letterboxed into a portrait project
- Sizes are rounded down to even numbers, as H.264 requires

**Export (FFmpeg filtergraph)**
- Trim, speed (`atempo`, chained beyond 2×), reverse
- Colour grade, chroma key, masks, transforms
- Keyframes compiled to FFmpeg expressions, so export is a single decode/encode
- Styled text via `drawtext`, including uploaded fonts via explicit `fontfile`
- Audio: gain, pan, mute, fades, mixdown with a limiter to prevent clipping
- Encoder selection: libx264, NVENC, QuickSync, VideoToolbox

### Not yet implemented

These are on the roadmap but **do not exist**. Do not expect them:

- **In-app rendering.** The Export dialog compiles and displays the FFmpeg
  command; there is no sidecar to execute it. Run the command manually.
- **Transitions in the exported file.** Transitions are stored, editable and
  previewed as a cross-fade, but the export compiler does not yet emit `xfade`.
  **An exported project currently renders a hard cut where a transition is.**
- **Auto-captions / speech-to-text.** Would require shipping a speech model
  (e.g. Whisper.wasm) and downloading model weights at runtime.
- **AI background removal** (beyond chroma key).
- **Speed / velocity ramping and speed-curve presets** (Hero, Bullet Time…).
  There is a single speed control, not a curve.
- **GLSL effects library** (glitch, shake, flash, RGB split). The compositor is
  Canvas 2D; there is no shader pipeline.
- **LUT files.** The colour presets are parameter sets, not `.cube` LUTs.
- **Audio waveforms** drawn inside timeline clips.
- **Stock audio / SFX / stickers / music library.** Needs bundled or fetched
  assets plus licensing review.
- **Subtitles / captions**, `.srt` and `.vtt` import/export
- **Multi-select gizmo**, centre alignment guides, aspect-ratio lock on canvas
- **Equalizer, pitch shifting, noise reduction**
- **WebGL renderer** — the preview is Canvas 2D
- **Tauri desktop shell** — no Rust, no `src-tauri/`
- **Project save/load** — state lives in memory and is lost on refresh
- **Adjustment layers** (the clip kind exists but is inert)

### Known rough edges

- **Gradient fills, glow and text animations do not survive export.** `drawtext`
  cannot express them, so the exported video differs from the preview. They are
  implemented in the canvas compositor only.
- **Audio-track detection is best-effort.** Browsers cannot reliably report
  whether a file has audio before decoding it. `Clip.hasAudio` is probed at
  import; unknown defaults to audible, so a silent WebM can fail at export.
- **Undo granularity is per-change, not per-action.** Dragging a slider records
  many small steps rather than one coalesced step.
- **Star masks are drawn as diamonds.** `geq` cannot express a five-point star
  polygon compactly.
- **Snapping tolerance is a flat 8 frames**, so at high zoom it can feel coarse
  and at low zoom it may grab a clip you did not intend.

---

## Testing approach

The export tests are genuine integration tests: each builds a project, runs a
real `ffmpeg` command, and probes the output with `ffprobe` to assert duration,
dimensions and stream layout. They skip cleanly (exit 0) when FFmpeg is absent.

This caught bugs that reading the code did not, including FFmpeg rejecting
`c=none` on `rotate`, `chromakey` silently parsing a fourth positional argument
as a boolean, `colorlevels` overflowing its documented ranges, duplicate filter
labels invalidating an entire graph, and a Windows FFmpeg build whose missing
fontconfig made `drawtext` crash unless given an explicit `fontfile`.

---

## Layout

```text
src/
├── components/
│   ├── Timeline/      # tracks, clips, playhead, trim handles
│   ├── Viewport/      # canvas preview + transport
│   ├── Library/       # media intake, text, font upload
│   ├── Inspector/     # per-clip properties
│   └── Common/        # controls, export dialog
├── store/             # timeline, history, fonts
├── engine/            # compositor, frame loop, keyframes, fonts, ffmpeg builder
├── types/timeline.ts  # domain model
└── App.tsx
tests/
├── store.test.ts      # editing operations and auto-track behaviour
└── ffmpeg.test.ts     # real renders through the export compiler
```