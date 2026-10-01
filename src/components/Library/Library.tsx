import { useState } from 'react';
import {
  Sparkles, Users, Video,
  Music, Sliders, Zap, LayoutTemplate, Bot, Captions,
  FolderOpen, Plus,
} from 'lucide-react';
import { useTimelineStore } from '../../store/useTimelineStore';
import { useFontStore } from '../../store/useFontStore';
import { FileButton } from '../Common/controls';
import { importFiles, addTextAtPlayhead } from './mediaImport';
import { TEXT_PRESETS } from '../../engine/presets';

/** Common delivery sizes, also surfaced in the Details panel. */
export const ASPECT_PRESETS: { label: string; width: number; height: number }[] = [
  { label: '9:16 Vertical',   width: 1080, height: 1920 },
  { label: '16:9 Landscape',  width: 1920, height: 1080 },
  { label: '1:1 Square',      width: 1080, height: 1080 },
  { label: '4:5 Portrait',    width: 1080, height: 1350 },
  { label: '4:3 Classic',     width: 1440, height: 1080 },
  { label: '21:9 Cinema',     width: 2560, height: 1080 },
];

interface LibraryProps {
  activeTab: string;
}

export const Library = ({ activeTab }: LibraryProps) => {
  const [status, setStatus]   = useState<string | null>(null);
  const addFiles = useFontStore((s) => s.addFiles);
  const fonts    = useFontStore((s) => s.fonts);
  const clipCount = useTimelineStore((s) => s.clipOrder.length);

  const handleMedia = async (files: File[]) => {
    const { settings: s, playhead } = useTimelineStore.getState();
    setStatus('Importing…');
    const { added, errors } = await importFiles(files, s.fps, { startAt: playhead });
    setStatus(
      errors.length > 0
        ? `${added} added, ${errors.length} failed: ${errors[0]}`
        : `Imported ${added} file${added === 1 ? '' : 's'}.`,
    );
  };

  const handleText = () => {
    const id = addTextAtPlayhead();
    useTimelineStore.getState().select([id]);
    setStatus('Text clip added.');
  };

  // ── Media tab ─────────────────────────────────────────────
  const MediaTab = () => (
    <>
      {/* Subprojects / nav row, exactly like CapCut */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <button className="oc-btn" style={{ fontSize: 11, padding: '3px 10px' }}>
          Import
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
        {[
          { label: 'Subprojects' },
          { label: 'Yours',   icon: <FolderOpen size={12} /> },
          { label: 'Generate', icon: <Sparkles size={12} />, teal: true },
          { label: 'Spaces' },
          { label: 'Library' },
        ].map((item) => (
          <button
            key={item.label}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '5px 8px', borderRadius: 4,
              background: 'var(--cc-panel-2)', border: '1px solid var(--cc-border)',
              fontSize: 11, color: item.teal ? 'var(--cc-teal)' : 'var(--cc-text-2)',
              cursor: 'pointer',
            }}
          >
            {item.label}
            {item.icon && <span>{item.icon}</span>}
          </button>
        ))}
      </div>

      {/* Main drop zone */}
      <label className="oc-dropzone">
        <Plus size={28} style={{ color: 'var(--cc-teal)' }} />
        <span className="oc-dropzone-title">
          {clipCount === 0 ? 'Import' : 'Add media'}
        </span>
        <span>Drag and drop videos, photos, and audio files here</span>
        <input
          type="file"
          accept="video/*,image/*,audio/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) void handleMedia(files);
            e.target.value = '';
          }}
        />
      </label>

      <div className="oc-divider-label">
        <span />
        No media? Create with these tools
        <span />
      </div>

      <div className="oc-tool-row">
        <button className="oc-tool-card">
          <Sparkles size={18} />
          Generate
        </button>
        <button className="oc-tool-card">
          <Users size={18} />
          AI avatars
        </button>
        <button className="oc-tool-card">
          <Video size={18} />
          Record
        </button>
      </div>

      {/* Font upload section */}
      <div className="oc-library-section" style={{ marginTop: 16 }}>
        <h3 className="oc-library-heading">Fonts</h3>
        <FileButton
          label="Upload font (.ttf / .otf / .woff2)"
          accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf"
          multiple
          onFiles={(f) => void addFiles(f)}
        />
        {fonts.length > 0 && (
          <ul className="oc-font-list">
            {fonts.map((f) => (
              <li key={f.id}>
                <span style={{ fontFamily: `"${f.family}"` }}>{f.name}</span>
                <small>{f.fileName}</small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );

  // ── Text tab ──────────────────────────────────────────────
  const TextTab = () => (
    <>
      <button
        className="oc-btn"
        style={{ width: '100%', justifyContent: 'center', marginBottom: 12 }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-opencap-text', 'text');
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={handleText}
      >
        <Plus size={14} /> Add text
      </button>

      <div className="oc-library-section">
        <h3 className="oc-library-heading">Text effects</h3>
        <p className="oc-hint">Click a preset to apply it to a selected text clip.</p>
      </div>

      <div className="oc-library-section">
        <h3 className="oc-library-heading">Presets</h3>
        <div className="oc-preset-grid">
          {TEXT_PRESETS.map((p) => (
            <button
              key={p.id}
              className="oc-preset"
              title={`Apply ${p.label}`}
              onClick={() => {
                const sel = useTimelineStore.getState().selection[0];
                if (!sel) { setStatus('Select a text clip first.'); return; }
                useTimelineStore.getState().setText(sel, p.patch);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );

  // ── Audio tab ─────────────────────────────────────────────
  const AudioTab = () => (
    <div className="oc-library-section">
      <h3 className="oc-library-heading">Audio</h3>
      <label className="oc-dropzone" style={{ minHeight: 100 }}>
        <Music size={22} style={{ color: 'var(--cc-teal)' }} />
        <span className="oc-dropzone-title">Add audio</span>
        <span>Drag and drop audio files here</span>
        <input
          type="file" accept="audio/*" multiple hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) void handleMedia(files);
            e.target.value = '';
          }}
        />
      </label>
    </div>
  );

  // ── Placeholder for other tabs ────────────────────────────
  const PlaceholderTab = ({ label, icon: Icon }: { label: string; icon: React.ElementType }) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '32px 16px', color: 'var(--cc-text-3)' }}>
      <Icon size={32} style={{ opacity: 0.4 }} />
      <p style={{ fontSize: 12, textAlign: 'center', lineHeight: 1.6 }}>
        {label} coming soon
      </p>
    </div>
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'media':       return <MediaTab />;
      case 'text':        return <TextTab />;
      case 'audio':       return <AudioTab />;
      case 'filters':     return (
        <div className="oc-library-section">
          <h3 className="oc-library-heading">Looks</h3>
          <p className="oc-hint">Colour looks live in the Details panel. Select a clip to apply one.</p>
        </div>
      );
      case 'stickers':    return <PlaceholderTab label="Stickers" icon={Sparkles} />;
      case 'effects':     return <PlaceholderTab label="Effects" icon={Zap} />;
      case 'transitions': return <PlaceholderTab label="Transitions" icon={Zap} />;
      case 'captions':    return <PlaceholderTab label="Captions" icon={Captions} />;
      case 'adjustment':  return <PlaceholderTab label="Adjustment" icon={Sliders} />;
      case 'templates':   return <PlaceholderTab label="Templates" icon={LayoutTemplate} />;
      case 'ai':          return <PlaceholderTab label="AI Avatar" icon={Bot} />;
      default:            return <MediaTab />;
    }
  };

  return (
    <aside className="oc-library">
      <div className="oc-library-inner">
        {renderContent()}
        {status && <p className="oc-status">{status}</p>}
      </div>
    </aside>
  );
};
