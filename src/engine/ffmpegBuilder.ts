/**
 * Compiles the project document into an FFmpeg filtergraph.
 *
 * Pure and framework-free so tests can assert the output without spawning a
 * process; the Tauri sidecar only executes the result.
 *
 * Every media-backed clip becomes one `-i` input feeding two branches:
 * a video branch (trim -> speed -> grade -> fit -> transform -> mask) that is
 * composited with `overlay`, and an audio branch (tempo -> gain -> pan ->
 * fades) that is summed with `amix`. Animated properties are compiled into
 * FFmpeg expressions, so export stays a single decode/encode pass.
 */

import type { Clip, Keyframe, ProjectSettings } from '../types/timeline';
import type { ProjectState } from '../store/useTimelineStore';
import { framesToSeconds } from '../types/timeline';
import { isActiveAt } from './keyframeEngine';

export interface ExportOptions {
  /** Encoder target. NVENC/QuickSync require the matching FFmpeg build. */
  encoder: 'h264' | 'h264_nvenc' | 'h264_qsv' | 'h264_videotoolbox';
  crf: number;
  preset: string;
  outputPath: string;
  /** Directory holding uploaded font files, passed as `fontsdir`. */
  fontDir?: string;
  /** Loaded font id -> absolute font file path. */
  fontFiles?: Record<string, string>;
}

/** `#rrggbb` to the `0xRRGGBB` form FFmpeg colour options expect. */
const ffmpegColor = (hex: string): string => `0x${hex.replace('#', '').padEnd(6, '0')}`;

/**
 * Escape a path for use INSIDE a filtergraph option value, e.g. drawtext's
 * `fontfile`. A path passed as a plain argv element must stay verbatim or the
 * Windows drive-letter colon breaks the argument.
 */
const filterPath = (p: string): string =>
  p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

/** Format a number compactly, guarding against NaN from empty expressions. */
const num = (v: number, digits = 4): string =>
  Number.isFinite(v) ? Number(v.toFixed(digits)).toString() : '0';

/**
 * Compile keyframes into a piecewise-linear FFmpeg expression.
 *
 * The evaluator has no array type, so interpolation is emitted as a nested
 * `if(lt(t,...))` chain built from the last pair backwards. Returns `null`
 * when the property is not animated so callers emit a plain constant instead
 * of paying for per-frame evaluation.
 *
 * `tOffset` shifts the expression's notion of time, because keyframes are
 * stored clip-relative while `overlay` evaluates against the base stream's
 * clock. `tVar` selects the variable name for the surrounding filter: `overlay`
 * uses `t`, whereas `geq` exposes time as `T`.
 */
const keyframeExpr = (
  keyframes: Keyframe[] | undefined,
  fps: number,
  tOffset = 0,
  tVar = 't',
): string | null => {
  if (!keyframes || keyframes.length === 0) return null;
  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);
  if (sorted.length === 1) return num(sorted[0].value);

  const t = tOffset === 0 ? tVar : `(${tVar}-${num(tOffset, 6)})`;

  let expr = num(sorted[sorted.length - 1].value);
  for (let i = sorted.length - 2; i >= 0; i--) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const t0 = framesToSeconds(a.frame, fps);
    const t1 = framesToSeconds(b.frame, fps);
    const span = Math.max(t1 - t0, 1e-6);
    const ramp =
      `${num(a.value)}+(${num(b.value)}-${num(a.value)})*` +
      `((${t})-${num(t0, 6)})/${num(span, 6)}`;
    expr = `if(lt(${t},${num(t1, 6)}),${ramp},${expr})`;
  }
  return expr;
};

/** Animated values for a clip, each a constant or an expression string. */
interface Anim {
  x: number | string;
  y: number | string;
  scale: number | string;
  rotation: number | string;
  opacity: number | string;
}

/**
 * Resolve animated properties. `opacityVar` selects the time variable used for
 * opacity, which must be `T` when the expression is destined for `geq`.
 */
const animated = (c: Clip, fps: number, tOffset: number, opacityVar = 't'): Anim => ({
  x: keyframeExpr(c.keyframes.x, fps, tOffset) ?? c.transform.x,
  y: keyframeExpr(c.keyframes.y, fps, tOffset) ?? c.transform.y,
  scale: keyframeExpr(c.keyframes.scale, fps, tOffset) ?? c.transform.scale,
  rotation: keyframeExpr(c.keyframes.rotation, fps, tOffset) ?? c.transform.rotation,
  opacity: keyframeExpr(c.keyframes.opacity, fps, tOffset, opacityVar) ?? c.transform.opacity,
});

/** Total timeline length in frames. */
export const projectDurationFrames = (project: ProjectState): number =>
  project.clipOrder.reduce((max, id) => {
    const c = project.clips[id];
    return c ? Math.max(max, c.start + c.duration) : max;
  }, 0);

/** Source frames a clip consumes, accounting for speed. */
const sourceFramesFor = (c: Clip): number => Math.max(1, Math.round(c.duration * c.speed));

/** Clips that carry a video stream needing compositing. */
const isVisual = (c: Clip): boolean =>
  Boolean(c.src) && (c.kind === 'video' || c.kind === 'image' || c.kind === 'sticker');

/** Clips that carry an audio stream. */
const hasAudio = (c: Clip): boolean =>
  Boolean(c.src) &&
  (c.kind === 'audio' || c.kind === 'video') &&
  // A file probed without an audio track must not be referenced as `[i:a]`.
  c.hasAudio !== false;

const encoderArgs = (o: ExportOptions): string[] => {
  switch (o.encoder) {
    case 'h264':
      return ['-c:v', 'libx264', '-crf', String(o.crf), '-preset', o.preset];
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-cq', String(o.crf), '-preset', 'p5'];
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-global_quality', String(o.crf)];
    default:
      // VideoToolbox has no CRF; map it onto its own quality scale.
      return ['-c:v', 'h264_videotoolbox', '-q:v', String(Math.max(1, Math.round(o.crf / 3)))];
  }
};
/**
 * Colour grading and chroma keying.
 *
 * Store convention: brightness and contrast are additive offsets around 0,
 * while FFmpeg's `eq` wants contrast as a multiplier around 1.0, hence `1 +`.
 */
const gradeChain = (c: Clip): string[] => {
  const parts: string[] = [];
  const { color, chromaKey } = c;

  // Exposure and brightness are both additive luminance offsets, so fold them
  // into a single eq pass rather than stacking two filters.
  const brightness = color.brightness + color.exposure / 2;
  if (brightness !== 0) parts.push(`eq=brightness=${num(brightness)}`);
  if (color.contrast !== 0) parts.push(`eq=contrast=${num(1 + color.contrast)}`);
  if (color.saturation !== 1) parts.push(`eq=saturation=${num(color.saturation)}`);
  if (color.temperature !== 0) {
    // colortemperature accepts 1000..40000 Kelvin, and the filter takes
    // exactly one positional argument, so the option must be named and the
    // store's normalised offset clamped into range.
    const kelvin = Math.min(40000, Math.max(1000, 6500 + color.temperature * 100));
    parts.push(`colortemperature=temperature=${Math.round(kelvin)}`);
  }
  if (color.tint !== 0) {
    parts.push(`colorbalance=rs=${num(color.tint)}:gs=0:bs=${num(-color.tint)}`);
  }
  if (color.shadows !== 0) {
    // Deepening shadows means raising the black point. colorlevels clamps its
    // input black point to -1..1, so the value must be clamped too or the
    // filter rejects the option ("Result too large").
    const s = Math.min(1, Math.abs(color.shadows) / 4);
    parts.push(`colorlevels=rimin=${num(-s)}:gimin=${num(-s)}:bimin=${num(-s)}`);
  }
  if (color.highlights !== 0) {
    // Lifting highlights cannot be done with colorlevels (its white point only
    // goes down), so a gamma curve below 1 is used to brighten the top end.
    const lift = Math.min(1, Math.abs(color.highlights) / 4);
    parts.push(`eq=gamma=${num(1 - lift * 0.5)}`);
  }
  if (color.vignette > 0) parts.push(`vignette=angle=PI/${num(4 + color.vignette * 4)}`);

  // Chroma keying needs an alpha-carrying format, otherwise the keyed pixels
  // come out black instead of transparent.
  if (chromaKey.enabled) {
    parts.push('format=yuva420p');
    // chromakey takes (color, similarity, blend) positionally; a fourth
    // positional argument would be parsed as the boolean `yuv` option and
    // rejected. Options are therefore named explicitly.
    parts.push(
      `chromakey=color=${ffmpegColor(chromaKey.color)}:` +
        `similarity=${num(chromaKey.similarity)}:` +
        `blend=${num(chromaKey.smoothness)}`,
    );
  }
  return parts;
};

/**
 * Alpha channel for a mask, as a filter chain run over a generated grey canvas
 * at project size. Cheaper and more portable than a geq pixel loop.
 */
const maskChain = (c: Clip, settings: ProjectSettings): string[] => {
  const { mask } = c;
  if (!mask.enabled) return [];

  const x = Math.round(mask.x * settings.width);
  const y = Math.round(mask.y * settings.height);
  const w = Math.max(1, Math.round(mask.width * settings.width));
  const h = Math.max(1, Math.round(mask.height * settings.height));

  // Feather is normalised 0..1 in the store; mapped onto a blur radius.
  const feather = Math.round(mask.feather * 60);
  const blur = feather > 0 ? [`gblur=sigma=${num(feather / 10)}`] : [];
  const invert = mask.inverted ? ['negate'] : [];

  switch (mask.type) {
    case 'circle': {
      const cx = num(x + w / 2);
      const cy = num(y + h / 2);
      const r = num(Math.min(w, h) / 2);
      return [`geq=lum='if(lte(hypot(X-${cx},Y-${cy}),${r}),255,0)'`, ...blur, ...invert];
    }
    case 'star': {
      // Diamond inscribed in the rect. A true five-point star needs a polygon
      // test that geq cannot express compactly.
      const cx = num(x + w / 2);
      const cy = num(y + h / 2);
      return [
        `geq=lum='if(lt(abs(X-${cx})/${num(w / 2)}+abs(Y-${cy})/${num(h / 2)},1),255,0)'`,
        ...blur,
        ...invert,
      ];
    }
    case 'linear-split':
      return [`geq=lum='if(lt(X,${num(x + w)}),255,0)'`, ...blur, ...invert];
    default:
      return [
        `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=white:t=fill`,
        ...blur,
        ...invert,
      ];
  }
};
/**
 * Per-clip video chain, ending at `[v{i}]`.
 *
 * Timeline placement is deliberately NOT done with `setpts` here: shifting PTS
 * would desync the clip from its audio branch and break the animated overlay
 * expressions, which are evaluated against the base stream's clock. Instead the
 * clip stays zero-based and `overlay` positions and time-enables it.
 */
const videoChain = (c: Clip, index: number, settings: ProjectSettings, fps: number): string[] => {
  const startSec = framesToSeconds(c.start, fps);
  // Opacity is destined for geq below, which names its time variable T.
  const anim = animated(c, fps, startSec, 'T');
  const srcFrames = sourceFramesFor(c);
  const inSec = framesToSeconds(c.inPoint, fps);
  const outSec = framesToSeconds(c.inPoint + srcFrames, fps);
  const durSec = framesToSeconds(c.duration, fps);

  const out: string[] = [];
  let label = `${index}:v`;
  const push = (filters: string, next: string) => {
    out.push(`[${label}]${filters}[${next}]`);
    label = next;
  };

  // --- source range, reversal and speed ----------------------------------
  // `reverse` buffers the whole range in RAM, so it must precede trim or it
  // reverses frames that are about to be discarded.
  if (c.reverse) {
    push(`reverse,trim=start=${num(inSec)}:end=${num(outSec)},setpts=PTS-STARTPTS`, `r${index}`);
  } else if (Math.abs(c.speed - 1) > 1e-3) {
    // Dividing PTS by the speed factor plays the trimmed range faster.
    push(
      `trim=start=${num(inSec)}:end=${num(outSec)},setpts=(PTS-STARTPTS)/${num(c.speed)}`,
      `r${index}`,
    );
  } else {
    push(`trim=start=${num(inSec)}:end=${num(outSec)},setpts=PTS-STARTPTS`, `r${index}`);
  }

  // --- grading / keying ---------------------------------------------------
  const grade = gradeChain(c);
  if (grade.length) push(grade.join(','), `g${index}`);

  // --- fit to canvas ------------------------------------------------------
  push(
    `scale=${settings.width}:${settings.height}:force_original_aspect_ratio=decrease,` +
      `pad=${settings.width}:${settings.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`,
    `f${index}`,
  );

  // --- transform ----------------------------------------------------------
  // Animated properties become per-frame expressions; constants use the plain
  // static form, which is faster and reads better in a saved script.
  const scale = anim.scale;
  if (typeof scale === 'string') {
    push(`scale=w='iw*${scale}':h=-1:eval=frame,setsar=1`, `sc${index}`);
  } else if (Math.abs(scale - 1) > 1e-3) {
    push(`scale=iw*${num(scale)}:-1,setsar=1`, `sc${index}`);
  }

  const rot = anim.rotation;
  // `c=none` is rejected by rotate, so transparency is requested as black with
  // zero alpha. `rotw`/`roth` need the angle passed explicitly: they resolve
  // their argument as an expression, and referencing the filter's own `a`
  // variable here fails with "invalid expression 'roth(a)'".
  const rotOpts = (angle: string): string =>
    `ow=rotw(${angle}):oh=roth(${angle}):c=black@0.0`;
  if (typeof rot === 'string') {
    const angle = `${rot}*PI/180`;
    push(`rotate=a='${angle}':${rotOpts(angle)}`, `rt${index}`);
  } else if (Math.abs(rot) > 1e-3) {
    const angle = `${num(rot)}*PI/180`;
    push(`rotate=${angle}:${rotOpts(angle)}`, `rt${index}`);
  }

  const op = anim.opacity;
  if (typeof op === 'string') {
    // colorchannelmixer's expression evaluator has no time variable, so an
    // animated fade has to go through geq, which exposes T (seconds). The
    // luma expression is passed through unchanged.
    push(`format=rgba,geq=lum='lum(X,Y)':a='${op}'`, `op${index}`);
  } else if (Math.abs(op - 1) > 1e-3) {
    push(`format=rgba,colorchannelmixer=aa=${num(op)}`, `op${index}`);
  }

  // --- mask ---------------------------------------------------------------
  const mask = maskChain(c, settings);
  if (mask.length) {
    // Generate the mask at project size, then merge its luminance into alpha.
    out.push(
      `color=c=black:s=${settings.width}x${settings.height}:r=1,format=gray,` +
        `${mask.join(',')}[mk${index}]`,
    );
    push('format=rgba', `fm${index}`);
    // A distinct label is essential: emitting `v{index}` here as well as at
    // the end would define the same output label twice, which makes FFmpeg
    // reject the entire graph.
    out.push(`[${label}][mk${index}]alphamerge[am${index}]`);
    label = `am${index}`;
  }

  // --- timing -------------------------------------------------------------
  // Normalise frame rate after speed scaling, clamp to the clip's real
  // duration, then apply its fades.
  const tail = [`fps=${fps}`, `trim=duration=${num(durSec)}`, 'setsar=1'];
  const fadeInSec = framesToSeconds(c.fadeIn || 0, fps);
  const fadeOutSec = framesToSeconds(c.fadeOut || 0, fps);
  if (fadeInSec > 0) tail.push(`fade=t=in:st=0:d=${num(fadeInSec)}`);
  if (fadeOutSec > 0) {
    tail.push(
      `fade=t=out:st=${num(Math.max(0, durSec - fadeOutSec))}:d=${num(fadeOutSec)}`,
    );
  }
  push(tail.join(','), `v${index}`);

  return out;
};
/**
 * atempo only accepts 0.5..2.0, so extreme speeds chain factors
 * (8x => 2 * 2 * 2). Pitch correction stays on, which is what a speed change
 * without pitch shift should do.
 */
const atempoChain = (speed: number): string[] => {
  const stages: string[] = [];
  let remaining = speed;
  if (!Number.isFinite(remaining) || remaining <= 0) return stages;

  while (remaining > 2.0) {
    stages.push('atempo=2.0');
    remaining /= 2;
  }
  while (remaining < 0.5) {
    stages.push('atempo=0.5');
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 1e-3) stages.push(`atempo=${num(remaining)}`);
  return stages;
};

/**
 * Per-clip audio chain, ending at `[a{i}]`.
 *
 * Returns `null` when the clip contributes no audio (muted, or its track is
 * muted) so the caller can skip it. The branch is delayed onto the timeline
 * and padded to a uniform length so every branch is comparable before mixing.
 */
const audioChain = (
  c: Clip,
  index: number,
  fps: number,
  trackMuted: boolean,
): string[] | null => {
  if (c.muted || trackMuted) return null;

  const startSec = framesToSeconds(c.start, fps);
  const srcFrames = sourceFramesFor(c);
  const inSec = framesToSeconds(c.inPoint, fps);
  const outSec = framesToSeconds(c.inPoint + srcFrames, fps);
  const durSec = framesToSeconds(c.duration, fps);
  const totalSec = durSec + startSec;

  const out: string[] = [];
  let label = `${index}:a`;
  const push = (filters: string, next: string) => {
    out.push(`[${label}]${filters}[${next}]`);
    label = next;
  };

  if (c.reverse) {
    push(`areverse,atrim=start=${num(inSec)}:end=${num(outSec)},asetpts=PTS-STARTPTS`, `r${index}`);
  } else {
    push(`atrim=start=${num(inSec)}:end=${num(outSec)},asetpts=PTS-STARTPTS`, `r${index}`);
  }

  if (Math.abs(c.speed - 1) > 1e-3) {
    const stages = atempoChain(c.speed);
    if (stages.length) push(stages.join(','), `tm${index}`);
  }

  const gain: string[] = [];
  if (c.volume !== 1) gain.push(`volume=${num(c.volume)}`);
  if (c.pan !== 0) {
    // `pan` takes per-channel gains. Sweeping the balance image directly is
    // cheap; an equal-power curve would need a lookup the filter lacks.
    const left = c.pan < 0 ? 1 : 1 - c.pan;
    const right = c.pan > 0 ? 1 : 1 + c.pan;
    gain.push(`pan=stereo|c0=${num(left)}*c0|c1=${num(right)}*c1`);
  }
  if (gain.length) push(gain.join(','), `v${index}`);

  const fadeInSec = framesToSeconds(c.fadeIn || 0, fps);
  const fadeOutSec = framesToSeconds(c.fadeOut || 0, fps);
  if (fadeInSec > 0) push(`afade=t=in:st=0:d=${num(fadeInSec)}`, `fi${index}`);
  if (fadeOutSec > 0) {
    push(`afade=t=out:st=${num(Math.max(0, durSec - fadeOutSec))}:d=${num(fadeOutSec)}`, `fo${index}`);
  }

  out.push(
    `[${label}]adelay=${Math.round(startSec * 1000)}:all=1,` +
      `apad=whole_dur=${num(totalSec)},atrim=duration=${num(totalSec)},` +
      `aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a${index}]`,
  );
  return out;
};
/**
 * Escape text for a drawtext option value.
 *
 * Backslash, colon and percent are FFmpeg's own metacharacters inside an option
 * value, and a literal single quote would close the value early. Apostrophes
 * become a typographic one so ordinary text ("don't") still renders.
 */
const escapeDrawText = (s: string): string =>
  s
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, '\u2019')
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    // Newlines become drawtext's line separator inside one filter.
    .replace(/\r?\n/g, '\\n');

/**
 * Resolve the font file for a text clip.
 *
 * An explicit `fontfile` is used whenever possible. Some FFmpeg builds (notably
 * the Windows static builds) ship without a fontconfig configuration, which
 * makes bare family-name lookup fail with "Cannot load default config file", so
 * a concrete file path is required for text to render at all. Common families
 * are mapped to well-known system files as a fallback.
 */
const SYSTEM_FONT_FILES: Record<string, string> = {
  inter: 'C:/Windows/Fonts/arial.ttf',
  arial: 'C:/Windows/Fonts/arial.ttf',
  helvetica: 'C:/Windows/Fonts/arial.ttf',
  verdana: 'C:/Windows/Fonts/verdana.ttf',
  georgia: 'C:/Windows/Fonts/georgia.ttf',
  'times new roman': 'C:/Windows/Fonts/times.ttf',
  courier: 'C:/Windows/Fonts/cour.ttf',
  'courier new': 'C:/Windows/Fonts/cour.ttf',
  impact: 'C:/Windows/Fonts/impact.ttf',
};

/** Last-resort font used when nothing else resolves. */
const FALLBACK_FONT = 'C:/Windows/Fonts/arial.ttf';

const fontForClip = (clip: Clip, options: ExportOptions): string => {
  const style = clip.text;
  const resolve = (p: string): string => filterPath(p);
  if (!style) return resolve(FALLBACK_FONT);

  // An uploaded font always wins: this is what makes custom fonts export.
  if (style.customFontId && options.fontFiles) {
    const file = options.fontFiles[style.customFontId];
    if (file) return resolve(file);
  }
  const system = SYSTEM_FONT_FILES[style.fontFamily.trim().toLowerCase()];
  // Escaping is mandatory here, not just for custom fonts: the value sits
  // inside a filter option, so the drive-letter colon must be escaped or
  // drawtext fails to parse the whole filtergraph.
  return resolve(system ?? FALLBACK_FONT);
};

/**
 * drawtext chain for one text clip, labelled `[t{id}]`.
 *
 * Emits only the subset of TextStyle that drawtext can express. Gradient
 * fills, glow blur and the preset text animations have no drawtext equivalent
 * and are ignored rather than approximated incorrectly.
 */
const textChain = (
  clip: Clip,
  label: string,
  settings: ProjectSettings,
  fps: number,
  options: ExportOptions,
): string => {
  const style = clip.text as NonNullable<Clip['text']>;
  const startSec = framesToSeconds(clip.start, fps);
  const endSec = framesToSeconds(clip.start + clip.duration, fps);
  const anim = animated(clip, fps, startSec);

  // Scale type from the 1080p design reference onto the real canvas height.
  const size = Math.max(1, Math.round((style.fontSize * settings.height) / 1920));
  const parts: string[] = [];

  // Position: the store's x/y are offsets from the canvas centre, and
  // drawtext's y is the baseline, so shift up by roughly one text height.
  // Alignment picks the horizontal origin; vertical placement stays centred
  // because TextStyle only exposes horizontal alignment.
  const cx = settings.width / 2 + Number(anim.x);
  const cy = settings.height / 2 + Number(anim.y) - size * 0.5;
  const x =
    style.align === 'left'
      ? 'w*0.05'
      : style.align === 'right'
        ? 'w-text_w-w*0.05'
        : num(cx);
  const y = num(cy);

  const font = fontForClip(clip, options);
  parts.push(`text='${escapeDrawText(style.content)}'`);
  parts.push(`fontsize=${size}`);
  parts.push(`fontcolor=${style.color}`);
  parts.push(`x=${x}`);
  parts.push(`y=${y}`);
  parts.push(`fontfile='${font}'`);

  if (style.strokeWidth > 0) {
    parts.push(`borderw=${Math.round(style.strokeWidth)}`);
    parts.push(`bordercolor=${style.strokeColor}`);
  }
  if (style.shadowBlur > 0 || style.shadowOffsetX !== 0 || style.shadowOffsetY !== 0) {
    parts.push(`shadowcolor=${style.shadowColor}@0.6`);
    parts.push(`shadowx=${Math.round(style.shadowOffsetX)}`);
    parts.push(`shadowy=${Math.round(style.shadowOffsetY)}`);
  }
  if (style.backgroundBadge) {
    parts.push('box=1');
    parts.push(`boxcolor=${style.badgeColor}@0.85`);
    parts.push(`boxborderw=${Math.round(style.badgePadding)}`);
  }

  // Only draw across the clip's own window on the timeline.
  parts.push(`enable='between(t,${num(startSec)},${num(endSec)})'`);

  // The output label must match what the caller reads back; `clip.id` is used
  // on both sides so the two can never drift apart.
  const outLabel = `tx${clip.id}`;
  return `[${label}]drawtext=${parts.join(':')}[${outLabel}]`;
};
/**
 * Build the full argument list for `ffmpeg`.
 *
 * Inputs are emitted as: every visual clip first, then audio-only clips. The
 * index arithmetic in the assembly below depends on that ordering.
 */
export const buildExportArgs = (project: ProjectState, options: ExportOptions): string[] => {
  const { settings } = project;
  const fps = settings.fps;
  const total = projectDurationFrames(project);

  const clips = project.clipOrder.map((id) => project.clips[id]).filter(Boolean);
  const visuals = clips.filter(isVisual);
  const audios = clips.filter(hasAudio);
  const texts = clips.filter((c) => c.kind === 'text' && c.text?.content);
  const trackById = new Map(project.tracks.map((t) => [t.id, t]));

  const args: string[] = ['-y'];

  // Images loop so they can be held for the clip's duration rather than
  // decoding a single frame; the trailing -t bounds the input.
  visuals.forEach((c) => {
    if (c.kind === 'image') {
      args.push('-loop', '1', '-t', num(framesToSeconds(c.duration, fps)));
    }
    args.push('-i', c.src as string);
  });
  audios
    .filter((c) => !isVisual(c))
    .forEach((c) => args.push('-i', c.src as string));

  const filters: string[] = [];

  // A solid bed guarantees output for an empty, audio-only or text-only
  // project, and gives overlays something to composite onto.
  const bedDur = Math.max(framesToSeconds(total, fps), 1 / fps);
  filters.push(
    `color=c=${ffmpegColor(settings.backgroundColor)}:s=${settings.width}x${settings.height}:d=${num(bedDur)}[bg]`,
  );

  visuals.forEach((c, i) => filters.push(...videoChain(c, i, settings, fps)));

  // --- composite bottom-up ------------------------------------------------
  let base = 'bg';
  visuals.forEach((c, i) => {
    const next = `ov${i}`;
    const startSec = framesToSeconds(c.start, fps);
    const endSec = framesToSeconds(c.start + c.duration, fps);
    const anim = animated(c, fps, startSec);

    // Constant placement can be precomputed; animated placement must be an
    // expression, and must be centred on the layer's own midpoint.
    const xExpr =
      typeof anim.x === 'string'
        ? `main_w/2-overlay_w/2+(${anim.x})`
        : `main_w/2-overlay_w/2+(${num(anim.x)})`;
    const yExpr =
      typeof anim.y === 'string'
        ? `main_h/2-overlay_h/2+(${anim.y})`
        : `main_h/2-overlay_h/2+(${num(anim.y)})`;

    filters.push(
      `[${base}][v${i}]overlay=x='${xExpr}':y='${yExpr}':` +
        `enable='between(t,${num(startSec)},${num(endSec)})':` +
        // Pass through after the clip ends so lower layers stay visible.
        `eof_action=pass:shortest=0[${next}]`,
    );
    base = next;
  });

  // --- text ---------------------------------------------------------------
  texts.forEach((c) => {
    filters.push(textChain(c, base, settings, fps, options));
    // Read back the label textChain actually emitted.
    base = `tx${c.id}`;
  });

  filters.push(`[${base}]format=yuv420p[vout]`);

  // --- audio --------------------------------------------------------------
  const branches: string[] = [];
  audios.forEach((c) => {
    // Visual clips were numbered first; audio-only clips follow them.
    const vi = visuals.indexOf(c);
    const index = vi >= 0 ? vi : visuals.length + audios.filter((x) => !isVisual(x)).indexOf(c);
    const chain = audioChain(c, index, fps, trackById.get(c.trackId)?.muted ?? false);
    if (!chain) return;
    filters.push(...chain);
    branches.push(`a${index}`);
  });

  if (branches.length > 0) {
    filters.push(
      `${branches.map((l) => `[${l}]`).join('')}amix=inputs=${branches.length}:` +
        // normalize=0 keeps each clip's authored gain; without it amix would
        // divide by the input count and quiet everything.
        `duration=longest:dropout_transition=0:normalize=0,` +
        `alimiter=limit=0.98:level=disabled[aout]`,
    );
  }

  args.push('-filter_complex', filters.join(';'));
  args.push('-map', '[vout]');
  if (branches.length > 0) args.push('-map', '[aout]');

  args.push(...encoderArgs(options));
  if (branches.length > 0) {
    args.push('-c:a', 'aac', '-b:a', '192k', '-ar', String(settings.sampleRate));
  }
  args.push('-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart');

  // Expose uploaded fonts to fontconfig as well as via explicit fontfiles.
  if (options.fontDir) args.push('-fontsdir', options.fontDir);

  // Bound the render to the timeline length so a long input cannot extend it.
  args.push('-t', num(bedDur));
  // Plain argv element: passed verbatim, no escaping (see filterPath).
  args.push(options.outputPath);

  return args;
};

/**
 * Render a project to a human-readable FFmpeg command, for inspecting the
 * compiler's output without running an encode.
 */
export const buildExportScript = (project: ProjectState, options: ExportOptions): string =>
  ['ffmpeg', ...buildExportArgs(project, options)]
    .map((a) => (a.includes(' ') || a.includes(';') ? `"${a}"` : a))
    .join(' ');

/** Clips present in the document that can never render (no source, not text). */
export const findEmptyExport = (project: ProjectState): Clip[] =>
  project.clipOrder
    .map((id) => project.clips[id])
    .filter((c) => c && !c.src && c.kind !== 'text' && c.kind !== 'adjustment');

/** Is any clip active at this frame? */
export const hasRenderableContent = (project: ProjectState, frame: number): boolean =>
  project.clipOrder.some((id) => isActiveAt(project.clips[id], frame));
