import { create } from 'zustand';
import type { ProjectState } from './useTimelineStore';

export interface HistoryEntry<T> {
  label: string;
  /**
   * Full project snapshot, or null for the initial "empty history" seed that
   * precedes the first real snapshot.
   */
  state: T | null;
}

export interface HistoryState<T> {
  /** Newest last. May contain a single null seed entry before any commit. */
  past: HistoryEntry<T>[];
  future: HistoryEntry<T>[];
  present: T | null;
  /** Record a new present state, labelling the undo step that reverts to it. */
  commit: (label: string, next: T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** Labels of available undo steps, newest first (for tooltips). */
  undoLabels: () => string[];
  reset: (initial: T) => void;
}

/** How many undo steps to retain. */
const LIMIT = 100;

/**
 * Undo/redo stack for the timeline project.
 *
 * Snapshots are stored wholesale rather than as inverse patches. Editing
 * operations touch many clips at once (ripple delete, split, speed changes),
 * and a patch-based approach would need a bespoke inverse for each one.
 *
 * Note this store holds no React state of its own; components subscribe to
 * `past`/`future` lengths to drive disabled states on Undo/Redo buttons.
 */
export const useHistoryStore = create<HistoryState<ProjectState>>((set, get) => ({
  past: [],
  future: [],
  present: null,

  /**
   * Commit a new present state. The CURRENT present becomes the undo target,
   * so callers mutate the timeline store first, then commit the snapshot.
   */
  commit: (label, next) =>
    set((state) => ({
      past: [...state.past, { label, state: state.present }].slice(-LIMIT),
      present: next,
      future: [],
    })),

  undo: () => {
    const { past, present } = get();
    if (past.length === 0 || present === null) return;
    const previous = past[past.length - 1];
    // Reverting past the null seed would leave no project to restore, so the
    // stack bottoms out at the first real snapshot instead.
    if (previous.state === null) {
      set({ past: [], future: [{ label: previous.label, state: present }, ...get().future].slice(0, LIMIT) });
      return;
    }
    set({
      past: past.slice(0, -1),
      present: previous.state,
      future: [{ label: previous.label, state: present }, ...get().future].slice(0, LIMIT),
    });
  },

  redo: () => {
    const { future, present } = get();
    if (future.length === 0 || present === null) return;
    const next = future[0];
    if (next.state === null) return;
    set({
      past: [...get().past, { label: next.label, state: present }].slice(-LIMIT),
      present: next.state,
      future: future.slice(1),
    });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
  undoLabels: () => get().past.map((e) => e.label).reverse(),
  reset: (initial) => set({ past: [], future: [], present: initial }),
}));
