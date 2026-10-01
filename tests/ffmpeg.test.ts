/**
 * End-to-end check that the filtergraph compiler emits commands real FFmpeg
 * accepts, and that renders have the expected duration, dimensions and stream
 * layout.
 *
 * Each case both asserts on the generated command string (cheap, catches
 * regressions in the compiler) and actually runs it, so a filter that is
 * syntactically plausible but semantically invalid still fails loudly.
 *
 * Requires ffmpeg/ffprobe on PATH. Skips (exit 0) when unavailable.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectState } from '../src/store/useTimelineStore';
import { buildExportArgs, type ExportOptions } from '../src/engine/ffmpegBuilder';
import type { Clip } from '../src/types/timeline';
import {
  DEFAULT_CHROMA,
  DEFAULT_COLOR,
  DEFAULT_MASK,
  DEFAULT_TEXT,
  DEFAULT_TRANSFORM,
} from '../src/types/timeline';

let passed = 0;
let failed = 0;

const check = (name: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL ${name}\n    expected ${e}\n    actual   ${a}`);
  }
};

/** Run ffmpeg, recording a failure with the tail of stderr. */
const run = (args: string[], label: string): boolean => {
  try {
    execFileSync('ffmpeg', args, { stdio: 'pipe' });
    return true;
  } catch (err) {
    failed++;
    console.log(`  FAIL ${label}: ffmpeg rejected the command`);
    const e = err as { stderr?: Buffer };
    console.log('    err:', String(e.stderr ?? err).slice(-800));
    return false;
  }
};

interface Probe {
  streams: { codec_type: string; width?: number; height?: number; duration?: string }[];
  format: { duration: string };
}

const probe = (file: string): Probe =>
  JSON.parse(
    execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,width,height,duration',
      '-show_entries', 'format=duration',
      '-of', 'json',
      file,
    ]).toString(),
  ) as Probe;

const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

if (!hasFfmpeg) {
  console.log('ffmpeg not found on PATH; skipping integration test.');
  process.exit(0);
}

// --- fixtures -------------------------------------------------------------
const dir = tmpdir();
const red = join(dir, 'oc_red.mp4');
const blue = join(dir, 'oc_blue.mp4');
const tone = join(dir, 'oc_tone.m4a');

if (!existsSync(red)) {
  // Video WITH audio, like a normal camera file.
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=2:r=30', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', red], { stdio: 'ignore' });
}
if (!existsSync(blue)) {
  // Video WITHOUT audio, to prove the exporter does not emit a dead [i:a].
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=3:r=30', '-pix_fmt', 'yuv420p', blue], { stdio: 'ignore' });
}
if (!existsSync(tone)) {
  execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-c:a', 'aac', tone], { stdio: 'ignore' });
}

const base = (over: Partial<Clip> & { name: string }): Omit<Clip, 'id'> => ({
  trackId: 'trk_video_1',
  kind: 'video',
  src: red,
  start: 0,
  inPoint: 0,
  duration: 60,
  sourceDuration: 60,
  // `red` carries a sine tone; `blue` is silent. Mirrors what the import probe
  // records, and proves silent clips do not produce a dead audio branch.
  hasAudio: over.src !== blue,
  speed: 1,
  reverse: false,
  volume: 1,
  muted: false,
  pan: 0,
  fadeIn: 0,
  fadeOut: 0,
  transform: { ...DEFAULT_TRANSFORM },
  color: { ...DEFAULT_COLOR },
  chromaKey: { ...DEFAULT_CHROMA },
  mask: { ...DEFAULT_MASK },
  keyframes: {},
  ...over,
});

const project = (clips: Omit<Clip, 'id'>[]): ProjectState => {
  const clips_map: Record<string, Clip> = {};
  clips.forEach((c, i) => {
    clips_map[`c${i}`] = { ...c, id: `c${i}` };
  });
  return {
    tracks: [
      { id: 'trk_video_1', kind: 'video', name: 'V1', muted: false, hidden: false, locked: false, order: 0 },
      { id: 'trk_video_2', kind: 'video', name: 'V2', muted: false, hidden: false, locked: false, order: 1 },
      { id: 'trk_audio_1', kind: 'audio', name: 'A1', muted: false, hidden: false, locked: false, order: 0 },
    ],
    clips: clips_map,
    clipOrder: Object.keys(clips_map),
    settings: { width: 320, height: 240, fps: 30, backgroundColor: '#101010', sampleRate: 48000 },
  };
};

const opts = (outputPath: string): ExportOptions => ({
  encoder: 'h264',
  crf: 30,
  preset: 'ultrafast',
  outputPath,
});

const scriptOf = (p: ProjectState, out: string): string =>
  buildExportArgs(p, opts(out)).join(' ');
console.log('ffmpeg integration:');

// --- 1. two sequential clips on one track --------------------------------
{
  const out = join(dir, 'oc_t1.mp4');
  const p = project([
    base({ name: 'a', src: red, start: 0, duration: 60 }),
    base({ name: 'b', src: blue, start: 60, duration: 90 }),
  ]);
  if (run(buildExportArgs(p, opts(out)), 'sequential clips')) {
    const r = probe(out);
    check('t1 dimensions', [r.streams[0].width, r.streams[0].height], [320, 240]);
    check('t1 duration', Number(r.format.duration).toFixed(2), '5.00');
    rmSync(out, { force: true });
  }
}

// --- 2. audio is actually rendered and mixed -----------------------------
{
  const out = join(dir, 'oc_t2.mp4');
  const p = project([
    base({ name: 'v', src: red, duration: 60, muted: true }),
    base({ name: 'music', kind: 'audio', src: tone, trackId: 'trk_audio_1', duration: 150 }),
  ]);
  if (run(buildExportArgs(p, opts(out)), 'audio mix')) {
    const r = probe(out);
    const audio = r.streams.find((s) => s.codec_type === 'audio');
    check('t2 has an audio stream', Boolean(audio), true);
    check('t2 audio duration', Number(audio?.duration ?? 0).toFixed(1), '5.0');
    rmSync(out, { force: true });
  }
}

// --- 3. speed halves the rendered duration -------------------------------
{
  const out = join(dir, 'oc_t3.mp4');
  // 2s of source at 2x occupies 1s on the timeline.
  const p = project([base({ name: 'fast', src: red, duration: 30, sourceDuration: 60, speed: 2 })]);
  if (run(buildExportArgs(p, opts(out)), '2x speed')) {
    const r = probe(out);
    check('t3 duration at 2x', Number(r.format.duration).toFixed(2), '1.00');
    rmSync(out, { force: true });
  }
}

// --- 4. keyframed transform compiles and renders -------------------------
{
  const out = join(dir, 'oc_t4.mp4');
  const p = project([
    base({
      name: 'anim',
      duration: 60,
      keyframes: {
        x: [
          { id: 'k1', frame: 0, value: -100, easing: 'linear' },
          { id: 'k2', frame: 60, value: 100, easing: 'linear' },
        ],
        opacity: [
          { id: 'k3', frame: 0, value: 0, easing: 'linear' },
          { id: 'k4', frame: 60, value: 1, easing: 'linear' },
        ],
        scale: [
          { id: 'k5', frame: 0, value: 0.5, easing: 'linear' },
          { id: 'k6', frame: 60, value: 1.5, easing: 'linear' },
        ],
      },
    }),
  ]);
  const script = scriptOf(p, out);
  check('animated scale uses eval=frame', script.includes('eval=frame'), true);
  check('keyframed x uses overlay expression', /overlay=x='main_w/.test(script), true);
  check('animated opacity uses geq with T', script.includes("geq=lum='lum(X,Y)':a='"), true);
  if (run(buildExportArgs(p, opts(out)), 'keyframed transform')) rmSync(out, { force: true });
}

// --- 5. static transform, rotation and opacity --------------------------
{
  const out = join(dir, 'oc_t5.mp4');
  const p = project([
    base({
      name: 'xform',
      duration: 30,
      transform: { ...DEFAULT_TRANSFORM, scale: 0.5, rotation: 30, opacity: 0.5, x: 20, y: -10 },
    }),
  ]);
  const script = scriptOf(p, out);
  check('static scale emitted', script.includes('scale=iw*0.5'), true);
  check('rotation emitted', script.includes('rotate=30'), true);
  check('opacity emitted', script.includes('colorchannelmixer=aa=0.5'), true);
  if (run(buildExportArgs(p, opts(out)), 'static transform')) rmSync(out, { force: true });
}

// --- 6. styled text over video -------------------------------------------
{
  const out = join(dir, 'oc_t6.mp4');
  const p = project([
    base({ name: 'bg', src: red, duration: 60 }),
    base({
      name: 'text',
      kind: 'text',
      src: undefined,
      trackId: 'trk_video_2',
      duration: 60,
      muted: true,
      text: {
        ...DEFAULT_TEXT,
        // Apostrophes and colons are the classic drawtext breakers.
        content: "Don't: stop",
        strokeWidth: 3,
        shadowBlur: 4,
        backgroundBadge: true,
      },
    }),
  ]);
  const script = scriptOf(p, out);
  check('text emits drawtext', script.includes('drawtext'), true);
  check('stroke emitted', script.includes('borderw=3'), true);
  check('badge emitted', script.includes('box=1'), true);
  check('apostrophe replaced', script.includes('Don\u2019t'), true);
  check('colon escaped', script.includes('\\:'), true);
  if (run(buildExportArgs(p, opts(out)), 'text render')) rmSync(out, { force: true });
}
// --- 7. every mask shape compiles and renders ----------------------------
for (const shape of ['rectangle', 'circle', 'star', 'linear-split'] as const) {
  const out = join(dir, `oc_t7_${shape}.mp4`);
  const p = project([
    base({
      name: 'masked',
      duration: 30,
      mask: { ...DEFAULT_MASK, enabled: true, type: shape, width: 0.5, height: 0.5, feather: 0.2 },
    }),
  ]);
  if (run(buildExportArgs(p, opts(out)), `mask ${shape}`)) rmSync(out, { force: true });
}

// --- 7b. inverted mask ----------------------------------------------------
{
  const out = join(dir, 'oc_t7b.mp4');
  const p = project([
    base({
      name: 'inv',
      duration: 30,
      mask: { ...DEFAULT_MASK, enabled: true, type: 'rectangle', width: 0.5, height: 0.5, inverted: true },
    }),
  ]);
  check('inverted mask negates', scriptOf(p, out).includes('negate'), true);
  if (run(buildExportArgs(p, opts(out)), 'inverted mask')) rmSync(out, { force: true });
}

// --- 8. chroma key -------------------------------------------------------
{
  const out = join(dir, 'oc_t8.mp4');
  const p = project([
    base({
      name: 'keyed',
      duration: 30,
      chromaKey: { ...DEFAULT_CHROMA, enabled: true, color: '#ff0000' },
    }),
  ]);
  check('chroma key emitted', scriptOf(p, out).includes('chromakey=color=0xff0000'), true);
  if (run(buildExportArgs(p, opts(out)), 'chroma key')) rmSync(out, { force: true });
}

// --- 9. full colour grade -----------------------------------------------
{
  const out = join(dir, 'oc_t9.mp4');
  const p = project([
    base({
      name: 'graded',
      duration: 30,
      color: {
        exposure: 0.2,
        brightness: 0.1,
        contrast: 0.3,
        saturation: 1.4,
        temperature: 500,
        tint: 0.1,
        highlights: 0.2,
        shadows: -0.2,
        vignette: 0.5,
      },
    }),
  ]);
  const script = scriptOf(p, out);
  check('contrast mapped around 1.0', script.includes('eq=contrast=1.3'), true);
  check('saturation emitted', script.includes('eq=saturation=1.4'), true);
  check('temperature emitted', script.includes('colortemperature'), true);
  check('vignette emitted', script.includes('vignette='), true);
  if (run(buildExportArgs(p, opts(out)), 'colour grade')) rmSync(out, { force: true });
}

// --- 10. audio effects: reverse, speed, pan, gain, fades ------------------
{
  const out = join(dir, 'oc_t10.mp4');
  const p = project([
    base({
      name: 'audiofx',
      src: tone,
      kind: 'audio',
      trackId: 'trk_audio_1',
      duration: 60,
      volume: 0.5,
      pan: 0.5,
      fadeIn: 10,
      fadeOut: 10,
      reverse: true,
      speed: 2,
    }),
  ]);
  const script = scriptOf(p, out);
  check('atempo emitted for 2x', script.includes('atempo=2'), true);
  check('areverse emitted', script.includes('areverse'), true);
  check('pan emitted', script.includes('pan=stereo'), true);
  check('volume emitted', script.includes('volume=0.5'), true);
  check('afade emitted', script.includes('afade=t=in'), true);
  if (run(buildExportArgs(p, opts(out)), 'audio effects')) rmSync(out, { force: true });
}

// --- 10b. extreme speed chains atempo ------------------------------------
{
  const script = scriptOf(
    project([base({ name: 'vfast', src: red, duration: 8, sourceDuration: 60, speed: 8 })]),
    join(dir, 'oc_t10b.mp4'),
  );
  check('8x chains atempo', (script.match(/atempo=2/g) ?? []).length, 3);
}

// --- 11. muted clip contributes no audio ---------------------------------
{
  const out = join(dir, 'oc_t11.mp4');
  const p = project([
    base({ name: 'muted', src: tone, kind: 'audio', trackId: 'trk_audio_1', duration: 60, muted: true }),
  ]);
  check('muted clip omits amix', scriptOf(p, out).includes('amix='), false);
  if (run(buildExportArgs(p, opts(out)), 'muted audio')) rmSync(out, { force: true });
}

// --- 11b. muted track silences its clips ---------------------------------
{
  const p = project([base({ name: 'a', kind: 'audio', src: tone, trackId: 'trk_audio_1', duration: 60 })]);
  p.tracks = p.tracks.map((t) => (t.id === 'trk_audio_1' ? { ...t, muted: true } : t));
  check('muted track omits amix', scriptOf(p, join(dir, 'x.mp4')).includes('amix='), false);
}

// --- 12. an empty project still renders ----------------------------------
{
  const out = join(dir, 'oc_t12.mp4');
  if (run(buildExportArgs(project([]), opts(out)), 'empty project')) {
    const r = probe(out);
    check('t12 dimensions', [r.streams[0].width, r.streams[0].height], [320, 240]);
    rmSync(out, { force: true });
  }
}

// --- 13. gaps between clips show the background --------------------------
{
  const out = join(dir, 'oc_t13.mp4');
  const p = project([
    base({ name: 'a', src: red, start: 0, duration: 30 }),
    // Starts late, leaving a hole between 30 and 60 frames.
    base({ name: 'b', src: blue, start: 60, duration: 30 }),
  ]);
  if (run(buildExportArgs(p, opts(out)), 'gap between clips')) {
    const r = probe(out);
    check('t13 spans both clips', Number(r.format.duration).toFixed(2), '3.00');
    rmSync(out, { force: true });
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
