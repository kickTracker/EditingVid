/**
 * Registers user-supplied font files with the browser's font engine.
 *
 * Files are converted to object URLs and loaded via the CSS Font Loading API,
 * which makes the family immediately usable by the canvas compositor and the
 * DOM inspector alike.
 */

export interface LoadedFont {
  id: string;
  family: string;
  /** Original filename, shown in the font picker. */
  name: string;
  fileName: string;
  weight: number;
  italic: boolean;
}

/** Accepted by the browser's font parser. */
const FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2'];

const readMeta = (file: File): Promise<{ family: string; weight: number; italic: boolean }> => {
  // Parse just enough of the table directory to name the family, falling back
  // to the filename when the file is not a TrueType/OpenType container.
  return file.arrayBuffer().then((buffer) => {
    try {
      const view = new DataView(buffer);
      const numTables = view.getUint16(4);
      for (let i = 0; i < numTables; i++) {
        const rec = 12 + i * 16;
        const tag = String.fromCharCode(
          view.getUint8(rec), view.getUint8(rec + 1),
          view.getUint8(rec + 2), view.getUint8(rec + 3),
        );
        if (tag === 'name') {
          const nameOffset = view.getUint32(rec + 8);
          const count = view.getUint16(nameOffset + 2);
          const stringOffset = nameOffset + view.getUint16(nameOffset + 4);
          for (let n = 0; n < count; n++) {
            const rec2 = nameOffset + 6 + n * 12;
            const nameId = view.getUint16(rec2 + 6);
            // nameId 1 = family, 16 = typographic family.
            if (nameId === 1 || nameId === 16) {
              const len = view.getUint16(rec2 + 8);
              const off = view.getUint16(rec2 + 10);
              const bytes = new Uint8Array(buffer, stringOffset + off, len);
              const text = new TextDecoder().decode(bytes);
              if (text.trim()) return { family: text.trim(), weight: 400, italic: false };
            }
          }
        }
      }
    } catch {
      // Malformed file: fall through to the filename.
    }
    return {
      family: file.name.replace(/\.[^.]+$/, ''),
      weight: 400,
      italic: false,
    };
  });
};

/** Load a single font file into the document. */
export const loadFontFile = async (file: File): Promise<LoadedFont> => {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!FONT_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported font format ".${ext}". Use ${FONT_EXTENSIONS.join(', ')}.`);
  }

  const meta = await readMeta(file);
  const family = meta.family;
  const url = URL.createObjectURL(file);

  const face = new FontFace(family, `url(${url})`, {
    weight: String(meta.weight),
    style: meta.italic ? 'italic' : 'normal',
  });
  await face.load();
  document.fonts.add(face);

  const id = `font_${family.replace(/\s+/g, '_')}_${Date.now().toString(36)}`;
  loadedFaces.set(id, face);

  return {
    id,
    family,
    name: family,
    fileName: file.name,
    weight: meta.weight,
    italic: meta.italic,
  };
};

/**
 * Loaded FontFace objects, keyed by our generated id.
 *
 * `FontFaceSet.delete` only accepts a FontFace instance, so the handles must be
 * retained; a family/weight string is not enough to remove the right entry.
 */
const loadedFaces = new Map<string, FontFace>();

/**
 * Drop a font. The object URL is deliberately NOT revoked: the browser may
 * still need it for re-rasterization, and leaking one small blob per upload is
 * preferable to a broken face.
 */
export const unloadFont = (id: string): void => {
  const face = loadedFaces.get(id);
  if (!face) return;
  document.fonts.delete(face);
  loadedFaces.delete(id);
};
