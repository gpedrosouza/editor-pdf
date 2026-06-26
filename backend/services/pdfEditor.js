import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Whitespace added around the cover rectangle so it fully hides descenders/ascenders.
const COVER_MARGIN = 1; // points

/**
 * Applies a list of text substitutions to a PDF using the Cover & Rewrite strategy:
 *   1. Draw a white rectangle over the original text bounding box.
 *   2. Write the new text at the same baseline position with the same font size.
 *
 * COORDINATE CONTRACT — both pdfjs-dist and pdf-lib use PDF coordinate space:
 *   - Origin at the bottom-left corner of the page.
 *   - Y axis increases upward.
 *   - `y` in each edit is the text baseline in PDF points.
 *
 * NOTE: If the frontend ever converts coordinates to CSS space (top-left origin,
 * Y downward) before sending them here, apply this conversion first:
 *   pdfY = pageHeight - (cssY + itemHeight)
 * For the current frontend implementation (Phase 4+), the raw PDF-space coordinates
 * from /extract-text are forwarded unchanged, so no conversion is needed.
 *
 * @param {Buffer} pdfBuffer  - Raw PDF bytes.
 * @param {Array<{
 *   pageIndex: number,   // 0-based
 *   x: number,          // PDF space, points
 *   y: number,          // PDF space, points (baseline, bottom-left origin)
 *   w: number,          // bounding box width, points
 *   h: number,          // bounding box height, points
 *   fontSize: number,   // points
 *   fontName: string,   // internal PDF font name (used for heuristic only)
 *   originalText: string,
 *   newText: string,
 * }>} edits
 * @returns {Promise<Uint8Array>} Modified PDF bytes.
 */
export async function applyEdits(pdfBuffer, edits) {
  const doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const pages = doc.getPages();

  // Embed fonts once and reuse across all edits.
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const timesRoman = await doc.embedFont(StandardFonts.TimesRoman);
  const courier = await doc.embedFont(StandardFonts.Courier);

  for (const edit of edits) {
    const { pageIndex, x, y, w, h, fontSize, fontName, newText, bgColor } = edit;

    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new EditError(`pageIndex ${pageIndex} is out of range (document has ${pages.length} page(s))`);
    }

    const page = pages[pageIndex];
    const font = pickFont(fontName, { helvetica, timesRoman, courier });

    const coverColor = bgColor
      ? rgb(bgColor.r, bgColor.g, bgColor.b)
      : rgb(1, 1, 1);

    // 1. Cover the original text with a rectangle matching the background.
    page.drawRectangle({
      x: x - COVER_MARGIN,
      y: y - COVER_MARGIN,
      width: w + 2 * COVER_MARGIN,
      height: h + 2 * COVER_MARGIN,
      color: coverColor,
      opacity: 1,
    });

    // 2. Write the replacement text at the same baseline position.
    page.drawText(newText, {
      x,
      y,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
  }

  return doc.save();
}

/**
 * Selects a standard PDF font based on a heuristic over the internal font name.
 * pdfjs-dist exposes internal names like "g_d0_f1", so we fall back to Helvetica
 * by default. Fonts containing "Times" or "Roman" hint at a serif font.
 */
function pickFont(fontName, { helvetica, timesRoman, courier }) {
  const name = (fontName || '').toLowerCase();
  if (name.includes('times') || name.includes('roman') || name.includes('serif')) {
    return timesRoman;
  }
  if (name.includes('courier') || name.includes('mono') || name.includes('typewriter')) {
    return courier;
  }
  return helvetica;
}

export class EditError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EditError';
  }
}
