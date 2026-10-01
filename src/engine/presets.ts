/**
 * Preset libraries for text styling and colour grading.
 *
 * CapCut's characteristic look comes from applying a preset in one click
 * rather than dialling in twelve sliders. Presets are plain `TextStyle` /
 * `ColorAdjust` patches, so applying one is an ordinary store update and stays
 * fully undoable like any other edit.
 */

import type { ColorAdjust, TextStyle } from '../types/timeline';
import { DEFAULT_COLOR, DEFAULT_TEXT } from '../types/timeline';

export interface TextPreset {
  id: string;
  label: string;
  /** Fields merged into the clip's existing text style. */
  patch: Partial<TextStyle>;
}

/**
 * Ready-made text looks.
 *
 * Values are tuned against the 1080x1920 default canvas, where the default
 * font size of 72 reads as a comfortable caption.
 */
export const TEXT_PRESETS: TextPreset[] = [
  {
    id: 'plain',
    label: 'Plain',
    patch: {
      fontSize: 72,
      color: '#ffffff',
      weight: 700,
      strokeWidth: 0,
      shadowBlur: 0,
      gradientEnabled: false,
      backgroundBadge: false,
      glowBlur: 0,
      animation: 'none',
    },
  },
  {
    id: 'outline',
    label: 'Outline',
    patch: {
      fontSize: 76,
      color: '#ffffff',
      weight: 800,
      strokeWidth: 8,
      strokeColor: '#000000',
      shadowBlur: 0,
      gradientEnabled: false,
      backgroundBadge: false,
      glowBlur: 0,
    },
  },
  {
    id: 'neon',
    label: 'Neon',
    patch: {
      fontSize: 80,
      color: '#00e5ff',
      weight: 700,
      strokeWidth: 2,
      strokeColor: '#0033ff',
      // A wide blur with a saturated colour is what reads as a neon glow.
      glowBlur: 40,
      glowColor: '#00e5ff',
      shadowBlur: 24,
      shadowColor: '#00b3ff',
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      gradientEnabled: false,
      backgroundBadge: false,
    },
  },
  {
    id: 'sunset',
    label: 'Sunset',
    patch: {
      fontSize: 80,
      color: '#ffffff',
      weight: 800,
      strokeWidth: 4,
      strokeColor: '#2b1055',
      shadowBlur: 20,
      shadowColor: '#ff4d6d',
      shadowOffsetX: 0,
      shadowOffsetY: 6,
      gradientEnabled: true,
      gradientFrom: '#ffd36e',
      gradientTo: '#ff4d6d',
      backgroundBadge: false,
      glowBlur: 0,
    },
  },
  {
    id: 'boxed',
    label: 'Boxed',
    patch: {
      fontSize: 64,
      color: '#ffffff',
      weight: 700,
      strokeWidth: 0,
      shadowBlur: 0,
      backgroundBadge: true,
      badgeColor: '#000000',
      badgePadding: 26,
      gradientEnabled: false,
      glowBlur: 0,
    },
  },
  {
    id: 'cinema',
    label: 'Cinema',
    patch: {
      fontSize: 56,
      color: '#f5f5f5',
      weight: 400,
      letterSpacing: 8,
      strokeWidth: 0,
      shadowBlur: 12,
      shadowColor: '#000000',
      shadowOffsetX: 0,
      shadowOffsetY: 3,
      gradientEnabled: false,
      backgroundBadge: false,
      glowBlur: 0,
    },
  },
  {
    id: 'pop',
    label: 'Pop',
    patch: {
      fontSize: 92,
      color: '#ffffff',
      weight: 900,
      strokeWidth: 10,
      strokeColor: '#111111',
      shadowBlur: 0,
      gradientEnabled: true,
      gradientFrom: '#ffffff',
      gradientTo: '#8b5cf6',
      backgroundBadge: false,
      glowBlur: 0,
      animation: 'bounce',
    },
  },
  {
    id: 'typewriter',
    label: 'Typewriter',
    patch: {
      fontSize: 68,
      color: '#ffffff',
      weight: 600,
      strokeWidth: 0,
      shadowBlur: 16,
      shadowColor: '#000000',
      shadowOffsetX: 0,
      shadowOffsetY: 4,
      gradientEnabled: false,
      backgroundBadge: false,
      glowBlur: 0,
      animation: 'typewriter',
      animationDuration: 45,
    },
  },
];

export interface FilterPreset {
  id: string;
  label: string;
  patch: Partial<ColorAdjust>;
}

/**
 * One-click colour looks, expressed as offsets from `DEFAULT_COLOR` so they
 * layer on top of whatever the user already has rather than resetting it.
 */
export const FILTER_PRESETS: FilterPreset[] = [
  { id: 'none', label: 'Original', patch: { ...DEFAULT_COLOR } },
  {
    id: 'cinematic',
    label: 'Cinematic',
    patch: { contrast: 0.25, saturation: 0.85, temperature: -12, tint: -0.04, vignette: 0.35, highlights: 0.15, shadows: -0.2 },
  },
  {
    id: 'vlog',
    label: 'Vlog',
    patch: { exposure: 0.15, contrast: 0.08, saturation: 1.15, temperature: 8, highlights: 0.1, shadows: 0.1 },
  },
  {
    id: 'warm',
    label: 'Warm',
    patch: { temperature: 28, saturation: 1.12, tint: 0.06, contrast: 0.1 },
  },
  {
    id: 'cool',
    label: 'Cool',
    patch: { temperature: -30, saturation: 0.95, tint: -0.06, contrast: 0.12 },
  },
  { id: 'bw', label: 'B&W', patch: { saturation: 0, contrast: 0.3, brightness: 0.02 } },
  { id: 'punch', label: 'Punch', patch: { contrast: 0.45, saturation: 1.5, exposure: 0.1, vignette: 0.2 } },
  {
    id: 'retro',
    label: 'Retro',
    patch: { saturation: 0.8, temperature: 18, tint: 0.1, shadows: -0.25, highlights: 0.2, vignette: 0.4 },
  },
  { id: 'fade', label: 'Fade', patch: { contrast: -0.2, brightness: 0.08, saturation: 0.7, shadows: 0.2 } },
];

/** Reset helper so "Original" is always exactly the documented defaults. */
export const DEFAULT_TEXT_PATCH: Partial<TextStyle> = { ...DEFAULT_TEXT };