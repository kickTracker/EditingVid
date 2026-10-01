/**
 * Correctness tests for the timeline editing operations.
 * Run with: npm run test
 */
import { useTimelineStore, createInitialProject } from '../src/store/useTimelineStore';
import type { Clip } from '../src/types/timeline';
import {
  DEFAULT_CHROMA,
  DEFAULT_COLOR,
  DEFAULT_MASK,
  DEFAULT_TEXT,
  DEFAULT_TRANSFORM,
} from '../src/types/timeline';
import { evaluateKeyframes, isActiveAt } from '../src/engine/keyframeEngine';
import { FILTER_PRESETS, TEXT_PRESETS } from '../src/engine/presets';

let passed = 0;
let failed = 0;

const check = (name: string, actual: unknown, expected: unknown): void => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL ${name}\n    expected ${e}\n    actual   ${a}`);
  }
};

const makeClip = (over: Partial<Clip> = {}): Omit<Clip, 'id'> => ({
  trackId: 'trk_video_1',
  kind: 'video',
  name: 'clip.mp4',
  src: 'blob:test',
  start: 0,
  inPoint: 0,
  duration: 100,
  sourceDuration: 300,
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

const reset = () => useTimelineStore.getState().reset();

// ---------------------------------------------------------------- split
console.log('split:');
{
  reset();
  const id = useTimelineStore.getState().addClip(
    makeClip({ start: 10, duration: 100, sourceDuration: 300 }),
  );
  useTimelineStore.getState().setPlayhead(60);
  useTimelineStore.getState().select([id]);
  useTimelineStore.getState().splitAtPlayhead();

  const s = useTimelineStore.getState();
  check('clip count after split', s.clipOrder.length, 2);

  const left = s.clips[id];
  const rightId = s.clipOrder[1];
  const right = s.clips[rightId];

  check('left duration', left.duration, 50);
  check('left start', left.start, 10);
  check('right start', right.start, 60);
  check('right duration', right.duration, 50);
  // The right half must continue from where the left stopped in the source.
  check('right inPoint advanced', right.inPoint, 50);
  check('no source overlap', left.inPoint + left.duration, right.inPoint);
  check('selection includes new clip', s.selection.includes(rightId), true);
}

// ---------------------------------------------------------------- trim
console.log('trim:');
{
  reset();
  const id = useTimelineStore.getState().addClip(
    makeClip({ start: 10, duration: 100, sourceDuration: 300 }),
  );
  useTimelineStore.getState().trimClip(id, -40, 'end');
  check('tail shortened', useTimelineStore.getState().clips[id].duration, 60);

  // Tail trim must not run past the end of real source material.
  useTimelineStore.getState().trimClip(id, +9999, 'end');
  check('tail clamped to source', useTimelineStore.getState().clips[id].duration, 300);

  // Head trim shifts both start and in-point.
  useTimelineStore.getState().trimClip(id, +30, 'start');
  const c = useTimelineStore.getState().clips[id];
  check('head start shifted', c.start, 40);
  check('head inPoint shifted', c.inPoint, 30);
  check('head duration reduced', c.duration, 270);

  // Head trim must not consume more source than exists.
  useTimelineStore.getState().trimClip(id, -9999, 'start');
  check('head clamped at source', useTimelineStore.getState().clips[id].inPoint, 0);

  // A clip can never become shorter than one frame.
  useTimelineStore.getState().trimClip(id, -9999, 'end');
  check('tail floored at 1 frame', useTimelineStore.getState().clips[id].duration, 1);
}

// ---------------------------------------------------------------- speed
console.log('speed:');
{
  reset();
  const id = useTimelineStore.getState().addClip(
    makeClip({ duration: 100, sourceDuration: 1000 }),
  );
  useTimelineStore.getState().setSpeed(id, 2);
  let c = useTimelineStore.getState().clips[id];
  check('2x halves duration', c.duration, 50);
  check('speed recorded', c.speed, 2);

  // Halving the speed doubles the time the same source material occupies.
  useTimelineStore.getState().setSpeed(id, 0.5);
  c = useTimelineStore.getState().clips[id];
  check('0.5x doubles duration', c.duration, 200);
  check('source coverage preserved', Math.round(c.duration * c.speed), 100);

  // Speed is clamped to the documented 0.1..100 range.
  useTimelineStore.getState().setSpeed(id, 999);
  check('speed clamped high', useTimelineStore.getState().clips[id].speed, 100);
  useTimelineStore.getState().setSpeed(id, 0);
  check('speed clamped low', useTimelineStore.getState().clips[id].speed, 0.1);

  // Text clips have no source to retime.
  const t = useTimelineStore.getState().addClip(
    makeClip({ kind: 'text', duration: 50, sourceDuration: 0, speed: 1 }),
  );
  useTimelineStore.getState().setSpeed(t, 4);
  check('text speed untouched', useTimelineStore.getState().clips[t].speed, 1);
}

// ---------------------------------------------------------------- keyframes
console.log('keyframes:');
{
  const kfs = [
    { id: 'a', frame: 0, value: 0, easing: 'linear' as const },
    { id: 'b', frame: 100, value: 100, easing: 'linear' as const },
  ];
  check('interpolates midpoint', evaluateKeyframes(kfs, 50, -1), 50);
  check('clamps before first', evaluateKeyframes(kfs, -20, -1), 0);
  check('clamps after last', evaluateKeyframes(kfs, 500, -1), 100);
  check('falls back when absent', evaluateKeyframes(undefined, 10, 42), 42);
  check('falls back when empty', evaluateKeyframes([], 10, 42), 42);
  check('single keyframe is constant', evaluateKeyframes([kfs[0]], 999, -1), 0);

  reset();
  const id = useTimelineStore.getState().addClip(makeClip({ start: 10, duration: 100 }));
  check('inactive before start', isActiveAt(useTimelineStore.getState().clips[id], 9), false);
  check('active at start', isActiveAt(useTimelineStore.getState().clips[id], 10), true);
  // End is exclusive: the next clip takes over on this frame.
  check('inactive at end (exclusive)', isActiveAt(useTimelineStore.getState().clips[id], 110), false);
}

// ---------------------------------------------------------------- tracks & deletion
console.log('tracks:');
{
  reset();
  const trackId = useTimelineStore.getState().addTrack('video');
  const a = useTimelineStore.getState().addClip(makeClip({ trackId }));
  const b = useTimelineStore.getState().addClip(makeClip({ trackId, start: 200 }));
  check('track count grew', useTimelineStore.getState().tracks.length, 4);
  check('two clips on new track', Object.keys(useTimelineStore.getState().clips).length, 2);

  // Removing a track must cascade-delete its clips.
  useTimelineStore.getState().removeTrack(trackId);
  const s = useTimelineStore.getState();
  check('clips cascaded', Object.keys(s.clips).length, 0);
  check('order purged', s.clipOrder.length, 0);
  check('track removed', s.tracks.length, 3);
  check('stale ids gone', s.clips[a] === undefined && s.clips[b] === undefined, true);
}


// ---------------------------------------------------------------- snapshot / restore
console.log('document:');
{
  reset();
  const id = useTimelineStore.getState().addClip(makeClip({ duration: 80 }));
  const snap = useTimelineStore.getState().snapshot();
  check('snapshot excludes view state', 'playhead' in snap, false);
  check('snapshot is serializable', JSON.parse(JSON.stringify(snap)).clipOrder.length, 1);

  useTimelineStore.getState().updateClip(id, { duration: 5 });
  check('mutation applied', useTimelineStore.getState().clips[id].duration, 5);

  useTimelineStore.getState().restore(snap);
  check('restore reverts', useTimelineStore.getState().clips[id].duration, 80);

  check('initial project has 3 tracks', createInitialProject().tracks.length, 3);
}

// ---------------------------------------------------------------- keyframe editing
console.log('keyframe editing:');
{
  reset();
  const id = useTimelineStore.getState().addClip(makeClip({ start: 0, duration: 100 }));
  useTimelineStore.getState().addKeyframe(id, 'x', 0, 0);
  useTimelineStore.getState().addKeyframe(id, 'x', 50, 100);
  check('two keyframes added', useTimelineStore.getState().clips[id].keyframes.x?.length, 2);

  // Re-adding at the same frame replaces rather than duplicates.
  useTimelineStore.getState().addKeyframe(id, 'x', 50, 250);
  const list = useTimelineStore.getState().clips[id].keyframes.x;
  check('idempotent at same frame', list?.length, 2);
  check('value replaced', list?.[1].value, 250);

  useTimelineStore.getState().removeKeyframe(id, 'x', list?.[1].id as string);
  check('keyframe removed', useTimelineStore.getState().clips[id].keyframes.x?.length, 1);
}

reset();
// ------------------------------------------------------- automatic tracks
// Tracks are created on demand rather than by an explicit "add track" action,
// which is what lets a drop land anywhere without pre-existing infrastructure.
console.log('automatic tracks:');
{
  reset();
  const s0 = useTimelineStore.getState();
  const before = s0.tracks.length;

  // A range that is free on the existing track must reuse it, not add one.
  const t1 = s0.ensureTrackFor('video', 0, 100, false);
  check('reuses a free track', useTimelineStore.getState().tracks.length, before);
  check('returns existing track id', t1, 'trk_video_1');

  // Occupy that range, then request the same range again. The default project
  // ships with two video tracks, so the first repeat lands on the second one.
  const c1 = useTimelineStore.getState().addClip(makeClip({ start: 0, duration: 100, trackId: t1 }));
  const t2 = useTimelineStore.getState().ensureTrackFor('video', 0, 100, false);
  check('uses the second video track', t2, 'trk_video_2');
  check('no new track yet', useTimelineStore.getState().tracks.length, before);

  // With BOTH video tracks occupied over the same range, a track is created.
  const c2 = useTimelineStore
    .getState()
    .addClip(makeClip({ start: 0, duration: 100, trackId: t2 }));
  const t3 = useTimelineStore.getState().ensureTrackFor('video', 0, 100, false);
  check('creates a track when all occupied', useTimelineStore.getState().tracks.length, before + 1);
  check('new track differs', t3 === t1 || t3 === t2, false);

  // A non-overlapping range reuses the original track again.
  const t4 = useTimelineStore.getState().ensureTrackFor('video', 100, 50, false);
  check('reuses track for later range', t4, t1);

  // Abutting clips share a boundary and must NOT be treated as overlapping.
  const t5 = useTimelineStore.getState().ensureTrackFor('video', 100, 10, false);
  check('abutting clips do not overlap', t5, t1);

  // preferTop picks the highest track, which is how text layers above footage.
  reset();
  const top = useTimelineStore.getState().ensureTrackFor('video', 0, 10, true);
  check('preferTop returns a video track', top.startsWith('trk_video'), true);

  // Audio placement is independent of video tracks.
  reset();
  const at = useTimelineStore.getState().ensureTrackFor('audio', 0, 100, false);
  check('audio request lands on an audio track', at.startsWith('trk_audio'), true);
  void c1;
}

// ------------------------------------------------------------ text styling
// Text and its effects are edited through the Inspector without moving the
// playhead, which is exactly the case the preview repaint guard used to drop.
console.log('text styling:');
{
  reset();
  const id = useTimelineStore.getState().addClip(
    makeClip({
      kind: 'text',
      name: 'title',
      src: undefined,
      start: 0,
      duration: 90,
      text: { ...DEFAULT_TEXT, content: 'Hello' },
      // Text carries no audio; addTextAtPlayhead sets this too.
      muted: true,
    }),
  );
  const s0 = useTimelineStore.getState();

  check('text clip added', s0.clips[id].kind, 'text');
  check('text has no source', s0.clips[id].src, undefined);
  check('text is marked silent', s0.clips[id].muted, true);

  // Every style field must round-trip through setText, because these are the
  // values the compositor and the FFmpeg exporter both read.
  useTimelineStore.getState().setText(id, { color: '#ff0000' });
  useTimelineStore.getState().setText(id, { strokeWidth: 6, strokeColor: '#00ff00' });
  useTimelineStore.getState().setText(id, { shadowBlur: 12, shadowColor: '#0000ff' });
  useTimelineStore.getState().setText(id, { gradientEnabled: true, gradientFrom: '#111111', gradientTo: '#eeeeee' });
  useTimelineStore.getState().setText(id, { backgroundBadge: true, badgeColor: '#123456' });
  useTimelineStore.getState().setText(id, { animation: 'bounce', animationDuration: 24 });
  useTimelineStore.getState().setText(id, { fontFamily: 'Georgia', fontSize: 120, weight: 300 });

  const t = useTimelineStore.getState().clips[id].text;
  check('text content preserved', t?.content, 'Hello');
  check('text color stored', t?.color, '#ff0000');
  check('text stroke stored', t?.strokeWidth, 6);
  check('text stroke color stored', t?.strokeColor, '#00ff00');
  check('text shadow stored', t?.shadowBlur, 12);
  check('gradient flag stored', t?.gradientEnabled, true);
  check('gradient stops stored', [t?.gradientFrom, t?.gradientTo], ['#111111', '#eeeeee']);
  check('badge stored', t?.backgroundBadge, true);
  check('badge color stored', t?.badgeColor, '#123456');
  check('animation stored', t?.animation, 'bounce');
  check('animation duration stored', t?.animationDuration, 24);
  check('font family stored', t?.fontFamily, 'Georgia');
  check('font size stored', t?.fontSize, 120);

  // Editing content renames the clip so the timeline label stays truthful.
  useTimelineStore.getState().setText(id, { content: 'Updated' });
  check('clip renamed with content', useTimelineStore.getState().clips[id].name, 'Updated');

  // setText must not leak onto clips that have no text style at all.
  const videoId = useTimelineStore.getState().addClip(makeClip({ start: 500 }));
  useTimelineStore.getState().setText(videoId, { color: '#123123' });
  check('setText ignores non-text clips', useTimelineStore.getState().clips[videoId].text, undefined);

  // A custom font must record BOTH the id and the real family name: the
  // compositor renders with fontFamily, and the exporter resolves fontfile
  // from customFontId.
  useTimelineStore.getState().setText(id, { customFontId: 'font_Inter_9x2', fontFamily: 'Inter' });
  const withFont = useTimelineStore.getState().clips[id].text;
  check('custom font id stored', withFont?.customFontId, 'font_Inter_9x2');
  check('custom font family stored', withFont?.fontFamily, 'Inter');
}

// ---------------------------------------------------------------- canvas
// Canvas size drives the preview, the compositor and the export filtergraph,
// so it is validated here rather than only in the UI.
console.log('canvas settings:');
{
  reset();
  check('default canvas', useTimelineStore.getState().settings.width, 1080);

  // Even dimensions are mandatory for H.264; an odd size fails at encode.
  useTimelineStore.getState().setAspectRatio(1921, 1081);
  check('rounds width to even', useTimelineStore.getState().settings.width, 1920);
  check('rounds height to even', useTimelineStore.getState().settings.height, 1080);

  useTimelineStore.getState().setAspectRatio(1080, 1920);
  useTimelineStore.getState().setAspectRatio(2560, 1080);
  check('applies landscape preset', useTimelineStore.getState().settings.width, 2560);

  // The first imported media adopts its own aspect ratio...
  reset();
  useTimelineStore.getState().adoptAspectFromMedia(1920, 1080);
  check('adopts media aspect', [useTimelineStore.getState().settings.width, useTimelineStore.getState().settings.height], [1920, 1080]);

  // ...but only the first: a later import must never resize the project
  // underneath a project the user is already editing.
  useTimelineStore.getState().addClip(makeClip({ start: 0 }));
  useTimelineStore.getState().adoptAspectFromMedia(1080, 1920);
  check('ignores later media', [useTimelineStore.getState().settings.width, useTimelineStore.getState().settings.height], [1920, 1080]);

  // Arbitrary patches still work for non-geometry settings.
  useTimelineStore.getState().setSettings({ fps: 60 });
  check('setSettings patches fps', useTimelineStore.getState().settings.fps, 60);
  check('setSettings keeps size', useTimelineStore.getState().settings.width, 1920);
}

// ------------------------------------------------- ripple delete & snapping
console.log('ripple delete:');
{
  reset();
  const s = useTimelineStore.getState();
  const a = s.addClip(makeClip({ start: 0, duration: 50, trackId: 'trk_video_1' }));
  const b = s.addClip(makeClip({ start: 50, duration: 50, trackId: 'trk_video_1' }));
  const c = s.addClip(makeClip({ start: 100, duration: 50, trackId: 'trk_video_1' }));

  // With ripple off, deleting leaves a hole.
  useTimelineStore.getState().removeClips([b]);
  let st = useTimelineStore.getState();
  check('ripple off leaves gap', st.clips[c].start, 100);
  check('ripple off keeps count', st.clipOrder.length, 2);

  // Turning it on and deleting the same clip must close the gap.
  reset();
  useTimelineStore.getState().addClip(makeClip({ start: 0, duration: 50, trackId: 'trk_video_1' }));
  const bb = useTimelineStore.getState().addClip(makeClip({ start: 50, duration: 50, trackId: 'trk_video_1' }));
  const cc = useTimelineStore.getState().addClip(makeClip({ start: 100, duration: 50, trackId: 'trk_video_1' }));
  useTimelineStore.getState().toggleRippleDelete();
  check('ripple toggled on', useTimelineStore.getState().rippleDelete, true);
  useTimelineStore.getState().removeClips([bb]);
  st = useTimelineStore.getState();
  check('ripple closes the gap', st.clips[cc].start, 50);

  // Clips BEFORE the removed one must not move.
  reset();
  const first = useTimelineStore.getState().addClip(makeClip({ start: 0, duration: 30, trackId: 'trk_video_1' }));
  const mid = useTimelineStore.getState().addClip(makeClip({ start: 30, duration: 30, trackId: 'trk_video_1' }));
  const last = useTimelineStore.getState().addClip(makeClip({ start: 60, duration: 30, trackId: 'trk_video_1' }));
  useTimelineStore.getState().toggleRippleDelete();
  useTimelineStore.getState().removeClips([mid]);
  st = useTimelineStore.getState();
  check('earlier clip unchanged', st.clips[first].start, 0);
  check('later clip shifts left', st.clips[last].start, 30);

  // Deleting a contiguous RUN shifts by the combined duration exactly once.
  reset();
  const r1 = useTimelineStore.getState().addClip(makeClip({ start: 0, duration: 20, trackId: 'trk_video_1' }));
  const r2 = useTimelineStore.getState().addClip(makeClip({ start: 20, duration: 20, trackId: 'trk_video_1' }));
  const r3 = useTimelineStore.getState().addClip(makeClip({ start: 40, duration: 20, trackId: 'trk_video_1' }));
  const tail = useTimelineStore.getState().addClip(makeClip({ start: 60, duration: 20, trackId: 'trk_video_1' }));
  useTimelineStore.getState().toggleRippleDelete();
  useTimelineStore.getState().removeClips([r1, r2, r3]);
  check('run delete shifts by total', useTimelineStore.getState().clips[tail].start, 0);

  // Other tracks must be untouched: ripple is per-track.
  reset();
  const v1 = useTimelineStore.getState().addClip(makeClip({ start: 0, duration: 40, trackId: 'trk_video_1' }));
  const a1 = useTimelineStore.getState().addClip(makeClip({ start: 40, duration: 40, trackId: 'trk_audio_1', kind: 'audio' }));
  useTimelineStore.getState().toggleRippleDelete();
  useTimelineStore.getState().removeClips([v1]);
  check('other track unaffected', useTimelineStore.getState().clips[a1].start, 40);
}

console.log('transitions:');
{
  reset();
  const id = useTimelineStore.getState().addClip(makeClip({ duration: 100 }));

  useTimelineStore.getState().setTransition(id, 'in', { type: 'fade', duration: 20 });
  check('transition attached', useTimelineStore.getState().clips[id].transitionIn?.type, 'fade');
  check('duration kept', useTimelineStore.getState().clips[id].transitionIn?.duration, 20);

  // A transition longer than half the clip must be clamped, because xfade
  // cannot cross a boundary longer than either input.
  useTimelineStore.getState().setTransition(id, 'in', { type: 'wipe-left', duration: 500 });
  check('duration clamped to half clip', useTimelineStore.getState().clips[id].transitionIn?.duration, 50);

  // Minimum of one frame, so a 0 or negative request still yields a valid edge.
  useTimelineStore.getState().setTransition(id, 'in', { type: 'fade', duration: 0 });
  check('duration has a floor of 1', useTimelineStore.getState().clips[id].transitionIn?.duration, 1);

  useTimelineStore.getState().setTransition(id, 'in', null);
  check('transition cleared', useTimelineStore.getState().clips[id].transitionIn, undefined);

  // 'none' is the same as clearing, so the UI can pass a type straight through.
  useTimelineStore.getState().setTransition(id, 'out', { type: 'zoom', duration: 10 });
  check('out transition attached', useTimelineStore.getState().clips[id].transitionOut?.type, 'zoom');
  useTimelineStore.getState().setTransition(id, 'out', { type: 'none', duration: 10 });
  check('none clears the transition', useTimelineStore.getState().clips[id].transitionOut, undefined);
}

console.log('presets:');
{
  // Presets must be data-only and complete: a preset that omits a field the
  // user just changed would silently reset it.
  check('text presets defined', TEXT_PRESETS.length > 0, true);
  check('filter presets defined', FILTER_PRESETS.length > 0, true);
  for (const p of TEXT_PRESETS) {
    check(`preset "${p.label}" has a label`, typeof p.label, 'string');
    check(`preset "${p.label}" has a patch`, typeof p.patch, 'object');
  }
  // "Original" must restore the documented defaults exactly.
  const original = FILTER_PRESETS.find((p) => p.id === 'none');
  check('original preset matches defaults', original?.patch, { ...DEFAULT_COLOR });
  check('unique preset ids', new Set(FILTER_PRESETS.map((p) => p.id)).size, FILTER_PRESETS.length);
  check('unique text preset ids', new Set(TEXT_PRESETS.map((p) => p.id)).size, TEXT_PRESETS.length);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

