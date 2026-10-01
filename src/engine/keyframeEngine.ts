import type { Clip, Easing, Keyframe } from '../types/timeline';
import { applyEasing, lerp } from '../types/timeline';

/**
 * Evaluate an animated property at a clip-relative frame.
 *
 * Returns `fallback` (the clip's static transform value) when the property has
 * no keyframes, which lets callers always treat animation as an override rather
 * than a separate branch.
 */
export const evaluateKeyframes = (
  keyframes: Keyframe[] | undefined,
  frame: number,
  fallback: number,
): number => {
  if (!keyframes || keyframes.length === 0) return fallback;
  if (keyframes.length === 1) return keyframes[0].value;

  // Sorted copy: keyframes are authored in arbitrary order, and the linear
  // scan below depends on chronological ordering.
  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);

  if (frame <= sorted[0].frame) return sorted[0].value;
  const last = sorted[sorted.length - 1];
  if (frame >= last.frame) return last.value;

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (frame >= a.frame && frame <= b.frame) {
      const span = b.frame - a.frame;
      // Guard against zero-length spans from duplicate frames.
      const raw = span === 0 ? 0 : (frame - a.frame) / span;
      const t = applyEasing(raw, a.easing as Easing);
      return lerp(a.value, b.value, t);
    }
  }
  return last.value;
};

/**
 * Resolve every animated transform property for a clip at an absolute
 * timeline frame. Static (non-keyframed) values pass through untouched.
 */
export const resolveTransform = (clip: Clip, absoluteFrame: number) => {
  const local = absoluteFrame - clip.start;
  const t = clip.transform;
  return {
    // Anchors are not animatable, so they pass through from the static value.
    anchorX: t.anchorX,
    anchorY: t.anchorY,
    x: evaluateKeyframes(clip.keyframes.x, local, t.x),
    y: evaluateKeyframes(clip.keyframes.y, local, t.y),
    scale: evaluateKeyframes(clip.keyframes.scale, local, t.scale),
    rotation: evaluateKeyframes(clip.keyframes.rotation, local, t.rotation),
    opacity: evaluateKeyframes(clip.keyframes.opacity, local, t.opacity),
  };
};

/** Does a clip cover this absolute frame? */
export const isActiveAt = (clip: Clip, frame: number): boolean =>
  frame >= clip.start && frame < clip.start + clip.duration;
