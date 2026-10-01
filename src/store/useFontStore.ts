import { create } from 'zustand';
import { loadFontFile, unloadFont, type LoadedFont } from '../engine/fontLoader';

interface FontState {
  fonts: LoadedFont[];
  loading: boolean;
  error: string | null;
  addFiles: (files: File[]) => Promise<void>;
  remove: (id: string) => void;
  clearError: () => void;
}

/** System families offered alongside any uploaded fonts. */
export const SYSTEM_FONTS = [
  'Inter',
  'Arial',
  'Helvetica',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Impact',
  'Verdana',
] as const;

export const useFontStore = create<FontState>((set) => ({
  fonts: [],
  loading: false,
  error: null,

  addFiles: async (files) => {
    set({ loading: true, error: null });
    const added: LoadedFont[] = [];
    for (const file of files) {
      try {
        added.push(await loadFontFile(file));
      } catch (err) {
        // Keep the good fonts even when one file fails to parse.
        set({ error: err instanceof Error ? err.message : String(err) });
      }
    }
    set((s) => ({ fonts: [...s.fonts, ...added], loading: false }));
  },

  remove: (id) => {
    unloadFont(id);
    set((s) => ({ fonts: s.fonts.filter((f) => f.id !== id) }));
  },

  clearError: () => set({ error: null }),
}));
