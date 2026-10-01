import { useMemo, useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import { useTimelineStore } from '../../store/useTimelineStore';
import { buildExportScript, projectDurationFrames } from '../../engine/ffmpegBuilder';
import type { ExportOptions } from '../../engine/ffmpegBuilder';
import { formatTimecode } from '../Library/mediaImport';

const ENCODERS: { value: ExportOptions['encoder']; label: string }[] = [
  { value: 'h264',             label: 'H.264 (libx264, CPU)' },
  { value: 'h264_nvenc',       label: 'H.264 NVENC (NVIDIA)' },
  { value: 'h264_qsv',         label: 'H.264 QuickSync (Intel)' },
  { value: 'h264_videotoolbox',label: 'H.264 VideoToolbox (macOS)' },
];

export const ExportDialog = ({ onClose }: { onClose: () => void }) => {
  const [encoder, setEncoder] = useState<ExportOptions['encoder']>('h264');
  const [crf, setCrf]         = useState(18);
  const [outputPath, setOutputPath] = useState('output.mp4');
  const [copied, setCopied]   = useState(false);

  const settings = useTimelineStore((s) => s.settings);
  const snapshot = useTimelineStore((s) => s.snapshot());

  const script = useMemo(
    () => buildExportScript(snapshot, { encoder, crf, preset: 'medium', outputPath }),
    [snapshot, encoder, crf, outputPath],
  );

  const frames   = projectDurationFrames(snapshot);
  const duration = formatTimecode(frames, settings.fps);
  const clipCount = snapshot.clipOrder.length;

  return (
    <div className="oc-dialog-backdrop" onClick={onClose}>
      <div className="oc-dialog" onClick={(e) => e.stopPropagation()}>

        <div className="oc-dialog-header">
          <span>Export</span>
          <button
            onClick={onClose}
            style={{ background: 'transparent', color: 'var(--cc-text-2)', padding: 4, borderRadius: 4 }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="oc-dialog-body">
          <p className="oc-hint" style={{ marginBottom: 14 }}>
            {clipCount === 0
              ? 'The timeline is empty. The command below renders a single frame of background colour.'
              : `${clipCount} clip${clipCount === 1 ? '' : 's'} · ${duration} at ${settings.fps} fps`}
          </p>

          <label className="oc-field" style={{ marginBottom: 8 }}>
            <span className="oc-field-label">Encoder</span>
            <select value={encoder} onChange={(e) => setEncoder(e.target.value as ExportOptions['encoder'])}>
              {ENCODERS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          <label className="oc-field" style={{ marginBottom: 8 }}>
            <span className="oc-field-label">Quality (CRF)</span>
            <input type="range" min={14} max={30} value={crf} onChange={(e) => setCrf(Number(e.target.value))} />
            <span className="oc-field-value">{crf}</span>
          </label>

          <label className="oc-field" style={{ marginBottom: 14 }}>
            <span className="oc-field-label">Output file</span>
            <input type="text" value={outputPath} onChange={(e) => setOutputPath(e.target.value)} />
          </label>

          <p className="oc-hint" style={{ marginBottom: 10 }}>
            In-app rendering requires the Tauri sidecar (not compiled). Copy the command below and run it in a terminal.
          </p>

          <pre className="oc-code">{script}</pre>
        </div>

        <div className="oc-dialog-footer">
          <button
            className="oc-btn"
            onClick={() => {
              void navigator.clipboard?.writeText(script);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied!' : 'Copy command'}
          </button>
          <button className="oc-btn oc-btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
