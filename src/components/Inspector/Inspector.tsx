import { useState } from 'react';
import { useTimelineStore } from '../../store/useTimelineStore';
import { useFontStore, SYSTEM_FONTS } from '../../store/useFontStore';
import { evaluateKeyframes } from '../../engine/keyframeEngine';
import { FILTER_PRESETS, TEXT_PRESETS } from '../../engine/presets';
import { Checkbox, ColorField, Panel, Select, Slider } from '../Common/controls';
import { ASPECT_PRESETS } from '../Library/Library';
import type { AnimatableKey, TextAnimation, TransitionType } from '../../types/timeline';

const ANIM_OPTIONS: { value: TextAnimation; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'typewriter', label: 'Typewriter' },
  { value: 'bounce', label: 'Bounce' },
  { value: 'fade', label: 'Fade' },
  { value: 'glitch', label: 'Glitch' },
  { value: 'flip', label: 'Flip' },
];

/** Transitions offered between two adjacent clips. */
const TRANSITION_OPTIONS: { value: TransitionType; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Dissolve' },
  { value: 'wipe-left', label: 'Wipe left' },
  { value: 'wipe-right', label: 'Wipe right' },
  { value: 'slide-up', label: 'Slide up' },
  { value: 'slide-down', label: 'Slide down' },
  { value: 'blur', label: 'Blur' },
  { value: 'zoom', label: 'Zoom' },
];

/** Transform properties that can be keyframed, with sensible ranges. */
const KEY_PROPS: { key: AnimatableKey; label: string; min: number; max: number }[] = [
  { key: 'x', label: 'X', min: -1080, max: 1080 },
  { key: 'y', label: 'Y', min: -1920, max: 1920 },
  { key: 'scale', label: 'Scale', min: 0.1, max: 4 },
  { key: 'rotation', label: 'Rotate', min: -360, max: 360 },
  { key: 'opacity', label: 'Opacity', min: 0, max: 1 },
];

export const Inspector = () => {
  const selection = useTimelineStore((s) => s.selection);
  const clips = useTimelineStore((s) => s.clips);
  const playhead = useTimelineStore((s) => s.playhead);
  const settings = useTimelineStore((s) => s.settings);
  const fonts = useFontStore((s) => s.fonts);

  const setTransform = useTimelineStore((s) => s.setTransform);
  const setColor = useTimelineStore((s) => s.setColor);
  const setText = useTimelineStore((s) => s.setText);
  const setSpeed = useTimelineStore((s) => s.setSpeed);
  const setVolume = useTimelineStore((s) => s.setVolume);
  const setPan = useTimelineStore((s) => s.setPan);
  const toggleMute = useTimelineStore((s) => s.toggleMute);
  const addKeyframe = useTimelineStore((s) => s.addKeyframe);
  const updateClip = useTimelineStore((s) => s.updateClip);
  const setTransition = useTimelineStore((s) => s.setTransition);

  const clip = selection[0] ? clips[selection[0]] : undefined;
  const setAspectRatio = useTimelineStore((s) => s.setAspectRatio);
  const setSettings = useTimelineStore((s) => s.setSettings);
  const clipCount = useTimelineStore((s) => s.clipOrder.length);
  const [editing, setEditing] = useState(false);

  const matched = ASPECT_PRESETS.find(
    (p) => p.width === settings.width && p.height === settings.height,
  );

  /**
   * With nothing selected the panel shows project settings, which is where
   * CapCut keeps aspect ratio and frame rate.
   */
  if (!clip) {
    return (
      <aside className="oc-inspector">
        <header className="oc-inspector-header">
          <strong>Details</strong>
        </header>
        <div className="oc-inspector-body">
          {editing ? (
            <>
              <div className="oc-field">
                <span className="oc-field-label">Name</span>
                <input
                  type="text"
                  value={settings.name}
                  onChange={(e) => setSettings({ name: e.target.value })}
                />
              </div>
              <div className="oc-field">
                <span className="oc-field-label">Frame rate</span>
                <select
                  value={String(settings.fps)}
                  onChange={(e) => setSettings({ fps: Number(e.target.value) })}
                >
                  {[24, 25, 30, 50, 60].map((f) => (
                    <option key={f} value={f}>
                      {f.toFixed(2)} fps
                    </option>
                  ))}
                </select>
              </div>
              <div className="oc-field">
                <span className="oc-field-label">Aspect ratio</span>
                <select
                  value={matched?.label ?? 'custom'}
                  onChange={(e) => {
                    const preset = ASPECT_PRESETS.find((p) => p.label === e.target.value);
                    if (preset) setAspectRatio(preset.width, preset.height);
                  }}
                >
                  {ASPECT_PRESETS.map((p) => (
                    <option key={p.label} value={p.label}>
                      {p.label} ({p.width}×{p.height})
                    </option>
                  ))}
                </select>
              </div>
              <div className="oc-field-group" style={{ marginBottom: 10 }}>
                <label className="oc-field" style={{ flex: 1 }}>
                  <span className="oc-field-label">Width</span>
                  <input
                    type="number"
                    step={2}
                    value={settings.width}
                    onChange={(e) => setAspectRatio(Number(e.target.value) || 16, settings.height)}
                  />
                </label>
                <label className="oc-field" style={{ flex: 1 }}>
                  <span className="oc-field-label">Height</span>
                  <input
                    type="number"
                    step={2}
                    value={settings.height}
                    onChange={(e) => setAspectRatio(settings.width, Number(e.target.value) || 16)}
                  />
                </label>
              </div>
              <div className="oc-field">
                <span className="oc-field-label">Sample rate</span>
                <select
                  value={String(settings.sampleRate)}
                  onChange={(e) => setSettings({ sampleRate: Number(e.target.value) })}
                >
                  {[44100, 48000].map((r) => (
                    <option key={r} value={r}>
                      {r / 1000} kHz
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="oc-btn oc-btn-primary"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => setEditing(false)}
              >
                Done
              </button>
            </>
          ) : (
            <>
              <div className="oc-row">
                <span className="oc-row-label">Name:</span>
                <span className="oc-row-value">{settings.name}</span>
              </div>
              <div className="oc-row">
                <span className="oc-row-label">Imported media:</span>
                <span className="oc-row-value">Stay in original location</span>
              </div>
              <div className="oc-row">
                <span className="oc-row-label">Arrange layers</span>
                <span className="oc-row-value">Turned on</span>
              </div>
              <div className="oc-divider" />
              <div className="oc-row">
                <span className="oc-row-label">Timeline name</span>
                <span className="oc-row-value">Timeline 01</span>
              </div>
              <div className="oc-row">
                <span className="oc-row-label">Aspect ratio:</span>
                <span className="oc-row-value">{matched?.label ?? 'Custom'}</span>
              </div>
              <div className="oc-row">
                <span className="oc-row-label">Resolution:</span>
                <span className="oc-row-value">
                  {settings.width} × {settings.height}
                </span>
              </div>
              <div className="oc-row">
                <span className="oc-row-label">Frame rate:</span>
                <span className="oc-row-value">{settings.fps.toFixed(2)} fps</span>
              </div>
              <div className="oc-row">
                <span className="oc-row-label">Clips</span>
                <span className="oc-row-value">{clipCount}</span>
              </div>
              <p className="oc-hint">Select a clip to edit its properties.</p>
            </>
          )}
        </div>

        {/* Modify lives in a pinned footer, exactly like CapCut. */}
        <footer className="oc-inspector-foot">
          <button className="oc-btn" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Cancel' : 'Modify'}
          </button>
        </footer>
      </aside>
    );
  }

  const local = playhead - clip.start;
  const isMedia = clip.kind === 'video' || clip.kind === 'audio' || clip.kind === 'image';
  const isAudio = clip.kind === 'audio';
  const fontFamilies = [
    ...SYSTEM_FONTS.map((f) => ({ value: f, label: f })),
    ...fonts.map((f) => ({ value: f.id, label: `${f.name} (uploaded)` })),
  ];

  return (
    <aside className="oc-inspector">
      <header className="oc-inspector-header">
        <strong>Details</strong>
        <span className="oc-dim">
          {clip.kind} · {clip.duration}f @ {clip.speed}x
        </span>
      </header>

      <div className="oc-inspector-body">

      {isMedia && (
        <Panel title="Timing">
          <Slider
            label="Speed"
            value={clip.speed}
            min={0.1}
            max={100}
            step={0.1}
            onChange={(v) => setSpeed(clip.id, v)}
            format={(v) => `${v.toFixed(2)}x`}
          />
          {/* Fades are stored in frames but edited in seconds, which is the
              unit editors actually think in. A long clip would otherwise show
              an unreadable frame count like "38730f". */}
          <Slider
            label="Fade in"
            value={clip.fadeIn / settings.fps}
            min={0}
            max={Math.max(0.1, (clip.duration / settings.fps) / 2)}
            step={0.1}
            onChange={(v) => updateClip(clip.id, { fadeIn: Math.round(v * settings.fps) })}
            format={(v) => `${v.toFixed(1)}s`}
          />
          <Slider
            label="Fade out"
            value={clip.fadeOut / settings.fps}
            min={0}
            max={Math.max(0.1, (clip.duration / settings.fps) / 2)}
            step={0.1}
            onChange={(v) => updateClip(clip.id, { fadeOut: Math.round(v * settings.fps) })}
            format={(v) => `${v.toFixed(1)}s`}
          />
        </Panel>
      )}

      {!isAudio && (
        <Panel title="Transform">
          {KEY_PROPS.map((p) => {
            const animated = evaluateKeyframes(clip.keyframes[p.key], local, clip.transform[p.key]);
            const existing = clip.keyframes[p.key]?.find((k) => k.frame === local);
            return (
              <div key={p.key} className="oc-field-group">
                <Slider
                  label={p.label}
                  value={animated}
                  min={p.min}
                  max={p.max}
                  step={p.key === 'scale' || p.key === 'opacity' ? 0.01 : 1}
                  onChange={(v) => setTransform(clip.id, { [p.key]: v })}
                  format={(v) => v.toFixed(2)}
                />
                <button
                  className={`oc-keyframe-btn${existing ? ' is-on' : ''}`}
                  title={
                    existing
                      ? `Keyframe set at frame ${local}`
                      : `Add keyframe at frame ${Math.max(0, local)}`
                  }
                  onClick={() => addKeyframe(clip.id, p.key, Math.max(0, local), animated)}
                >
                  ◆
                </button>
              </div>
            );
          })}
        </Panel>
      )}

      {!isAudio && (
        <Panel title="Color">
          <div className="oc-preset-grid">
            {FILTER_PRESETS.map((p) => (
              <button
                key={p.id}
                className="oc-preset"
                title={`Apply ${p.label} look`}
                onClick={() => setColor(clip.id, p.patch)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Slider label="Brightness" value={clip.color.brightness} min={-1} max={1} onChange={(v) => setColor(clip.id, { brightness: v })} />
          <Slider label="Contrast" value={clip.color.contrast} min={-1} max={1} onChange={(v) => setColor(clip.id, { contrast: v })} />
          <Slider label="Saturation" value={clip.color.saturation} min={0} max={3} onChange={(v) => setColor(clip.id, { saturation: v })} />
          <Slider label="Exposure" value={clip.color.exposure} min={-3} max={3} onChange={(v) => setColor(clip.id, { exposure: v })} />
          <Slider label="Temperature" value={clip.color.temperature} min={-100} max={100} step={1} onChange={(v) => setColor(clip.id, { temperature: v })} />
          <Slider label="Vignette" value={clip.color.vignette} min={0} max={1} onChange={(v) => setColor(clip.id, { vignette: v })} />
        </Panel>
      )}

      {clip.src && (
        <Panel title="Chroma Key">
          <Checkbox
            label="Enable"
            checked={clip.chromaKey.enabled}
            onChange={(v) => updateClip(clip.id, { chromaKey: { ...clip.chromaKey, enabled: v } })}
          />
          <ColorField
            label="Key color"
            value={clip.chromaKey.color}
            onChange={(v) => updateClip(clip.id, { chromaKey: { ...clip.chromaKey, color: v } })}
          />
          <Slider label="Similarity" value={clip.chromaKey.similarity} min={0} max={1} onChange={(v) => updateClip(clip.id, { chromaKey: { ...clip.chromaKey, similarity: v } })} />
          <Slider label="Smoothness" value={clip.chromaKey.smoothness} min={0} max={1} onChange={(v) => updateClip(clip.id, { chromaKey: { ...clip.chromaKey, smoothness: v } })} />
        </Panel>
      )}


      {(clip.kind === 'video' || clip.kind === 'audio') && (
        <Panel title="Audio">
          <Checkbox label="Mute" checked={clip.muted} onChange={() => toggleMute(clip.id)} />
          <Slider label="Volume" value={clip.volume} min={0} max={2} onChange={(v) => setVolume(clip.id, v)} />
          <Slider label="Pan" value={clip.pan} min={-1} max={1} onChange={(v) => setPan(clip.id, v)} />
        </Panel>
      )}

      {clip.src && (
        <Panel title="Transition">
          <p className="oc-hint">
            Applied at the start of this clip, where it meets the previous one.
            Previewed in the canvas; export support is pending.
          </p>
          <Select
            label="In transition"
            value={clip.transitionIn?.type ?? 'none'}
            options={TRANSITION_OPTIONS}
            onChange={(v) =>
              setTransition(
                clip.id,
                'in',
                v === 'none' ? null : { type: v, duration: clip.transitionIn?.duration ?? 15 },
              )
            }
          />
          {clip.transitionIn && clip.transitionIn.type !== 'none' && (
            <Slider
              label="Length"
              value={clip.transitionIn.duration}
              min={1}
              max={Math.max(2, Math.floor(clip.duration / 2))}
              step={1}
              onChange={(v) =>
                setTransition(clip.id, 'in', { type: clip.transitionIn!.type, duration: v })
              }
              format={(v) => `${Math.round(v)}f`}
            />
          )}
        </Panel>
      )}

      {clip.text && (
        <Panel title="Text">
          {/* One-click looks: CapCut's signature style comes from presets, not
              from hand-tuning a dozen sliders. */}
          <div className="oc-preset-grid">
            {TEXT_PRESETS.map((p) => (
              <button
                key={p.id}
                className="oc-preset"
                title={`Apply ${p.label} style`}
                onClick={() => setText(clip.id, p.patch)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <textarea
            className="oc-textarea"
            value={clip.text.content}
            onChange={(e) => setText(clip.id, { content: e.target.value })}
            rows={3}
          />
          <Select
            label="Font"
            value={(clip.text.customFontId ?? clip.text.fontFamily) as string}
            options={fontFamilies}
            onChange={(v) => {
              const custom = fonts.find((f) => f.id === v);
              // Both fields must be written: `fontFamily` is what the canvas and
              // FFmpeg actually render with, while `customFontId` records that
              // the face came from an upload.
              setText(
                clip.id,
                custom
                  ? { customFontId: v, fontFamily: custom.family }
                  : { fontFamily: v, customFontId: undefined },
              );
            }}
          />
          <Slider label="Size" value={clip.text.fontSize} min={8} max={300} step={1} onChange={(v) => setText(clip.id, { fontSize: v })} />
          <ColorField label="Color" value={clip.text.color} onChange={(v) => setText(clip.id, { color: v })} />
          <Slider label="Weight" value={clip.text.weight} min={100} max={900} step={100} onChange={(v) => setText(clip.id, { weight: v })} />
          <Select
            label="Align"
            value={clip.text.align}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Center' },
              { value: 'right', label: 'Right' },
            ]}
            onChange={(v) => setText(clip.id, { align: v })}
          />

          {/* Stroke */}
          <Slider label="Stroke width" value={clip.text.strokeWidth} min={0} max={20} step={1} onChange={(v) => setText(clip.id, { strokeWidth: v })} />
          <ColorField label="Stroke color" value={clip.text.strokeColor} onChange={(v) => setText(clip.id, { strokeColor: v })} />

          {/* Shadow */}
          <Slider label="Shadow blur" value={clip.text.shadowBlur} min={0} max={100} step={1} onChange={(v) => setText(clip.id, { shadowBlur: v })} />
          <ColorField label="Shadow color" value={clip.text.shadowColor} onChange={(v) => setText(clip.id, { shadowColor: v })} />
          <Slider label="Shadow X" value={clip.text.shadowOffsetX} min={-100} max={100} step={1} onChange={(v) => setText(clip.id, { shadowOffsetX: v })} />
          <Slider label="Shadow Y" value={clip.text.shadowOffsetY} min={-100} max={100} step={1} onChange={(v) => setText(clip.id, { shadowOffsetY: v })} />

          {/* Glow */}
          <Slider label="Glow blur" value={clip.text.glowBlur} min={0} max={100} step={1} onChange={(v) => setText(clip.id, { glowBlur: v })} />
          <ColorField label="Glow color" value={clip.text.glowColor} onChange={(v) => setText(clip.id, { glowColor: v })} />

          {/* Gradient. Enabling it without exposing the two stops made the
              toggle useless: there was no way to choose the colours. */}
          <Checkbox label="Gradient fill" checked={clip.text.gradientEnabled} onChange={(v) => setText(clip.id, { gradientEnabled: v })} />
          {clip.text.gradientEnabled && (
            <>
              <ColorField label="Gradient from" value={clip.text.gradientFrom} onChange={(v) => setText(clip.id, { gradientFrom: v })} />
              <ColorField label="Gradient to" value={clip.text.gradientTo} onChange={(v) => setText(clip.id, { gradientTo: v })} />
            </>
          )}

          {/* Badge */}
          <Checkbox label="Background badge" checked={clip.text.backgroundBadge} onChange={(v) => setText(clip.id, { backgroundBadge: v })} />
          {clip.text.backgroundBadge && (
            <>
              <ColorField label="Badge color" value={clip.text.badgeColor} onChange={(v) => setText(clip.id, { badgeColor: v })} />
              <Slider label="Badge padding" value={clip.text.badgePadding} min={0} max={120} step={1} onChange={(v) => setText(clip.id, { badgePadding: v })} />
            </>
          )}

          <Select label="Animation" value={clip.text.animation} options={ANIM_OPTIONS} onChange={(v) => setText(clip.id, { animation: v })} />
          <Slider
            label="Anim length"
            value={clip.text.animationDuration}
            min={2}
            max={120}
            step={1}
            onChange={(v) => setText(clip.id, { animationDuration: v })}
            format={(v) => `${Math.round(v)}f`}
          />
        </Panel>
      )}
      </div>
    </aside>
  );
};

