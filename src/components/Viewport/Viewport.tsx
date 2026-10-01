import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react';
import { useTimelineStore } from '../../store/useTimelineStore';
import { CanvasCompositor } from '../../engine/canvasCompositor';
import { FrameLoop } from '../../engine/frameLoop';
import { isActiveAt, resolveTransform } from '../../engine/keyframeEngine';
import { orderForCompositing, formatTimecode } from '../Library/mediaImport';

/**
 * A direct-manipulation gesture on the selected clip's bounding box.
 *
 * Offsets are captured at gesture start so each drag is computed from the
 * original value rather than accumulating rounding error frame by frame.
 */
type GizmoDrag =
  | {
      mode: 'move';
      pointerId: number;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
    }
  | {
      mode: 'scale';
      pointerId: number;
      /** Pointer distance from the layer centre when the drag began. */
      startDist: number;
      originScale: number;
      /**
       * The layer centre is captured here and reused for the whole gesture.
       * Measuring the start against the clip centre but the live distance
       * against the canvas centre made the ratio meaningless and inverted the
       * handle, so dragging away from the box SHRANK the layer.
       */
      centreX: number;
      centreY: number;
    }
  | { mode: 'rotate'; pointerId: number; centreAngle: number; originRotation: number };

export const Viewport = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const compositorRef = useRef<CanvasCompositor | null>(null);
  const loopRef = useRef<FrameLoop | null>(null);
  const lastDrawn = useRef(-1);
  /** Identity of the last painted document, to detect edits at a fixed playhead. */
  const lastDoc = useRef<string | null>(null);
  /** In-flight gizmo gesture, or null when idle. */
  const gizmoRef = useRef<GizmoDrag | null>(null);
  /** Clip currently being retyped on the canvas, or null. */
  const [editing, setEditing] = useState<string | null>(null);
  const editRef = useRef<HTMLTextAreaElement | null>(null);
  /** Bumped when the compositor instance is (re)created. */
  const [compositorReady, setCompositorReady] = useState(0);
  /** Box the compositor painted for the selected clip, in canvas pixels. */
  const [bounds, setBounds] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const playhead = useTimelineStore((s) => s.playhead);
  const playing = useTimelineStore((s) => s.playing);
  const clipOrder = useTimelineStore((s) => s.clipOrder);
  const clips = useTimelineStore((s) => s.clips);
  const tracks = useTimelineStore((s) => s.tracks);
  const settings = useTimelineStore((s) => s.settings);
  const selection = useTimelineStore((s) => s.selection);

  const activeClips = useMemo(
    () =>
      orderForCompositing(
        clipOrder.map((id) => clips[id]).filter((c) => c && isActiveAt(c, playhead)),
        tracks,
      ),
    [clipOrder, clips, tracks, playhead],
  );

  // A cheap signature of everything that affects the rendered image. Used only
  // to decide whether a repaint is needed, so a JSON stringify of the visible
  // clips is both simple and fast enough at this scale.
  const docKey = useMemo(() => JSON.stringify(activeClips), [activeClips]);

  // The project is stored at full resolution; CSS scales the canvas to fit.
  useEffect(() => {
    if (!canvasRef.current) return;
    compositorRef.current = new CanvasCompositor(canvasRef.current);
    compositorRef.current.resize(settings.width, settings.height);
    lastDrawn.current = -1;
    // The gizmo box is derived from the compositor instance, so bumping this
    // forces it to re-measure once the instance actually exists.
    setCompositorReady((n) => n + 1);
  }, [settings.width, settings.height]);

  // Repaint whenever the playhead OR the document changes.
  //
  // The playhead alone is not a sufficient cache key: editing a clip's text,
  // colour or transform leaves the playhead untouched, so keying only on it
  // silently discarded every Inspector change until the user scrubbed the
  // timeline. Keying on the composited clip set as well means any document
  // edit repaints immediately.
  useEffect(() => {
    if (!compositorRef.current) return;
    if (lastDrawn.current === playhead && lastDoc.current === docKey) return;
    lastDrawn.current = playhead;
    lastDoc.current = docKey;
    compositorRef.current.render(activeClips, playhead, settings);

    // Read back the box the compositor actually painted, so the gizmo can never
    // disagree with the rendered text.
    const sel = selection.length === 1 ? clips[selection[0]] : undefined;
    const b = sel ? compositorRef.current.getBounds(sel.id) : null;
    setBounds((prev) => {
      if (!b && !prev) return prev;
      if (b && prev && b.x === prev.x && b.y === prev.y && b.w === prev.w && b.h === prev.h) {
        return prev;
      }
      return b;
    });
  }, [activeClips, playhead, settings, docKey, selection, clips]);

  useEffect(() => {
    if (!playing) {
      loopRef.current?.stop();
      return;
    }
    const total = clipOrder.reduce((m, id) => {
      const c = clips[id];
      return c ? Math.max(m, c.start + c.duration) : m;
    }, 0);

    const loop = new FrameLoop(settings.fps, {
      onTick: (cursor) => {
        // Stop at the end rather than looping forever.
        if (cursor >= total) {
          loop.stop();
          useTimelineStore.getState().setPlaying(false);
          useTimelineStore.getState().setPlayhead(total);
          return;
        }
        useTimelineStore.getState().setPlayhead(cursor);
      },
    });
    loopRef.current = loop;
    loop.start(playhead);
    return () => loop.stop();
  }, [playing, settings.fps, playhead, clipOrder, clips]);

  // --- direct manipulation gizmo ---------------------------------------
  // Lets the selected clip be moved, scaled and rotated by dragging it on the
  // canvas, which is how a layer is positioned in every real NLE. Values are
  // written in project space; the box is expressed as fractions of the canvas
  // so the DOM overlay stays aligned however the canvas is scaled to fit.
  const selected = selection.length === 1 ? clips[selection[0]] : undefined;

  /** Pointer position in project-space pixels, relative to the canvas. */
  const pointerInProject = (clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * settings.width,
      y: ((clientY - rect.top) / rect.height) * settings.height,
    };
  };

  /** Distance from the layer centre to the pointer, in project pixels. */
  const radiusTo = (px: number, py: number, cx: number, cy: number) =>
    Math.hypot(px - cx, py - cy);

  const box = useMemo(() => {
    const b = bounds;
    if (!selected || !b) return null;
    // Bounds are in canvas backing-store pixels. Expressing them as a fraction
    // of that store keeps the overlay aligned regardless of the CSS display
    // scale applied to fit the stage.
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return {
      left: (b.x - b.w / 2) / canvas.width,
      top: (b.y - b.h / 2) / canvas.height,
      width: b.w / canvas.width,
      height: b.h / canvas.height,
      rotation: resolveTransform(selected, playhead).rotation,
    };
  }, [selected, playhead, bounds, compositorReady]);

  const beginMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!selected) return;
    e.preventDefault();
    e.stopPropagation();

    // Double-click enters inline text editing instead of starting a drag.
    // Only text clips are editable in place.
    if (e.detail === 2 && selected.kind === 'text') {
      setEditing(selected.id);
      return;
    }

    const t = resolveTransform(selected, playhead);
    const p = pointerInProject(e.clientX, e.clientY);
    gizmoRef.current = {
      mode: 'move',
      pointerId: e.pointerId,
      startX: p.x,
      startY: p.y,
      originX: t.x,
      originY: t.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const beginScale = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!selected) return;
    e.preventDefault();
    e.stopPropagation();
    const t = resolveTransform(selected, playhead);
    const p = pointerInProject(e.clientX, e.clientY);
    const centreX = settings.width / 2 + t.x;
    const centreY = settings.height / 2 + t.y;
    gizmoRef.current = {
      mode: 'scale',
      pointerId: e.pointerId,
      // Both the start distance and the live distance are measured from the
      // SAME point, so the ratio is a true scale factor.
      startDist: Math.max(1, radiusTo(p.x, p.y, centreX, centreY)),
      originScale: t.scale,
      centreX,
      centreY,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const beginRotate = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!selected) return;
    e.preventDefault();
    e.stopPropagation();
    const t = resolveTransform(selected, playhead);
    const p = pointerInProject(e.clientX, e.clientY);
    const angle =
      (Math.atan2(p.y - (settings.height / 2 + t.y), p.x - (settings.width / 2 + t.x)) * 180) /
      Math.PI;
    gizmoRef.current = {
      mode: 'rotate',
      pointerId: e.pointerId,
      centreAngle: angle,
      originRotation: t.rotation,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  // Window-level listeners keep the gesture alive when the pointer leaves the
  // handle or the canvas entirely.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = gizmoRef.current;
      if (!drag || !selected) return;
      const p = pointerInProject(e.clientX, e.clientY);
      const setTransform = useTimelineStore.getState().setTransform;
      const cx = settings.width / 2;
      const cy = settings.height / 2;

      if (drag.mode === 'move') {
        setTransform(selected.id, {
          x: Math.round(drag.originX + (p.x - drag.startX)),
          y: Math.round(drag.originY + (p.y - drag.startY)),
        });
      } else if (drag.mode === 'scale') {
        // Measured from the SAME centre captured at drag start, so dragging the
        // handle outward genuinely grows the layer.
        const dist = Math.max(1, radiusTo(p.x, p.y, drag.centreX, drag.centreY));
        const next = drag.originScale * (dist / drag.startDist);
        setTransform(selected.id, { scale: Math.max(0.05, Math.min(8, next)) });
      } else {
        const angle = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI;
        setTransform(selected.id, {
          rotation: drag.originRotation + (angle - drag.centreAngle),
        });
      }
    };
    const onUp = () => {
      gizmoRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [selected, settings.width, settings.height]);

  // Display size of the canvas in CSS pixels.
  //
  // The canvas backing store is always full project resolution, but the
  // element on screen must fit the available stage. This used to be pure CSS
  // (`height: 100%`), which stopped working once a wrapper div was added for
  // the gizmo: a percentage height against a shrink-to-fit parent is circular,
  // so the canvas grew to its full 1920px and pushed the panels off-screen.
  // Measuring the stage and computing the size explicitly avoids the cycle.
  const stageRef = useRef<HTMLDivElement>(null);
  const [display, setDisplay] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const pad = 40; // matches .oc-viewport-stage padding on both sides
      const availW = Math.max(1, el.clientWidth - pad);
      const availH = Math.max(1, el.clientHeight - pad);
      const scale = Math.min(availW / settings.width, availH / settings.height);
      setDisplay({
        width: Math.max(1, Math.floor(settings.width * scale)),
        height: Math.max(1, Math.floor(settings.height * scale)),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [settings.width, settings.height]);

  /** Total timeline length in frames, shown as the transport's denominator. */
  const totalFrames = clipOrder.reduce((m, id) => {
    const c = clips[id];
    return c ? Math.max(m, c.start + c.duration) : m;
  }, 0);

  return (
    <div className="oc-viewport">
      <div className="oc-player-head">
        Player-Timeline{' '}
        <span className="oc-player-head-name">01</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, color: 'var(--cc-text-3)' }}>
            {clipOrder.length} clip{clipOrder.length === 1 ? '' : 's'}
          </span>
          <MoreHorizontal size={14} style={{ color: 'var(--cc-text-3)', cursor: 'pointer' }} />
        </span>
      </div>
      <div className="oc-viewport-stage" ref={stageRef}>
        <div
          className="oc-canvas-wrap"
          style={{ width: display.width, height: display.height }}
        >
          <canvas
            ref={canvasRef}
            className="oc-canvas"
            style={{ width: display.width, height: display.height }}
          />

          {/* Inline text editor: double-click a text clip to retype it on the canvas. */}
          {editing && selected?.kind === 'text' && selected.text && box && (
            <textarea
              ref={editRef}
              className="oc-canvas-editor"
              autoFocus
              value={selected.text.content}
              style={{
                left: `${box.left * 100}%`,
                top: `${box.top * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`,
                // The canvas is painted at full project resolution and then
                // scaled down by CSS, whereas this textarea lives in CSS pixels,
                // so the glyph size is derived from the DISPLAY height.
                fontSize: `${((selected.text.fontSize / settings.height) * display.height) *
                  resolveTransform(selected, playhead).scale}px`,
                fontFamily: selected.text.fontFamily,
                fontWeight: selected.text.weight,
              }}
              onChange={(e) =>
                useTimelineStore.getState().setText(selected.id, { content: e.target.value })
              }
              onBlur={() => setEditing(null)}
              onKeyDown={(e) => {
                // Enter commits; Shift+Enter inserts a newline. Escape reverts by
                // simply leaving edit mode, since edits are already applied live.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  setEditing(null);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditing(null);
                }
                e.stopPropagation();
              }}
            />
          )}

          {/* Direct-manipulation overlay for the selected clip. */}
          {selected && box && !editing && (
            <div
              className="oc-gizmo"
              style={{
                left: `${box.left * 100}%`,
                top: `${box.top * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`,
                transform: `rotate(${box.rotation}deg)`,
              }}
              onPointerDown={beginMove}
            >
              <span className="oc-gizmo-label">{selected.name}</span>
              {/* Corner handle scales; the top handle rotates. */}
              <span
                className="oc-gizmo-handle oc-gizmo-scale"
                onPointerDown={(e) => beginScale(e)}
              />
              <span
                className="oc-gizmo-handle oc-gizmo-rotate"
                onPointerDown={(e) => beginRotate(e)}
              />
            </div>
          )}
        </div>
        {clipOrder.length === 0 && (
          <p className="oc-empty-hint">Import media or add text to begin.</p>
        )}
      </div>

      <div className="oc-transport">
        <span className="oc-timecode">
          {formatTimecode(playhead, settings.fps)}
          <span style={{ color: 'var(--cc-text-3)', fontWeight: 400 }}>
            {' '}/ {formatTimecode(totalFrames, settings.fps)}
          </span>
        </span>

        {/* Transport centred — CapCut style */}
        <div className="oc-transport-center">
          <button
            className="oc-btn oc-btn-icon"
            onClick={() => useTimelineStore.getState().setPlayhead(0)}
            title="Go to start"
          >
            <SkipBack size={15} />
          </button>
          <button
            className="oc-btn oc-btn-icon"
            onClick={() => useTimelineStore.getState().step(-1)}
            title="Previous frame"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            className="oc-btn oc-btn-icon oc-btn-primary"
            style={{ width: 36, height: 36 }}
            onClick={() => useTimelineStore.getState().togglePlay()}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            className="oc-btn oc-btn-icon"
            onClick={() => useTimelineStore.getState().step(1)}
            title="Next frame"
          >
            <ChevronRight size={15} />
          </button>
          <button
            className="oc-btn oc-btn-icon"
            onClick={() => useTimelineStore.getState().setPlayhead(totalFrames)}
            title="Go to end"
          >
            <SkipForward size={15} />
          </button>
        </div>

        <span className="oc-dim">
          {settings.width}×{settings.height} @ {settings.fps}fps
        </span>
      </div>
    </div>
  );
};
