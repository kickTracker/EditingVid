import { useTimelineStore, DEFAULT_CHROMA, DEFAULT_COLOR, DEFAULT_MASK, DEFAULT_TRANSFORM } from '../../store/useTimelineStore';
import type { ClipKind } from '../../types/timeline';

/** Probe a media file for its real duration, dimensions and audio presence. */
export const probeMedia = (
  file: File,
): Promise<{ seconds: number; width: number; height: number; hasAudio: boolean }> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const isVideo = file.type.startsWith('video');
    const fail = (msg: string) => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name}: ${msg}`));
    };

    // Audio presence cannot be determined reliably from metadata alone in a
    // browser: `mozHasAudio` is Firefox-only and webkit's decoded-byte counter
    // stays 0 until data is fetched. Rather than guess, the caller passes the
    // result through and the exporter treats "unknown" as audible, which is the
    // safe default because a missing audio branch is caught at export time.
    const detectAudio = (el: HTMLVideoElement): boolean => {
      const anyEl = el as HTMLVideoElement & { mozHasAudio?: boolean };
      return typeof anyEl.mozHasAudio === 'boolean' ? anyEl.mozHasAudio : true;
    };

    if (isVideo) {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        const seconds = video.duration;
        const width = video.videoWidth;
        const height = video.videoHeight;
        const hasAudio = detectAudio(video);
        URL.revokeObjectURL(url);
        if (!Number.isFinite(seconds) || seconds <= 0) {
          reject(new Error(`${file.name}: duration unavailable`));
          return;
        }
        resolve({ seconds, width, height, hasAudio });
      };
      video.onerror = () => fail('could not be decoded');
      video.src = url;
    } else if (file.type.startsWith('audio')) {
      // Audio files have no dimensions and are handled as audio-only clips.
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.onloadedmetadata = () => {
        const seconds = audio.duration;
        URL.revokeObjectURL(url);
        if (!Number.isFinite(seconds) || seconds <= 0) {
          reject(new Error(`${file.name}: duration unavailable`));
          return;
        }
        resolve({ seconds, width: 0, height: 0, hasAudio: true });
      };
      audio.onerror = () => fail('could not be decoded');
      audio.src = url;
    } else {
      const img = new Image();
      img.onload = () => {
        const width = img.naturalWidth;
        const height = img.naturalHeight;
        URL.revokeObjectURL(url);
        // Stills have no intrinsic duration; hold them for 3 seconds.
        resolve({ seconds: 3, width, height, hasAudio: false });
      };
      img.onerror = () => fail('could not be decoded');
      img.src = url;
    }
  });

/** Map a file to a clip kind, falling back to its extension. */
export const kindForFile = (file: File): ClipKind => {
  if (file.type.startsWith('video')) return 'video';
  if (file.type.startsWith('audio')) return 'audio';
  if (file.type.startsWith('image')) return 'image';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) return 'audio';
  return 'image';
};

/**
 * Import files as clips laid end-to-end from the playhead.
 *
 * Each file is placed on the lowest track of its kind that is free for the
 * whole clip range, so importing a video and then a music file puts them on
 * separate tracks automatically instead of stacking them.
 */
export const importFiles = async (
  files: File[],
  fps: number,
  options: { startAt?: number } = {},
): Promise<{ added: number; errors: string[] }> => {
  const store = useTimelineStore.getState();
  const errors: string[] = [];
  let added = 0;

  // Lay clips end-to-end from the requested start so a multi-file import
  // becomes a continuous strip rather than overlapping segments.
  const cursorFor = (kind: ClipKind, fallback: number): number => {
    const trackKind = kind === 'audio' ? 'audio' : 'video';
    const tracks = store.tracks.filter((t) => t.kind === trackKind);
    const endOfTimeline = store.clipOrder.reduce((m, id) => {
      const c = store.clips[id];
      return c && c.trackId && tracks.some((t) => t.id === c.trackId)
        ? Math.max(m, c.start + c.duration)
        : m;
    }, 0);
    return options.startAt ?? (fallback || endOfTimeline);
  };

  let cursor = cursorFor('video', options.startAt ?? 0);
  let audioCursor = cursorFor('audio', options.startAt ?? 0);

  for (const file of files) {
    const kind = kindForFile(file);
    try {
      const meta = await probeMedia(file);
      const duration = Math.max(1, Math.round(meta.seconds * fps));
      const start = kind === 'audio' ? audioCursor : cursor;
      const trackKind = kind === 'audio' ? 'audio' : 'video';

      // Auto-create a track when every track of this kind is occupied, so the
      // user never has to press an "add track" button first.
      const trackId = useTimelineStore
        .getState()
        .ensureTrackFor(trackKind, start, duration, false);

      // The first real media imported sets the canvas, so a 16:9 clip is not
      // letterboxed into a portrait project. Ignored once clips exist.
      if (meta.width > 0 && meta.height > 0) {
        useTimelineStore.getState().adoptAspectFromMedia(meta.width, meta.height);
      }

      useTimelineStore.getState().addClip({
        trackId,
        kind,
        name: file.name,
        // The object URL must outlive this call, so it is not revoked here; the
        // media cache drops it when the clip is deleted.
        src: URL.createObjectURL(file),
        start,
        inPoint: 0,
        duration,
        sourceDuration: duration,
        hasAudio: meta.hasAudio,
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
      });

      if (kind === 'audio') audioCursor = start + duration;
      else cursor = start + duration;
      added++;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { added, errors };
};

/** Duration in frames for a newly added text clip (3s at the project rate). */
const TEXT_DEFAULT_FRAMES = 90;

/**
 * Add a text clip at `start`, placing it on the highest video track that is
 * free at that time.
 *
 * Text is an overlay, so it belongs ABOVE the footage. `ensureTrackFor` is
 * called with `preferTop` so a new track is only created when every existing
 * video track is already occupied at that range, which is what makes the
 * result look like dropping a caption onto a CapCut timeline.
 */
export const addTextAtPlayhead = (content = 'New text'): string => {
  const store = useTimelineStore.getState();
  const start = store.playhead;
  const trackId = store.ensureTrackFor('video', start, TEXT_DEFAULT_FRAMES, true);

  return useTimelineStore.getState().addClip({
    trackId,
    kind: 'text',
    name: content,
    start,
    inPoint: 0,
    duration: TEXT_DEFAULT_FRAMES,
    sourceDuration: 0,
    hasAudio: false,
    speed: 1,
    reverse: false,
    volume: 1,
    muted: true,
    pan: 0,
    fadeIn: 0,
    fadeOut: 0,
    transform: { ...DEFAULT_TRANSFORM },
    color: { ...DEFAULT_COLOR },
    chromaKey: { ...DEFAULT_CHROMA },
    mask: { ...DEFAULT_MASK },
    text: {
      content,
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
    },
    keyframes: {},
  });
};

/** Human-readable timecode for a frame index. */
export const formatTimecode = (frame: number, fps: number): string => {
  const total = Math.max(0, Math.floor(frame));
  const h = Math.floor(total / (fps * 3600));
  const m = Math.floor(total / (fps * 60)) % 60;
  const s = Math.floor(total / fps) % 60;
  const f = total % fps;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}.${pad(f)}` : `${pad(m)}:${pad(s)}.${pad(f)}`;
};

/** Sort clips into compositing order: bottom track first, then by start. */
export const orderForCompositing = <T extends { trackId: string; start: number }>(
  clips: T[],
  tracks: { id: string; order: number }[],
): T[] => {
  const orderOf = new Map(tracks.map((t) => [t.id, t.order]));
  return [...clips].sort((a, b) => {
    const oa = orderOf.get(a.trackId) ?? 0;
    const ob = orderOf.get(b.trackId) ?? 0;
    return oa !== ob ? oa - ob : a.start - b.start;
  });
};

