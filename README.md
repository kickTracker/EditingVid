# OpenCap — Local-First CapCut Clone

## 🎯 Project Vision & Core Mandate
OpenCap is a high-performance, 100% local-first desktop video editor built to replicate CapCut's desktop features without paywalls, sign-ins, or cloud dependencies.

- **Zero Sign-In & Accounts:** All projects, clips, and settings stay on your local disk.
- **Zero Watermarks & Paywalls:** 100% free and open-source local rendering.
- **Local Hardware Acceleration:** Preview via local GPU (WebGL/WebGPU) and export via native FFmpeg using local GPU encoders (NVENC, QuickSync, VideoToolbox).

---

## 🛠️ Architecture & Tech Stack

### Framework & Performance Pipeline
- **Desktop Shell:** Tauri v2 (Rust) — Low memory footprint, fast IPC, small binary size.
- **UI Framework:** React 19 + TypeScript + Vite + Tailwind CSS.
- **Icons & UI Assets:** Lucide React + Radix UI primitives.
- **State Engine:** Zustand (Normalized multi-track state, history stack for Undo/Redo, playhead sync).
- **Preview Engine:** HTML5 Canvas + WebGL Shaders (Real-time compositing of text, fonts, video layers, and transforms at 60 FPS).
- **Export & Processing:** Native FFmpeg CLI binary spawned via Rust sidecar process (translates project state into dynamic complex filtergraphs).
- **Font & Asset Storage:** Web Font Loader / Canvas Font API + Local IndexedDB for caching assets locally.

---

## 🎨 Feature Specifications Matrix

### 1. Multi-Track Video Editing & Cutting
- **Precision Trimming & Splitting:** Frame-accurate cuts (`Ctrl+B` / `Cmd+B`), ripple edit, and slip/slide tools.
- **Transform Gizmos:** Interactive on-canvas visual bounding box for position $(x, y)$, scale, rotation, and anchor point modification.
- **Speed Ramping:** Variable speed curves (0.1x to 100x), pitch preservation, and reverse playback support.
- **Keyframing System:** Keyframe support for opacity, position, scale, rotation, and filter intensities.
- **Transitions:** Video/Image clip transitions (Fades, Wipes, Blurs, Slides, Zooms) compiled as WebGL shaders for live preview and FFmpeg xfade filters for export.

### 2. Rich Text & Dynamic Subtitles
- **Custom Font Engine:** Support for system fonts, Google Fonts integration, and local `.ttf` / `.otf` / `.woff2` font uploads.
- **CapCut-Style Text Presets:** 3D text styling, stroke/outline width, dropshadows, glowing borders, background badges, and gradient fills.
- **Text Animations:** In/Out/Loop text animations (Typewriter, Bounce, Fade, Glitch, Flip).
- **Subtitles & Captions:** Dynamic auto-captions engine, manual subtitle sync, `.srt` / `.vtt` file import and export.

### 3. Visual Effects, Filters & Compositing
- **Color Grading & Adjustment Layers:** Real-time controls for Exposure, Brightness, Contrast, Saturation, Temperature, Tint, Highlights, Shadows, and Vignette via GLSL shaders.
- **Chroma Key (Green Screen):** Color picker for background removal with tolerance and edge-feathering controls.
- **Masking:** Shape masks (Rectangle, Circle, Linear Split, Star) with feathering and invert options.
- **Stickers & Overlays:** PNG/GIF/SVG overlay support, blend modes (Multiply, Screen, Overlay, Soft Light, Darken).

### 4. Audio Engine & Sound Design
- **Multi-Track Audio:** Separate music, voiceover, and sound effect tracks.
- **Audio Controls:** Volume gain, mute, solo, stereo panning, fade-in/fade-out handles.
- **Equalizer & Effects:** Pitch shifting, noise reduction, and basic EQ presets.
- **Waveform Rendering:** High-performance Canvas-rendered audio waveforms for accurate beat matching and cutting.

---

## 🏗️ Directory Architecture

```text
├── src/                          # React + TypeScript Frontend
│   ├── components/
│   │   ├── Timeline/             # Multi-track timeline, tracks, playhead, trim handles, cuts
│   │   ├── Viewport/             # Canvas/WebGL preview player with transform gizmos
│   │   ├── Library/              # Media intake, custom fonts, stickers, text presets
│   │   ├── Inspector/            # Clip properties, text/font styling, speed curves, color filters
│   │   └── Common/               # Modal dialogs, sliders, color pickers, curve editors
│   ├── store/
│   │   ├── useTimelineStore.ts   # Main Zustand timeline store (Tracks, clips, playhead, cuts)
│   │   ├── useFontStore.ts       # Loaded custom fonts and text style presets
│   │   └── useHistoryStore.ts    # Undo/Redo state stack management
│   ├── engine/
│   │   ├── frameLoop.ts          # requestAnimationFrame sync loop (60 FPS player)
│   │   ├── webglRenderer.ts      # WebGL shader engine for video, text overlays, and filters
│   │   ├── fontLoader.ts         # Font face loader for custom TTF/OTF files
│   │   └── ffmpegBuilder.ts      # Complex FFmpeg filtergraph compiler for video export
│   ├── App.tsx
│   └── main.tsx
├── src-tauri/                    # Rust Backend (Tauri v2)
│   ├── src/
│   │   ├── lib.rs                # Tauri IPC commands & native window settings
│   │   ├── ffmpeg.rs             # Native FFmpeg sidecar execution and progress parser
│   │   └── main.rs
│   └── Cargo.toml
└── README.md                     # Context and instructions for AI agents and developers