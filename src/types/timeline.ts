/**
 * Core domain model for the OpenCap timeline.
 *
 * Time is expressed in integer FRAMES, never seconds. Floating point seconds
 * accumulate drift and make frame-accurate trimming impossible. Every
 * conversion to seconds happens at the very edge (playback, FFmpeg filters).
 */

export const DEFAULT_FPS = 30;

/** Convert a frame count to seconds for playback/export. */
export const framesToSeconds = (frames: number, fps = DEFAULT_FPS): number => frames / fps;

/** Convert seconds to the nearest whole frame. */
export const secondsToFrames = (seconds: number, fps = DEFAULT_FPS): number =>
  Math.round(seconds * fps);

export type TrackKind = 'video' | 'audio';

export type ClipKind = 'video' | 'image' | 'audio' | 'text' | 'adjustment' | 'sticker';

/** Transition types compiled to GLSL for preview and xfade for export. */
export type TransitionType =
  | 'none'
  | 'fade'
  | 'wipe-left'
  | 'wipe-right'
  | 'slide-up'
  | 'slide-down'
  | 'blur'
  | 'zoom';

export interface Transition {
  type: TransitionType;
  /** Duration in frames. */
  duration: number;
}

export interface Transform {
  /** Anchor-relative position in project space (px at 1080p reference). */
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  /** Normalized 0..1 anchor point. */
  anchorX: number;
  anchorY: number;
}

export interface ColorAdjust {
  exposure: number;
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  tint: number;
  highlights: number;
  shadows: number;
  vignette: number;
}

export interface ChromaKey {
  enabled: boolean;
  /** Hex string, sampled from a picker. */
  color: string;
  similarity: number;
  smoothness: number;
  spill: number;
}

export interface MaskShape {
  enabled: boolean;
  type: 'rectangle' | 'circle' | 'linear-split' | 'star';
  x: number;
  y: number;
  width: number;
  height: number;
  feather: number;
  inverted: boolean;
}

/** Animated properties. A clip with an empty map is fully static. */
export type AnimatableKey = 'x' | 'y' | 'scale' | 'rotation' | 'opacity';

export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold';

export interface Keyframe {
  id: string;
  /** Frame relative to the start of the clip. */
  frame: number;
  value: number;
  easing: Easing;
}

export type TextAnimation =
  | 'none'
  | 'typewriter'
  | 'bounce'
  | 'fade'
  | 'glitch'
  | 'flip';
export interface TextStyle {
  content: string;
  fontFamily: string;
  /** Custom font key registered in useFontStore. */
  customFontId?: string;
  fontSize: number;
  color: string;
  weight: number;
  italic: boolean;
  letterSpacing: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right';
  strokeWidth: number;
  strokeColor: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  glowColor: string;
  glowBlur: number;
  /** Two-stop gradient fill; ignored when gradientEnabled is false. */
  gradientEnabled: boolean;
  gradientFrom: string;
  gradientTo: string;
  backgroundBadge: boolean;
  badgeColor: string;
  badgePadding: number;
  animation: TextAnimation;
  animationDuration: number;
}

export interface Clip {
  id: string;
  trackId: string;
  kind: ClipKind;
  name: string;
  /** Object URL or asset path for media-backed clips. */
  src?: string;
  /** Project timeline placement, in frames. */
  start: number;
  /** Source in-point (trim head), in frames relative to source media. */
  inPoint: number;
  /** Visible length on the timeline, in frames (already speed-adjusted). */
  duration: number;
  /** Source media length in frames; 0 for text/sticker/adjustment. */
  sourceDuration: number;
  /**
   * Whether the source file actually contains an audio stream.
   *
   * Probed at import time because the exporter cannot recover this from the
   * filtergraph: referencing `[i:a]` for a file with no audio track makes
   * FFmpeg reject the whole command. Undefined means "unknown", which the
   * exporter treats as audible.
   */
  hasAudio?: boolean;
  speed: number;
  reverse: boolean;
  /** Frozen frame to render, for image clips. */
  posterFrame?: number;
  volume: number;
  muted: boolean;
  /** Stereo pan, -1 (left) .. 1 (right). */
  pan: number;
  fadeIn: number;
  fadeOut: number;
  transform: Transform;
  color: ColorAdjust;
  chromaKey: ChromaKey;
  mask: MaskShape;
  text?: TextStyle;
  keyframes: Partial<Record<AnimatableKey, Keyframe[]>>;
  transitionIn?: Transition;
  transitionOut?: Transition;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
  /** Video track stacking index; 0 is the bottom-most layer. */
  order: number;
}

export interface ProjectSettings {
  /** Display name shown in the top bar and Details panel. */
  name: string;
  width: number;
  height: number;
  fps: number;
  backgroundColor: string;
  sampleRate: number;
}

export const DEFAULT_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
  anchorX: 0.5,
  anchorY: 0.5,
};

export const DEFAULT_COLOR: ColorAdjust = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  saturation: 1,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  vignette: 0,
};

export const DEFAULT_CHROMA: ChromaKey = {
  enabled: false,
  color: '#00b140',
  similarity: 0.4,
  smoothness: 0.1,
  spill: 0.2,
};

export const DEFAULT_MASK: MaskShape = {
  enabled: false,
  type: 'rectangle',
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  feather: 0,
  inverted: false,
};

export const DEFAULT_TEXT: TextStyle = {
  content: 'Double-click to edit',
  fontFamily: 'Inter',
  fontSize: 72,
  color: '#ffffff',
  weight: 700,
  italic: false,
  letterSpacing: 0,
  lineHeight: 1.2,
  align: 'center',
  strokeWidth: 0,
  strokeColor: '#000000',
  shadowColor: '#000000',
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 4,
  glowColor: '#000000',
  glowBlur: 0,
  gradientEnabled: false,
  gradientFrom: '#ffffff',
  gradientTo: '#8b5cf6',
  backgroundBadge: false,
  badgeColor: '#000000',
  badgePadding: 24,
  animation: 'none',
  animationDuration: 30,
};

export const DEFAULT_PROJECT: ProjectSettings = {
  name: 'Untitled project',
  width: 1080,
  height: 1920,
  fps: DEFAULT_FPS,
  backgroundColor: '#000000',
  sampleRate: 48000,
};

/** Generates a collision-resistant id without pulling in a uuid dependency. */
export const uid = (prefix = 'id'): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

/** Clamp helper used across the store and renderer. */
export const clamp = (v: number, min: number, max: number): number =>
  Math.min(Math.max(v, min), max);

/** Linear interpolation used for keyframe evaluation. */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Monotonic map from 0..1 to the easing curves the UI exposes. */
export const applyEasing = (t: number, easing: Easing): number => {
  switch (easing) {
    case 'ease-in':
      return t * t;
    case 'ease-out':
      return 1 - (1 - t) * (1 - t);
    case 'ease-in-out':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'hold':
      return t < 1 ? 0 : 1;
    default:
      return t;
  }
};

