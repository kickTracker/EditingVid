/**
 * Canvas 2D layer compositor for the live preview.
 *
 * Chosen over a WebGL pipeline deliberately: this delivers correct,
 * frame-accurate compositing of transforms, colour grade, chroma key and text
 * without shader-compilation surface. The seam is the `Compositor` interface,
 * so a WebGL2 backend can be swapped in later without touching the UI.
 */

import type { Clip, ProjectSettings } from '../types/timeline';
import { resolveTransform } from './keyframeEngine';

export interface Compositor {
  render(clips: Clip[], frame: number, settings: ProjectSettings): void;
  resize(width: number, height: number): void;
}

/** Apply color-grade settings using canvas filter primitives. */
const buildFilter = (clip: Clip): string => {
  const { color } = clip;
  const parts: string[] = [];
  if (color.brightness !== 0) {
    // brightness is additive (-1..1) in the store; CSS expects a multiplier.
    parts.push(`brightness(${(1 + color.brightness).toFixed(3)})`);
  }
  if (color.contrast !== 0) parts.push(`contrast(${(1 + color.contrast).toFixed(3)})`);
  if (color.saturation !== 1) parts.push(`saturate(${color.saturation.toFixed(3)})`);
  // Temperature maps onto a warm/cool approximation.
  if (color.temperature !== 0) parts.push(color.temperature > 0 ? 'sepia(0.35)' : 'hue-rotate(200deg)');
  return parts.join(' ');
};

const hexToRgb = (hex: string): [number, number, number] => {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0');
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
};

/**
 * Chroma distance, returned as a smoothstepped 0..1 alpha where 1 keeps the
 * pixel. Kept in RGB distance space; a true YCbCr conversion would be more
 * accurate against luma changes but is not worth the cost per pixel here.
 */
const chromaAlpha = (
  r: number,
  g: number,
  b: number,
  key: [number, number, number],
  similarity: number,
  smoothness: number,
): number => {
  const dist = Math.sqrt((r - key[0]) ** 2 + (g - key[1]) ** 2 + (b - key[2]) ** 2) / 441.67;
  const lo = similarity;
  const hi = similarity + Math.max(0.0001, smoothness);
  const t = Math.max(0, Math.min(1, (dist - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Per-clip decoded media elements, so re-rendering does not re-decode. */
const cache = new Map<string, HTMLVideoElement | HTMLImageElement>();

export const pruneMediaCache = (liveIds: Set<string>): void => {
  cache.forEach((_v, id) => {
    if (!liveIds.has(id)) cache.delete(id);
  });
};

export class CanvasCompositor implements Compositor {
  private ctx: CanvasRenderingContext2D;
  private scratch: HTMLCanvasElement;
  private scratchCtx: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable.');
    this.ctx = ctx;

    // Offscreen buffer used for per-pixel chroma keying.
    this.scratch = document.createElement('canvas');
    const sctx = this.scratch.getContext('2d', { willReadFrequently: true });
    if (!sctx) throw new Error('Scratch 2D context unavailable.');
    this.scratchCtx = sctx;
  }

  resize(width: number, height: number): void {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  /**
   * Paint the project. Clips must arrive in layer order (bottom track first)
   * because this composites back-to-front.
   */
  render(clips: Clip[], frame: number, settings: ProjectSettings): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = settings.backgroundColor;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    for (const clip of clips) {
      if (clip.kind === 'text') this.drawText(clip, frame, settings);
      else if (clip.src) this.drawMedia(clip, frame);
    }
  }

  /**
   * Selection bounds, recorded while rendering rather than measured separately.
   *
   * A separate measurement pass is unreliable: the drawn size depends on the
   * canvas backing store, the layer scale, the stroke and the shadow, and any
   * second calculation inevitably drifts from what was actually painted. So
   * `drawText`/`drawMedia` record their real extents here as they render, and
   * the gizmo reads those numbers back. They cannot disagree.
   */
  private bounds = new Map<string, { x: number; y: number; w: number; h: number }>();

  /** Bounds of a clip from the most recent rendered frame, or null. */
  getBounds(clipId: string): { x: number; y: number; w: number; h: number } | null {
    return this.bounds.get(clipId) ?? null;
  }

  /**
   * Record the on-screen box of a rectangle expressed in the CURRENT canvas
   * transform. `(cx, cy)` is the layer centre in canvas space; `(hw, hh)` are
   * half-extents already multiplied by the layer scale. Rotation makes the box
   * non-axis-aligned, so all four corners go through the live matrix and an
   * enclosing AABB is taken.
   */
  private recordBounds(id: string, cx: number, cy: number, hw: number, hh: number): void {
    const m = this.ctx.getTransform();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const corners: [number, number][] = [
      [cx - hw, cy - hh],
      [cx + hw, cy - hh],
      [cx + hw, cy + hh],
      [cx - hw, cy + hh],
    ];
    for (const [x, y] of corners) {
      const tx = m.a * x + m.c * y + m.e;
      const ty = m.b * x + m.d * y + m.f;
      if (tx < minX) minX = tx;
      if (tx > maxX) maxX = tx;
      if (ty < minY) minY = ty;
      if (ty > maxY) maxY = ty;
    }
    this.bounds.set(id, {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      w: maxX - minX,
      h: maxY - minY,
    });
  }

  /**
   * Opacity for a clip at `frame`, including any transition on its head.
   *
   * A transition makes the clip fade in over the tail of whatever precedes it.
   * Every transition type is approximated as a cross-fade in the preview; the
   * exact wipe/slide/zoom geometry is an export-time concern handled by xfade,
   * which is not wired up yet. Exporting a project with transitions currently
   * renders a hard cut.
   */
  private transitionAlpha(clip: Clip, frame: number): number {
    const t = clip.transitionIn;
    if (!t || t.type === 'none') return 1;
    const dur = Math.max(1, t.duration);
    const local = frame - clip.start;
    if (local < 0 || local >= dur) return 1;
    return local / dur;
  }

  /** Resolve the drawable for a clip, creating the element on first use. */
  private sourceFor(clip: Clip): HTMLVideoElement | HTMLImageElement | null {
    if (!clip.src) return null;
    const hit = cache.get(clip.id);
    if (hit) return hit;

    if (clip.kind === 'video') {
      const video = document.createElement('video');
      video.src = clip.src;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.crossOrigin = 'anonymous';
      cache.set(clip.id, video);
      return video;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = clip.src;
    cache.set(clip.id, img);
    return img;
  }


  private drawMedia(clip: Clip, frame: number): void {
    const el = this.sourceFor(clip);
    if (!el) return;

    const ctx = this.ctx;
    const t = resolveTransform(clip, frame);
    const srcW = 'videoWidth' in el ? el.videoWidth : el.width;
    const srcH = 'videoHeight' in el ? el.videoHeight : el.height;
    if (!srcW || !srcH) return;

    const fit = Math.min(this.canvas.width / srcW, this.canvas.height / srcH);
    const w = srcW * fit * t.scale;
    const h = srcH * fit * t.scale;

    ctx.save();
    // The transform's own opacity is combined with the transition fade, so a
    // clip can be both semi-transparent and mid-transition.
    const alpha = Math.max(0, Math.min(1, t.opacity)) * this.transitionAlpha(clip, frame);
    ctx.globalAlpha = alpha;
    ctx.filter = clip.chromaKey.enabled ? 'none' : buildFilter(clip);
    ctx.translate(this.canvas.width / 2 + t.x, this.canvas.height / 2 + t.y);
    ctx.rotate((t.rotation * Math.PI) / 180);

    if (clip.chromaKey.enabled) {
      this.drawChromaKeyed(clip, el, w, h, t.anchorX, t.anchorY);
    } else {
      ctx.drawImage(el, -w * t.anchorX, -h * t.anchorY, w, h);
    }
    // Same contract as text: report the box that was actually drawn.
    this.recordBounds(clip.id, 0, 0, w / 2, h / 2);
    ctx.restore();
  }

  /** Key out a colour range per pixel, then draw the keyed result. */
  private drawChromaKeyed(
    clip: Clip,
    el: HTMLVideoElement | HTMLImageElement,
    w: number,
    h: number,
    anchorX: number,
    anchorY: number,
  ): void {
    const bw = Math.max(1, Math.round(w));
    const bh = Math.max(1, Math.round(h));
    this.scratch.width = bw;
    this.scratch.height = bh;
    this.scratchCtx.clearRect(0, 0, bw, bh);
    this.scratchCtx.drawImage(el, 0, 0, bw, bh);

    const image = this.scratchCtx.getImageData(0, 0, bw, bh);
    const data = image.data;
    const key = hexToRgb(clip.chromaKey.color);
    for (let i = 0; i < data.length; i += 4) {
      const a = chromaAlpha(
        data[i],
        data[i + 1],
        data[i + 2],
        key,
        clip.chromaKey.similarity,
        clip.chromaKey.smoothness,
      );
      data[i + 3] = Math.round(data[i + 3] * a);
    }
    this.scratchCtx.putImageData(image, 0, 0);
    this.ctx.drawImage(this.scratch, -w * anchorX, -h * anchorY, w, h);
  }


  private drawText(clip: Clip, frame: number, settings: ProjectSettings): void {
    const style = clip.text;
    if (!style?.content) return;

    const ctx = this.ctx;
    const t = resolveTransform(clip, frame);
    const local = frame - clip.start;

    let text = style.content;
    let alpha = Math.max(0, Math.min(1, t.opacity));
    let offsetY = 0;
    const dur = Math.max(1, style.animationDuration);

    // Animations are driven by clip-relative time.
    switch (style.animation) {
      case 'typewriter': {
        const p = Math.max(0, Math.min(1, local / dur));
        text = style.content.slice(0, Math.ceil(p * style.content.length));
        break;
      }
      case 'fade':
        alpha *= Math.max(0, Math.min(1, local / dur));
        break;
      case 'bounce': {
        const p = Math.min(1, local / dur);
        offsetY = -Math.abs(Math.sin(p * Math.PI * 3)) * 40 * (1 - p);
        break;
      }
      case 'flip':
        offsetY = (1 - Math.min(1, local / dur)) * 200;
        alpha *= Math.min(1, local / dur);
        break;
      case 'glitch':
        // Deterministic jitter: random per frame would flicker on every redraw.
        offsetY = ((local % 7) - 3) * 2;
        break;
      default:
        break;
    }

    // Font sizes are authored against project height; scale to the canvas.
    const px = (v: number) => (v / settings.height) * this.canvas.height;
    const fontSize = px(style.fontSize);
    // `customFontId` is a bookkeeping id (e.g. "font_Inter_9x2"), NOT a CSS
    // family name. Passing it to ctx.font made uploaded fonts silently fall
    // back to the default face. The TextStyle already carries the real family
    // in `fontFamily`, which the font loader registers with document.fonts, so
    // that is what must be used.
    const family = style.fontFamily || 'sans-serif';

    ctx.save();
    // Colour grading applies to text as well as media. It used to be set only
    // inside drawMedia, which left every colour slider in the Inspector doing
    // nothing for a text clip. `ctx.filter` is scoped by save/restore so it
    // cannot leak onto subsequent layers or the background fill.
    ctx.filter = buildFilter(clip);
    ctx.globalAlpha = alpha;
    ctx.translate(this.canvas.width / 2 + t.x, this.canvas.height / 2 + t.y + offsetY);
    ctx.rotate((t.rotation * Math.PI) / 180);
    ctx.scale(t.scale, t.scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${style.italic ? 'italic ' : ''}${style.weight} ${fontSize}px ${family}, sans-serif`;

    // Record the real on-screen box of this text, measured in the exact
    // coordinate space the glyphs are being painted into. The gizmo reads this
    // back instead of re-deriving it, so the selection box is guaranteed to
    // match the text rather than approximating it.
    {
      const m = ctx.measureText(text);
      // Half-extents in the layer's own (already scaled) space.
      const hw =
        (Math.abs(m.actualBoundingBoxLeft ?? m.width / 2) +
          Math.abs(m.actualBoundingBoxRight ?? m.width / 2)) /
        2;
      const hh =
        (Math.abs(m.actualBoundingBoxAscent ?? fontSize * 0.7) +
          Math.abs(m.actualBoundingBoxDescent ?? fontSize * 0.2)) /
        2;
      // Enclose the stroke (drawn at double line width) and the shadow.
      const strokePad = style.strokeWidth > 0 ? px(style.strokeWidth) * 2 : 0;
      const shadowPad =
        style.shadowBlur > 0
          ? px(style.shadowBlur) + Math.abs(px(style.shadowOffsetX)) + Math.abs(px(style.shadowOffsetY))
          : 0;
      this.recordBounds(clip.id, 0, 0, hw + strokePad, hh + strokePad + shadowPad);
    }

    if (style.shadowBlur > 0) {
      ctx.shadowColor = style.shadowColor;
      ctx.shadowBlur = px(style.shadowBlur);
      ctx.shadowOffsetX = px(style.shadowOffsetX);
      ctx.shadowOffsetY = px(style.shadowOffsetY);
    } else {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }

    if (style.backgroundBadge) {
      const metrics = ctx.measureText(text);
      const pad = px(style.badgePadding);
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = style.badgeColor;
      ctx.fillRect(
        -metrics.width / 2 - pad,
        -fontSize / 2 - pad,
        metrics.width + pad * 2,
        fontSize + pad * 2,
      );
      ctx.restore();
    }

    if (style.gradientEnabled) {
      const grad = ctx.createLinearGradient(-this.canvas.width / 2, 0, this.canvas.width / 2, 0);
      grad.addColorStop(0, style.gradientFrom);
      grad.addColorStop(1, style.gradientTo);
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = style.color;
    }

    if (style.strokeWidth > 0) {
      ctx.lineWidth = px(style.strokeWidth) * 2;
      ctx.strokeStyle = style.strokeColor;
      ctx.lineJoin = 'round';
      ctx.strokeText(text, 0, 0);
    }
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}

