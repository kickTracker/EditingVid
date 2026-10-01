import { useEffect, useCallback, useRef, useState } from 'react';
import {
  Film, Music, Type, Sparkles, Zap, Captions, Filter, Sliders,
  LayoutTemplate, Bot, Undo2, Redo2, ChevronDown,
} from 'lucide-react';
import { useTimelineStore } from './store/useTimelineStore';
import { useHistoryStore } from './store/useHistoryStore';
import { Library } from './components/Library/Library';
import { Viewport } from './components/Viewport/Viewport';
import { Timeline } from './components/Timeline/Timeline';
import { Inspector } from './components/Inspector/Inspector';
import { ExportDialog } from './components/Common/ExportDialog';

/** Top-bar tab entries, exactly mirroring CapCut's icon strip. */
const TOP_TABS = [
  { id: 'media',      icon: Film,           label: 'Media' },
  { id: 'audio',      icon: Music,          label: 'Audio' },
  { id: 'text',       icon: Type,           label: 'Text' },
  { id: 'stickers',   icon: Sparkles,       label: 'Stickers' },
  { id: 'effects',    icon: Zap,            label: 'Effects' },
  { id: 'transitions',icon: Zap,            label: 'Transitions' },
  { id: 'captions',   icon: Captions,       label: 'Captions' },
  { id: 'filters',    icon: Filter,         label: 'Filters' },
  { id: 'adjustment', icon: Sliders,        label: 'Adjustment' },
  { id: 'templates',  icon: LayoutTemplate, label: 'Templates' },
  { id: 'ai',         icon: Bot,            label: 'AI avatar' },
] as const;

type TopTab = (typeof TOP_TABS)[number]['id'];

export const App = () => {
  const [activeTab, setActiveTab] = useState<TopTab>('media');
  const [showExport, setShowExport] = useState(false);

  const past   = useHistoryStore((s) => s.past.length);
  const future = useHistoryStore((s) => s.future.length);
  const restore = useTimelineStore((s) => s.restore);
  const projectName = useTimelineStore((s) => s.settings.name);

  /** Feed the document into the history stack (subscription, not inside the store). */
  const lastDoc = useRef<string | null>(null);
  useEffect(() => {
    const initial = useTimelineStore.getState().snapshot();
    lastDoc.current = JSON.stringify(initial);
    useHistoryStore.getState().reset(initial);

    const unsubscribe = useTimelineStore.subscribe((state) => {
      const doc = JSON.stringify(state.snapshot());
      if (doc === lastDoc.current) return;
      lastDoc.current = doc;
      useHistoryStore.getState().commit('Edit', state.snapshot());
    });
    return unsubscribe;
  }, []);

  const onUndo = useCallback(() => {
    const history = useHistoryStore.getState();
    if (history.past.length === 0) return;
    history.undo();
    const next = useHistoryStore.getState().present;
    if (next) { restore(next); lastDoc.current = JSON.stringify(next); }
  }, [restore]);

  const onRedo = useCallback(() => {
    const history = useHistoryStore.getState();
    if (history.future.length === 0) return;
    history.redo();
    const next = useHistoryStore.getState().present;
    if (next) { restore(next); lastDoc.current = JSON.stringify(next); }
  }, [restore]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) onRedo(); else onUndo();
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyB') {
        e.preventDefault();
        useTimelineStore.getState().splitAtPlayhead();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onUndo, onRedo]);

  return (
    <div className="oc-app">

      {/* ── Top bar ────────────────────────────────────────── */}
      <header className="oc-topbar">

        {/* Logo + Menu */}
        <div className="oc-brand-wrap">
          <h1 className="oc-brand">CapCut</h1>
          <button className="oc-menu-btn">
            Menu <ChevronDown size={12} />
          </button>
        </div>

        {/* Icon tab strip */}
        <nav className="oc-tabstrip">
          {TOP_TABS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              id={`tab-${id}`}
              className={`oc-tab${activeTab === id ? ' is-active' : ''}`}
              onClick={() => setActiveTab(id as TopTab)}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {/* Centred project name */}
        <span className="oc-topbar-title">{projectName}</span>

        {/* Right-side actions */}
        <div className="oc-topbar-actions">
          <button className="oc-btn oc-btn-icon" disabled={past === 0} onClick={onUndo} title="Undo (Ctrl+Z)">
            <Undo2 size={14} />
          </button>
          <button className="oc-btn oc-btn-icon" disabled={future === 0} onClick={onRedo} title="Redo (Ctrl+Shift+Z)">
            <Redo2 size={14} />
          </button>
          <button className="oc-btn oc-btn-primary" onClick={() => setShowExport(true)}>
            Export
          </button>
        </div>
      </header>

      {/* ── Main area ──────────────────────────────────────── */}
      <main className="oc-main">
        {/* Library passes the active top-tab so it can show the right content */}
        <Library activeTab={activeTab} />
        <Viewport />
        <Inspector />
      </main>

      {/* ── Timeline ───────────────────────────────────────── */}
      <Timeline />

      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
    </div>
  );
};
