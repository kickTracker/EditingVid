import { create } from 'zustand';
import type {
  AnimatableKey,
  Clip,
  ColorAdjust,
  Keyframe,
  ProjectSettings,
  TextStyle,
  Track,
  Transform,
  Transition,
} from '../types/timeline';
import {
  clamp,
  DEFAULT_CHROMA,
  DEFAULT_COLOR,
  DEFAULT_MASK,
  DEFAULT_PROJECT,
  DEFAULT_TEXT,
  DEFAULT_TRANSFORM,
  uid,
} from '../types/timeline';

/**
 * The serializable project document.
 *
 * Everything here is plain data: no functions, no class instances, no DOM
 * handles. That keeps history snapshots cheap to copy and lets the whole
 * document round-trip through JSON for local persistence.
 */
export interface ProjectState {
  tracks: Track[];
  clips: Record<string, Clip>;
  clipOrder: string[];
  settings: ProjectSettings;
}

export interface TimelineState extends ProjectState {
  playhead: number;
  playing: boolean;
  selection: string[];
  zoom: number;
  /** px per frame in the timeline ruler. */
  pxPerFrame: number;
  /** When true, deleting a clip closes the gap left on its track. */
  rippleDelete: boolean;

  // --- transport ---
  setPlayhead: (frame: number) => void;
  setPlaying: (playing: boolean) => void;
  togglePlay: () => void;
  step: (delta: number) => void;

  // --- selection ---
  select: (ids: string[]) => void;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;

  // --- view ---
  setZoom: (zoom: number) => void;

  // --- editing ---
  addTrack: (kind: 'video' | 'audio') => string;
  ensureTrackFor: (
    kind: 'video' | 'audio',
    start: number,
    duration: number,
    preferTop?: boolean,
  ) => string;
  removeTrack: (trackId: string) => void;
  addClip: (clip: Omit<Clip, 'id'> & { id?: string }) => string;
  updateClip: (id: string, patch: Partial<Clip>) => void;
  removeClips: (ids: string[]) => void;
  toggleRippleDelete: () => void;
  /** Attach or clear a transition on a clip edge. */
  setTransition: (id: string, edge: 'in' | 'out', transition: Transition | null) => void;
  /** Magnetic snap tolerance in frames; 0 disables snapping. */
  snapEnabled: boolean;
  toggleSnap: () => void;
  splitAtPlayhead: () => void;
  moveClip: (id: string, trackId: string, start: number) => void;
  trimClip: (id: string, deltaFrames: number, edge: 'start' | 'end') => void;
  setSpeed: (id: string, speed: number) => void;
  toggleMute: (id: string) => void;
  setVolume: (id: string, volume: number) => void;
  setPan: (id: string, pan: number) => void;

  // --- transform / keyframes / text ---
  setTransform: (id: string, patch: Partial<Transform>) => void;
  setColor: (id: string, patch: Partial<ColorAdjust>) => void;
  setText: (id: string, patch: Partial<TextStyle>) => void;
  addKeyframe: (id: string, key: AnimatableKey, frame: number, value: number) => void;
  removeKeyframe: (id: string, key: AnimatableKey, keyframeId: string) => void;

  // --- document ---
  setSettings: (patch: Partial<ProjectSettings>) => void;
  setAspectRatio: (width: number, height: number) => void;
  /** Adopt the first imported clip's dimensions as the project size. */
  adoptAspectFromMedia: (width: number, height: number) => void;
  snapshot: () => ProjectState;
  restore: (state: ProjectState) => void;
  reset: () => void;
}
/** Build the default 3-track project (2 video layers + 1 audio). */
export const createInitialProject = (): ProjectState => {
  const tracks: Track[] = [
    { id: 'trk_video_1', kind: 'video', name: 'Video 1', muted: false, hidden: false, locked: false, order: 0 },
    { id: 'trk_video_2', kind: 'video', name: 'Video 2', muted: false, hidden: false, locked: false, order: 1 },
    { id: 'trk_audio_1', kind: 'audio', name: 'Audio 1', muted: false, hidden: false, locked: false, order: 0 },
  ];
  return { tracks, clips: {}, clipOrder: [], settings: { ...DEFAULT_PROJECT } };
};

export const useTimelineStore = create<TimelineState>((set, get) => ({
  ...createInitialProject(),
  playhead: 0,
  playing: false,
  selection: [],
  zoom: 1,
  pxPerFrame: 4,
  rippleDelete: false,
  snapEnabled: true,

  // --- transport ---
  setPlayhead: (frame) => set({ playhead: Math.max(0, Math.round(frame)) }),
  setPlaying: (playing) => set({ playing }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  step: (delta) => set((s) => ({ playhead: Math.max(0, s.playhead + delta) })),

  // --- selection ---
  select: (ids) => set({ selection: ids }),
  toggleSelect: (id) =>
    set((s) => ({
      selection: s.selection.includes(id)
        ? s.selection.filter((x) => x !== id)
        : [...s.selection, id],
    })),
  clearSelection: () => set({ selection: [] }),

  // --- view ---
  setZoom: (zoom) => set({ zoom: clamp(zoom, 0.1, 20) }),

  // --- editing ---
  addTrack: (kind) => {
    const id = uid('trk');
    set((s) => {
      const sameKind = s.tracks.filter((t) => t.kind === kind);
      const track: Track = {
        id,
        kind,
        name: `${kind === 'video' ? 'Video' : 'Audio'} ${sameKind.length + 1}`,
        muted: false,
        hidden: false,
        locked: false,
        order: sameKind.length,
      };
      return { tracks: [...s.tracks, track] };
    });
    return id;
  },

  /**
   * Find a track of `kind` that is free across [start, start+duration), or
   * create one.
   *
   * This is what makes the editor behave like a CapCut-style NLE: users drop
   * media and overlays wherever they like and tracks appear on demand, rather
   * than manually managing a fixed set. Existing clips are never disturbed.
   */
  ensureTrackFor: (kind, start, duration, preferTop = false) => {
    const s = get();
    const end = start + Math.max(1, duration);
    const candidates = s.tracks
      .filter((t) => t.kind === kind)
      .sort((a, b) => (preferTop ? b.order - a.order : a.order - b.order));

    const isFree = (t: Track) =>
      s.clipOrder.every((id) => {
        const c = s.clips[id];
        if (!c || c.trackId !== t.id) return true;
        // Half-open overlap test: abutting clips share a boundary legally.
        return c.start >= end || c.start + c.duration <= start;
      });

    const free = candidates.find(isFree);
    if (free) return free.id;
    return get().addTrack(kind);
  },

  removeTrack: (trackId) =>
    set((s) => {
      const doomed = s.clipOrder.filter((id) => s.clips[id]?.trackId === trackId);
      const clips = { ...s.clips };
      doomed.forEach((id) => delete clips[id]);
      return {
        tracks: s.tracks.filter((t) => t.id !== trackId),
        clips,
        clipOrder: s.clipOrder.filter((id) => !doomed.includes(id)),
        selection: s.selection.filter((id) => !doomed.includes(id)),
      };
    }),

  addClip: (clip) => {
    const id = clip.id ?? uid('clip');
    set((s) => ({
      clips: {
        ...s.clips,
        [id]: { ...clip, id, keyframes: clip.keyframes ?? {} } as Clip,
      },
      clipOrder: [...s.clipOrder, id],
    }));
    return id;
  },

  updateClip: (id, patch) =>
    set((s) => {
      const existing = s.clips[id];
      if (!existing) return s;
      return { clips: { ...s.clips, [id]: { ...existing, ...patch, id } } };
    }),

  removeClips: (ids: string[]) => {
    set((s) => {
      const doomed = new Set(ids);
      const clips = { ...s.clips };
      ids.forEach((id) => delete clips[id]);

      let clipOrder = s.clipOrder.filter((id) => !doomed.has(id));

      // Ripple delete closes the gap left behind. Only clips AFTER a removed
      // clip on the SAME track shift, and each track's shift is computed from
      // the total removed duration on that track up to that point, so a run of
      // deleted clips does not double-count.
      if (s.rippleDelete) {
        const removedByTrack = new Map<string, number>();
        for (const id of ids) {
          const c = s.clips[id];
          if (!c) continue;
          removedByTrack.set(c.trackId, (removedByTrack.get(c.trackId) ?? 0) + c.duration);
        }

        const shiftFor = (trackId: string, fromFrame: number): number => {
          let total = 0;
          for (const id of ids) {
            const c = s.clips[id];
            if (c && c.trackId === trackId && c.start < fromFrame) total += c.duration;
          }
          return total;
        };

        if (removedByTrack.size > 0) {
          clipOrder = clipOrder.map((id) => {
            const c = clips[id];
            if (!c) return id;
            const removedBefore = shiftFor(c.trackId, c.start);
            if (removedBefore === 0) return id;
            clips[id] = { ...c, start: Math.max(0, c.start - removedBefore) };
            return id;
          });
        }
      }

      return {
        clips,
        clipOrder,
        selection: s.selection.filter((id) => !doomed.has(id)),
      };
    });
  },

  toggleRippleDelete: () => set((s) => ({ rippleDelete: !s.rippleDelete })),

  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),

  /**
   * Attach or clear a transition on one edge of a clip.
   *
   * Duration is clamped to the clip length: FFmpeg's `xfade` cannot cross a
   * boundary longer than either input, so a longer transition would fail the
   * whole export rather than just looking wrong.
   */
  setTransition: (id, edge, transition) =>
    set((s) => {
      const c = s.clips[id];
      if (!c) return s;
      if (!transition || transition.type === 'none') {
        const next = { ...c };
        if (edge === 'in') delete next.transitionIn;
        else delete next.transitionOut;
        return { clips: { ...s.clips, [id]: next } };
      }
      const maxFrames = Math.max(1, Math.floor(c.duration / 2));
      const clamped: Transition = {
        type: transition.type,
        duration: Math.max(1, Math.min(transition.duration, maxFrames)),
      };
      return {
        clips: {
          ...s.clips,
          [id]:
            edge === 'in'
              ? { ...c, transitionIn: clamped }
              : { ...c, transitionOut: clamped },
        },
      };
    }),

  /**
   * Split every selected clip (or any clip under the playhead) at the playhead.
   * The right-hand half inherits the same source, advanced by the split offset,
   * so no source material is duplicated or lost.
   */
  splitAtPlayhead: () =>
    set((s) => {
      const { playhead } = s;
      const explicit = s.selection.filter((id) => {
        const c = s.clips[id];
        return c && playhead > c.start && playhead < c.start + c.duration;
      });
      const targets = explicit.length
        ? explicit
        : s.clipOrder.filter((id) => {
            const c = s.clips[id];
            return c && playhead > c.start && playhead < c.start + c.duration;
          });

      if (targets.length === 0) return s;

      const clips = { ...s.clips };
      const clipOrder = [...s.clipOrder];
      const selection = [...s.selection];

      for (const id of targets) {
        const c = clips[id];
        if (!c) continue;
        const offset = playhead - c.start;
        // Speed changes the mapping between timeline and source frames.
        const sourceOffset = Math.round(offset * c.speed);

        const left: Clip = { ...c, duration: offset };
        const right: Clip = {
          ...c,
          id: uid('clip'),
          start: playhead,
          duration: c.duration - offset,
          inPoint: c.inPoint + sourceOffset,
          keyframes: { ...c.keyframes },
        };

        Object.assign(clips[left.id], left);
        clips[right.id] = right;
        clipOrder.push(right.id);
        if (!selection.includes(right.id)) selection.push(right.id);
      }

      return { clips, clipOrder, selection };
    }),

  moveClip: (id, trackId, start) =>
    set((s) => {
      const existing = s.clips[id];
      if (!existing) return s;
      return {
        clips: {
          ...s.clips,
          [id]: { ...existing, trackId, start: Math.max(0, Math.round(start)) },
        },
      };
    }),

  /**
   * Trim one edge. The head trim moves both `start` and `inPoint` so the clip
   * reveals later source material; the tail trim only shortens.
   *
   * Out-of-range requests CLAMP rather than reject, so dragging a handle past
   * the limit pins it to the boundary instead of silently doing nothing. A clip
   * can never become shorter than one frame, and neither edge may reach past
   * the real end of the source media.
   */
  trimClip: (id, deltaFrames, edge) =>
    set((s) => {
      const c = s.clips[id];
      if (!c) return s;

      if (edge === 'start') {
        // Cannot pull the head back before frame 0...
        let delta = Math.max(deltaFrames, -c.start);
        if (c.sourceDuration > 0 && delta < 0) {
          // Only rewinds are bounded by the source's head; a forward trim moves
          // the in-point later, so it must not be capped by this limit.
          const maxRewind = Math.floor(c.inPoint / c.speed);
          delta = Math.max(delta, -maxRewind);
        }
        if (c.sourceDuration > 0) {
          // ...nor advance the in-point past the final source frame.
          const maxForward = c.sourceDuration - 1 - c.inPoint;
          delta = Math.min(delta, Math.round(maxForward / c.speed));
        }
        // Cannot trim the head past the tail.
        delta = Math.min(delta, c.duration - 1);
        if (delta === 0) return s;

        return {
          clips: {
            ...s.clips,
            [id]: {
              ...c,
              start: c.start + delta,
              inPoint: c.inPoint + Math.round(delta * c.speed),
              duration: c.duration - delta,
            },
          },
        };
      }

      // Tail: grow only up to the remaining source, shrink to a single frame.
      let newDuration = c.duration + deltaFrames;
      if (c.sourceDuration > 0) {
        const maxDuration = Math.max(1, c.sourceDuration - c.inPoint);
        newDuration = Math.min(newDuration, maxDuration);
      }
      newDuration = Math.max(1, newDuration);
      if (newDuration === c.duration) return s;

      return { clips: { ...s.clips, [id]: { ...c, duration: newDuration } } };
    }),

  /**
   * Change clip speed. Visible duration rescales inversely so the same source
   * material stays on screen, and the in/out mapping is preserved.
   */
  setSpeed: (id, speed) =>
    set((s) => {
      const c = s.clips[id];
      if (!c || c.kind === 'text' || c.kind === 'sticker' || c.kind === 'adjustment') return s;
      const next = clamp(speed, 0.1, 100);
      if (next === c.speed) return s;

      const sourceUsed = Math.round(c.duration * c.speed);
      const newDuration = Math.max(1, Math.round(sourceUsed / next));

      // A speed change must not leave the previously covered source range.
      if (c.sourceDuration > 0 && c.inPoint + sourceUsed > c.sourceDuration) return s;

      return { clips: { ...s.clips, [id]: { ...c, speed: next, duration: newDuration } } };
    }),

  toggleMute: (id) =>
    set((s) => {
      const c = s.clips[id];
      return c ? { clips: { ...s.clips, [id]: { ...c, muted: !c.muted } } } : s;
    }),

  setVolume: (id, volume) =>
    set((s) => {
      const c = s.clips[id];
      if (!c) return s;
      return { clips: { ...s.clips, [id]: { ...c, volume: clamp(volume, 0, 2) } } };
    }),

  setPan: (id, pan) =>
    set((s) => {
      const c = s.clips[id];
      if (!c) return s;
      return { clips: { ...s.clips, [id]: { ...c, pan: clamp(pan, -1, 1) } } };
    }),

  setTransform: (id, patch) =>
    set((s) => {
      const c = s.clips[id];
      if (!c) return s;
      return {
        clips: { ...s.clips, [id]: { ...c, transform: { ...c.transform, ...patch } } },
      };
    }),

  setColor: (id, patch) =>
    set((s) => {
      const c = s.clips[id];
      if (!c) return s;
      return { clips: { ...s.clips, [id]: { ...c, color: { ...c.color, ...patch } } } };
    }),

  setText: (id, patch) =>
    set((s) => {
      const c = s.clips[id];
      if (!c?.text) return s;
      return {
        clips: {
          ...s.clips,
          [id]: { ...c, text: { ...c.text, ...patch }, name: patch.content ?? c.name },
        },
      };
    }),

  /**
   * Insert a keyframe, replacing any existing one at that exact frame so a
   * repeated click is idempotent rather than stacking duplicates.
   */
  addKeyframe: (id, key, frame, value) =>
    set((s) => {
      const c = s.clips[id];
      if (!c) return s;
      const list = c.keyframes[key] ?? [];
      const without = list.filter((k) => k.frame !== frame);
      const kf: Keyframe = { id: uid('kf'), frame, value, easing: 'linear' };
      return {
        clips: {
          ...s.clips,
          [id]: { ...c, keyframes: { ...c.keyframes, [key]: [...without, kf] } },
        },
      };
    }),

  removeKeyframe: (id, key, keyframeId) =>
    set((s) => {
      const c = s.clips[id];
      if (!c) return s;
      const list = c.keyframes[key] ?? [];
      return {
        clips: {
          ...s.clips,
          [id]: {
            ...c,
            keyframes: { ...c.keyframes, [key]: list.filter((k) => k.id !== keyframeId) },
          },
        },
      };
    }),

  // --- document ---
  setSettings: (patch) =>
    set((s) => ({ settings: { ...s.settings, ...patch } })),

  /**
   * Switch the project to a new canvas size.
   *
   * Dimensions are rounded DOWN to the nearest even number because H.264
   * requires even width and height; an odd size makes libx264 fail at export
   * time. `Math.round(w / 2) * 2` is wrong here: it rounds 1921 up to 1922
   * instead of down to 1920.
   */
  setAspectRatio: (width, height) =>
    set((s) => ({
      settings: {
        ...s.settings,
        width: Math.max(2, Math.floor(width / 2) * 2),
        height: Math.max(2, Math.floor(height / 2) * 2),
      },
    })),

  /**
   * Match the project canvas to the first media imported.
   *
   * Importing a 16:9 clip into a 1080x1920 portrait project letterboxes it into
   * a small strip, which looks broken. The first real media file therefore
   * sets the canvas; later imports are ignored so the project cannot silently
   * resize under the user mid-edit.
   */
  adoptAspectFromMedia: (width, height) =>
    set((s) => {
      if (s.clipOrder.length > 0) return s;
      if (width <= 0 || height <= 0) return s;
      return {
        settings: {
          ...s.settings,
          // Rounded down to even for the same H.264 reason as setAspectRatio.
          width: Math.max(2, Math.floor(width / 2) * 2),
          height: Math.max(2, Math.floor(height / 2) * 2),
        },
      };
    }),

  /** Extract the serializable document, excluding all transient view state. */
  snapshot: () => {
    const s = get();
    return { tracks: s.tracks, clips: s.clips, clipOrder: s.clipOrder, settings: s.settings };
  },

  restore: (state) =>
    set((s) => ({
      ...state,
      playing: false,
      // Drop selections pointing at clips that no longer exist.
      selection: s.selection.filter((id) => id in state.clips),
    })),

  // `reset` starts a genuinely new project, so transient editing modes are
  // cleared too. Leaving `rippleDelete` set meant a later toggle turned it
  // OFF rather than on, silently disabling ripple for the next edit session.
  reset: () =>
    set({
      ...createInitialProject(),
      playhead: 0,
      playing: false,
      selection: [],
      rippleDelete: false,
      snapEnabled: true,
    }),
}));

// Defaults are re-exported so the Library can build clips from one import.
export { DEFAULT_CHROMA, DEFAULT_COLOR, DEFAULT_MASK, DEFAULT_TEXT, DEFAULT_TRANSFORM };

