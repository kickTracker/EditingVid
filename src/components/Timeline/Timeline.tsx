import { useCallback, useEffect, useRef, useState } from 'react';
import { Scissors, Trash2, Type, Magnet, AlignJustify, Plus, Undo2, Redo2, ZoomIn, ZoomOut, Eye, EyeOff, Lock, Unlock, VolumeX, Volume2 } from 'lucide-react';
import { useTimelineStore } from '../../store/useTimelineStore';
import { useHistoryStore } from '../../store/useHistoryStore';
import type { Clip } from '../../types/timeline';
import { formatTimecode, importFiles, addTextAtPlayhead } from '../Library/mediaImport';

const TRACK_HEIGHT = 52;
const HEADER_WIDTH = 140;

/** Colour per clip kind — matches CapCut's palette. */
const KIND_COLOR: Record<string, string> = {
  video:      '#26a69a',
  image:      '#5c6bc0',
  audio:      '#7e57c2',
  text:       '#ef8c2f',
  sticker:    '#ec407a',
  adjustment: '#546e7a',
};

type DragState =
  | { mode: 'move'; clipId: string; grabOffset: number }
  | { mode: 'trim'; clipId: string; edge: 'start' | 'end'; grabFrame: number }
  | { mode: 'playhead' }
  | null;

export const Timeline = () => {
  const tracks = useTimelineStore((s) => s.tracks);
  const clips = useTimelineStore((s) => s.clips);
  const clipOrder = useTimelineStore((s) => s.clipOrder);
  const playhead = useTimelineStore((s) => s.playhead);
  const selection = useTimelineStore((s) => s.selection);
  const zoom = useTimelineStore((s) => s.zoom);
  const settings = useTimelineStore((s) => s.settings);

  const setPlayhead = useTimelineStore((s) => s.setPlayhead);
  const select = useTimelineStore((s) => s.select);
  const toggleSelect = useTimelineStore((s) => s.toggleSelect);
  const setZoom = useTimelineStore((s) => s.setZoom);
  const moveClip = useTimelineStore((s) => s.moveClip);
  const trimClip = useTimelineStore((s) => s.trimClip);
  const splitAtPlayhead = useTimelineStore((s) => s.splitAtPlayhead);
  const removeClips = useTimelineStore((s) => s.removeClips);
  const setPlaying = useTimelineStore((s) => s.setPlaying);
  const rippleDelete = useTimelineStore((s) => s.rippleDelete);
  const toggleRippleDelete = useTimelineStore((s) => s.toggleRippleDelete);
  const snapEnabled = useTimelineStore((s) => s.snapEnabled);
  const toggleSnap = useTimelineStore((s) => s.toggleSnap);
  const restore = useTimelineStore((s) => s.restore);

  const onUndo = useCallback(() => {
    const history = useHistoryStore.getState();
    if (history.past.length === 0) return;
    history.undo();
    const next = useHistoryStore.getState().present;
    if (next) restore(next);
  }, [restore]);

  const onRedo = useCallback(() => {
    const history = useHistoryStore.getState();
    if (history.future.length === 0) return;
    history.redo();
    const next = useHistoryStore.getState().present;
    if (next) restore(next);
  }, [restore]);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState>(null);
  const [trackMuted, setTrackMuted] = useState<Record<string, boolean>>({});
  const [trackHidden, setTrackHidden] = useState<Record<string, boolean>>({});
  const [trackLocked, setTrackLocked] = useState<Record<string, boolean>>({});
  /** Frame the pointer is over while an external drag is in flight. */
  const [dropFrame, setDropFrame] = useState<number | null>(null);

  const pxPerFrame = 4 * zoom;
  const totalFrames = clipOrder.reduce((m, id) => {
    const c = clips[id];
    return c ? Math.max(m, c.start + c.duration) : m;
  }, 0);
  // Keep at least ten seconds of ruler visible on an empty timeline.
  const contentFrames = Math.max(totalFrames + 60, settings.fps * 10);
  const contentWidth = contentFrames * pxPerFrame;

  const frameFromClientX = useCallback(
    (clientX: number) => {
      const el = scrollerRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      return Math.max(0, (clientX - rect.left + el.scrollLeft - HEADER_WIDTH) / pxPerFrame);
    },
    [pxPerFrame],
  );

  /**
   * Magnetic snapping.
   *
   * Candidate edges are the playhead plus the start and end of every other
   * clip. A dragged edge within `tolerance` frames of a candidate locks onto
   * it, which is what stops clips from drifting a frame away from a butt joint.
   */
  const snapFrame = useCallback(
    (frame: number, ignoreClipIds: string[], tolerance = 8): number => {
      if (!useTimelineStore.getState().snapEnabled) return Math.max(0, Math.round(frame));

      const s = useTimelineStore.getState();
      const candidates: number[] = [s.playhead];
      for (const id of s.clipOrder) {
        if (ignoreClipIds.includes(id)) continue;
        const c = s.clips[id];
        if (!c) continue;
        candidates.push(c.start, c.start + c.duration);
      }

      let best = Math.round(frame);
      let bestDist = tolerance;
      for (const cand of candidates) {
        const d = Math.abs(cand - frame);
        if (d < bestDist) {
          bestDist = d;
          best = cand;
        }
      }
      return Math.max(0, best);
    },
    [],
  );

  const beginPlayheadDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { mode: 'playhead' };
    setPlayhead(frameFromClientX(e.clientX));
  };

  /**
   * Accept media dragged in from the Library.
   *
   * The dropped payload is a JSON list of file names, matched back to the File
   * objects cached by the Library on dragstart. Files are imported at the drop
   * point, and `ensureTrackFor` creates whatever track is needed, so dragging
   * onto an occupied lane lands the clip on a fresh track below it.
   */
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropFrame(null);
    const frame = Math.round(frameFromClientX(e.clientX));

    const text = e.dataTransfer.getData('application/x-opencap-text');
    if (text === 'text') {
      useTimelineStore.getState().setPlayhead(frame);
      addTextAtPlayhead();
      return;
    }

    const names = e.dataTransfer.getData('application/x-opencap-files');
    if (!names) return;
    const wanted: string[] = JSON.parse(names);
    const files = (fileCacheRef.current ?? []).filter((f) => wanted.includes(f.name));
    if (files.length === 0) return;

    const { fps } = useTimelineStore.getState().settings;
    await importFiles(files, fps, { startAt: frame });
    useTimelineStore.getState().setPlayhead(frame);
  };

  /** Files offered by the Library, shared via dragstart. */
  const fileCacheRef = useRef<File[] | null>(null);
  // Populated from the window-level dragstart listener below.
  useEffect(() => {
    const onDragStart = (e: DragEvent) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      const files = Array.from(dt.files ?? []);
      if (files.length > 0) {
        fileCacheRef.current = files;
        dt.setData('application/x-opencap-files', JSON.stringify(files.map((f) => f.name)));
        dt.effectAllowed = 'copy';
      }
    };
    window.addEventListener('dragstart', onDragStart);
    return () => window.removeEventListener('dragstart', onDragStart);
  }, []);

  const onDragOver = (e: React.DragEvent) => {
    if (
      e.dataTransfer.types.includes('application/x-opencap-files') ||
      e.dataTransfer.types.includes('application/x-opencap-text')
    ) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDropFrame(Math.round(frameFromClientX(e.clientX)));
    }
  };

  // Window-level listeners keep a drag alive when the pointer leaves the lane.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.mode === 'playhead') {
        setPlayhead(frameFromClientX(e.clientX));
      } else if (drag.mode === 'move') {
        const raw = Math.max(0, frameFromClientX(e.clientX) - drag.grabOffset);
        // Snap the head; the tail is derived from the (unchanged) duration, so
        // snapping the head alone keeps the clip length intact.
        const clip = clips[drag.clipId];
        const dur = clip?.duration ?? 0;
        const snappedHead = snapFrame(raw, [drag.clipId]);
        // Prefer whichever edge lands closer to a candidate.
        const headDist = Math.abs(snappedHead - raw);
        const snappedTail = snapFrame(raw + dur, [drag.clipId]);
        const tailDist = Math.abs(snappedTail - (raw + dur));
        const start = tailDist < headDist ? Math.max(0, snappedTail - dur) : snappedHead;
        moveClip(drag.clipId, clips[drag.clipId]?.trackId ?? '', start);
      } else {
        const frame = frameFromClientX(e.clientX);
        trimClip(drag.clipId, Math.round(frame - drag.grabFrame), drag.edge);
      }
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [clips, frameFromClientX, moveClip, setPlayhead, snapFrame, trimClip]);

  // Keyboard transport shortcuts, ignored while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        useTimelineStore.getState().togglePlay();
      } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyB') {
        e.preventDefault();
        splitAtPlayhead();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        useTimelineStore.getState().step(e.shiftKey ? -10 : -1);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        useTimelineStore.getState().step(e.shiftKey ? 10 : 1);
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        if (selection.length > 0) {
          e.preventDefault();
          removeClips(selection);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [removeClips, selection, splitAtPlayhead]);

  // One tick per second stays readable at every zoom level.
  const rulerTicks: number[] = [];
  for (let f = 0; f <= contentFrames; f += settings.fps) rulerTicks.push(f);

  const visibleTracks = [...tracks].sort((a, b) =>
    a.kind === b.kind ? a.order - b.order : a.kind === 'audio' ? 1 : -1,
  );

  return (
    <div className="oc-timeline">
      <div className="oc-timeline-toolbar">
        {/* Left toolbar group — editing actions */}
        <button className="oc-btn" onClick={() => useTimelineStore.getState().addTrack('video')} title="Add track">
          <Plus size={13} />
        </button>

        <div style={{ width: 1, height: 16, background: 'var(--cc-border)', margin: '0 2px' }} />

        {/* Arrow / select tool placeholder */}
        <button className="oc-btn" title="Select tool">
          ↙️
        </button>

        <div style={{ width: 1, height: 16, background: 'var(--cc-border)', margin: '0 2px' }} />

        <button className="oc-btn" onClick={onUndo} title="Undo (Ctrl+Z)">
          <Undo2 size={13} />
        </button>
        <button className="oc-btn" onClick={onRedo} title="Redo">
          <Redo2 size={13} />
        </button>

        <div style={{ width: 1, height: 16, background: 'var(--cc-border)', margin: '0 2px' }} />

        <button className="oc-btn" onClick={splitAtPlayhead} title="Split at playhead (Ctrl+B)">
          <Scissors size={13} />
        </button>
        <button
          className="oc-btn"
          onClick={() => removeClips(selection)}
          disabled={selection.length === 0}
          title="Delete selected (Del)"
        >
          <Trash2 size={13} />
        </button>
        <button
          className="oc-btn"
          title="Add text overlay at playhead"
          onClick={() => {
            const id = addTextAtPlayhead();
            useTimelineStore.getState().select([id]);
          }}
        >
          <Type size={13} />
        </button>

        <div style={{ width: 1, height: 16, background: 'var(--cc-border)', margin: '0 2px' }} />

        <button
          className={`oc-btn${rippleDelete ? ' is-on' : ''}`}
          onClick={toggleRippleDelete}
          title="Ripple delete"
          aria-pressed={rippleDelete}
        >
          <AlignJustify size={13} />
        </button>
        <button
          className={`oc-btn${snapEnabled ? ' is-on' : ''}`}
          onClick={toggleSnap}
          title="Magnetic snap"
          aria-pressed={snapEnabled}
        >
          <Magnet size={13} />
        </button>

        {/* Right side: zoom + timecode */}
        <label className="oc-zoom">
          <ZoomOut size={12} style={{ color: 'var(--cc-text-3)' }} />
          <input
            type="range"
            min={0.2}
            max={6}
            step={0.1}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
          <ZoomIn size={12} style={{ color: 'var(--cc-text-3)' }} />
        </label>
        <span className="oc-timecode">{formatTimecode(playhead, settings.fps)}</span>
      </div>

      <div
        className="oc-timeline-body"
        onDragOver={onDragOver}
        onDragLeave={() => setDropFrame(null)}
        onDrop={(e) => void onDrop(e)}
      >
        <div className="oc-track-headers" style={{ width: HEADER_WIDTH }}>
          <div className="oc-ruler-corner" />
          {visibleTracks.map((t) => (
            <div key={t.id} className="oc-track-header" style={{ height: TRACK_HEIGHT }}>
              <span className="oc-track-name">{t.name}</span>
              <span className="oc-track-buttons">
                <button
                  title={trackMuted[t.id] ? 'Unmute track' : 'Mute track'}
                  className={trackMuted[t.id] ? 'is-on' : ''}
                  onClick={() => setTrackMuted((m) => ({ ...m, [t.id]: !m[t.id] }))}
                >
                  {trackMuted[t.id] ? <VolumeX size={12} /> : <Volume2 size={12} />}
                </button>
                <button
                  title={trackHidden[t.id] ? 'Show track' : 'Hide track'}
                  onClick={() => setTrackHidden((h) => ({ ...h, [t.id]: !h[t.id] }))}
                >
                  {trackHidden[t.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
                <button
                  title={trackLocked[t.id] ? 'Unlock track' : 'Lock track'}
                  onClick={() => setTrackLocked((l) => ({ ...l, [t.id]: !l[t.id] }))}
                >
                  {trackLocked[t.id] ? <Lock size={12} /> : <Unlock size={12} />}
                </button>
              </span>
            </div>
          ))}
        </div>


        <div className="oc-tracks-scroll" ref={scrollerRef}>
          <div style={{ width: contentWidth + HEADER_WIDTH, position: 'relative' }}>
            <div
              className="oc-ruler"
              style={{ width: contentWidth, marginLeft: HEADER_WIDTH }}
              onPointerDown={beginPlayheadDrag}
            >
              {rulerTicks.map((f) => (
                <span key={f} className="oc-tick" style={{ left: f * pxPerFrame }}>
                  {formatTimecode(f, settings.fps).slice(0, 5)}
                </span>
              ))}
            </div>

            {visibleTracks.map((t) => (
              <div
                key={t.id}
                className="oc-track-lane"
                style={{ height: TRACK_HEIGHT, width: contentWidth, marginLeft: HEADER_WIDTH }}
                onPointerDown={(e) => {
                  // Only empty lane space seeks; clip drags stop propagation.
                  if ((e.target as HTMLElement).classList.contains('oc-track-lane')) {
                    setPlayhead(frameFromClientX(e.clientX));
                  }
                }}
              >
                {clipOrder.map((id) => {
                  const clip = clips[id];
                  if (!clip || clip.trackId !== t.id) return null;
                  const left = clip.start * pxPerFrame;
                  const width = Math.max(4, clip.duration * pxPerFrame);
                  const isSelected = selection.includes(id);
                  return (
                    <div
                      key={id}
                      className={`oc-clip${isSelected ? ' is-selected' : ''}`}
                      style={{
                        left,
                        width,
                        top: 6,
                        height: TRACK_HEIGHT - 12,
                        background: KIND_COLOR[clip.kind] ?? '#475569',
                        opacity: trackHidden[t.id] ? 0.35 : 1,
                      }}
                      onPointerDown={(e) => {
                        if (trackLocked[t.id]) return;
                        e.stopPropagation();
                        if (e.shiftKey) toggleSelect(id);
                        else if (!isSelected) select([id]);
                        dragRef.current = {
                          mode: 'move',
                          clipId: id,
                          grabOffset: frameFromClientX(e.clientX) - clip.start,
                        };
                        setPlaying(false);
                      }}
                      title={`${clip.name} · ${clip.duration}f @ ${clip.speed}x`}
                    >
                      <span className="oc-clip-label">{clip.name}</span>
                      <span
                        className="oc-trim-handle oc-trim-start"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          if (trackLocked[t.id]) return;
                          dragRef.current = {
                            mode: 'trim',
                            clipId: id,
                            edge: 'start',
                            grabFrame: frameFromClientX(e.clientX),
                          };
                        }}
                      />
                      <span
                        className="oc-trim-handle oc-trim-end"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          if (trackLocked[t.id]) return;
                          dragRef.current = {
                            mode: 'trim',
                            clipId: id,
                            edge: 'end',
                            grabFrame: frameFromClientX(e.clientX),
                          };
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            ))}

            <div
              className="oc-playhead"
              style={{ left: HEADER_WIDTH + playhead * pxPerFrame }}
              onPointerDown={beginPlayheadDrag}
            >
              <span className="oc-playhead-grip" />
            </div>

            {/* Drop indicator: shows exactly where the media will land. */}
            {dropFrame !== null && (
              <div
                className="oc-drop-indicator"
                style={{ left: HEADER_WIDTH + dropFrame * pxPerFrame }}
              />
            )}

            {/* CapCut-style empty-state hint */}
            {clipOrder.length === 0 && (
              <div className="oc-timeline-empty" style={{ left: HEADER_WIDTH }}>
                <span style={{ fontSize: 16, opacity: 0.3 }}>⊞</span>
                Drag material here and start to create
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/** Clips visible at a given frame. */
export const clipsAtFrame = (
  clipOrder: string[],
  clips: Record<string, Clip>,
  frame: number,
): Clip[] =>
  clipOrder
    .map((id) => clips[id])
    .filter((c): c is Clip => !!c && frame >= c.start && frame < c.start + c.duration);

