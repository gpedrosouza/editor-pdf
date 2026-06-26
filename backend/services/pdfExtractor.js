import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';

// pdfjs-dist v4 requires an explicit worker source even in Node.js.
const _require = createRequire(import.meta.url);
GlobalWorkerOptions.workerSrc = pathToFileURL(
  _require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
).href;

// pdfjs OPS codes (v4) — used to parse the page graphics stream.
const OPS_SET_FILL_RGB  = 59;
const OPS_SET_FILL_GRAY = 57;
const OPS_SET_FILL_CMYK = 61;
const OPS_RECTANGLE     = 19;
const OPS_CONSTRUCT_PATH = 91;
const OPS_PATH_MOVETO   = 13;
const OPS_PATH_LINETO   = 14;
const OPS_PATH_CURVETO  = 15;
const OPS_PATH_CURVETO2 = 16;
const OPS_PATH_CURVETO3 = 17;
// fill / eoFill / fillStroke / eoFillStroke / closeFillStroke / closeEOFillStroke
const FILL_OPS     = new Set([22, 23, 24, 25, 26, 27]);
// stroke / closeStroke / endPath — consume path without fill
const NO_FILL_OPS  = new Set([20, 21, 28]);

/**
 * Normalises a PDF rectangle that may have negative width/height.
 * In PDF spec, rect(x, y, w, h) draws from (x,y) by (w,h) — both can be negative,
 * meaning the origin is at the far edge. Always return bottom-left + positive dims.
 */
function normalizeRect(x, y, w, h) {
  return {
    x: w < 0 ? x + w : x,
    y: h < 0 ? y + h : y,
    w: Math.abs(w),
    h: Math.abs(h),
  };
}

/**
 * Walks the pdfjs operator list for a page and collects every non-white filled
 * rectangle: { x, y, w, h, color: { r, g, b } } in PDF coordinate space.
 *
 * Only simple rectangle fills are detected (the common case for table rows and
 * alternating-stripe backgrounds). Complex clipping paths, patterns, shadings,
 * and color-space conversions are ignored — the caller falls back to white.
 */
async function extractColoredRects(page) {
  const { fnArray, argsArray } = await page.getOperatorList();

  let fillColor = null;   // null → treat as white
  const coloredRects = [];
  let pendingRects = [];  // rectangles waiting for a fill/endPath op

  for (let i = 0; i < fnArray.length; i++) {
    const fn   = fnArray[i];
    const args = argsArray[i];

    if (fn === OPS_SET_FILL_RGB) {
      // pdfjs returns RGB in 0–255 range; normalise to 0–1 for pdf-lib
      fillColor = { r: args[0] / 255, g: args[1] / 255, b: args[2] / 255 };
    } else if (fn === OPS_SET_FILL_GRAY) {
      const v = args[0] > 1 ? args[0] / 255 : args[0];
      fillColor = { r: v, g: v, b: v };
    } else if (fn === OPS_SET_FILL_CMYK) {
      // pdfjs may also use 0–255 for CMYK
      const norm = args[0] > 1 ? 255 : 1;
      const [c, m, y, k] = [args[0] / norm, args[1] / norm, args[2] / norm, args[3] / norm];
      fillColor = {
        r: (1 - c) * (1 - k),
        g: (1 - m) * (1 - k),
        b: (1 - y) * (1 - k),
      };
    } else if (fn === OPS_RECTANGLE) {
      pendingRects.push(normalizeRect(args[0], args[1], args[2], args[3]));
    } else if (fn === OPS_CONSTRUCT_PATH) {
      // Batch path op — args[0] = op-code array, args[1] = flat coord array
      const pathOps  = args[0];
      const pathArgs = args[1];
      let ai = 0;
      for (const op of pathOps) {
        if (op === OPS_RECTANGLE) {
          pendingRects.push(normalizeRect(
            pathArgs[ai], pathArgs[ai + 1], pathArgs[ai + 2], pathArgs[ai + 3]
          ));
          ai += 4;
        } else if (op === OPS_PATH_MOVETO || op === OPS_PATH_LINETO) {
          ai += 2;
        } else if (op === OPS_PATH_CURVETO) {
          ai += 6;
        } else if (op === OPS_PATH_CURVETO2 || op === OPS_PATH_CURVETO3) {
          ai += 4;
        }
        // OPS_PATH_CLOSE: no args
      }
    } else if (FILL_OPS.has(fn)) {
      if (fillColor) {
        for (const r of pendingRects) {
          coloredRects.push({ ...r, color: fillColor });
        }
      }
      pendingRects = [];
    } else if (NO_FILL_OPS.has(fn)) {
      pendingRects = [];
    }
  }

  return coloredRects;
}

/**
 * Finds the last colored rect whose area contains the centre of a text item.
 * Returns null when the background is white / no colored rect is found.
 */
function findBgColor(item, coloredRects) {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  let last = null;
  for (const rect of coloredRects) {
    if (cx >= rect.x && cx <= rect.x + rect.w &&
        cy >= rect.y && cy <= rect.y + rect.h) {
      last = rect.color;
    }
  }
  // Return null for pure white (same as the editor default)
  if (last && last.r > 0.99 && last.g > 0.99 && last.b > 0.99) return null;
  return last;
}

/**
 * Extracts text items with bounding boxes from a PDF buffer.
 *
 * COORDINATE SPACE: pdfjs-dist returns coordinates in PDF space:
 *   - Origin at bottom-left corner of the page
 *   - Y axis increases upward
 *
 * Each TextItem now includes an optional `bgColor: { r, g, b }` (0–1 range)
 * describing the background fill colour at that position, or null for white.
 *
 * @param {Buffer|Uint8Array} pdfBuffer
 * @returns {Promise<{ pages: Array<{ pageIndex, width, height, items }> }>}
 */
export async function extractTextFromBuffer(pdfBuffer) {
  const data = new Uint8Array(pdfBuffer);

  const loadingTask = getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
  });

  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;
  const pages = [];
  let totalItems = 0;

  for (let pageIndex = 0; pageIndex < numPages; pageIndex++) {
    const page = await pdfDoc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale: 1 });

    const [textContent, coloredRects] = await Promise.all([
      page.getTextContent(),
      extractColoredRects(page),
    ]);

    const items = [];
    for (const item of textContent.items) {
      if (!item.str || item.str.trim() === '') continue;

      const [a, , , d, x, y] = item.transform;
      const fontSize = Math.abs(d) || Math.abs(a);
      const w = item.width;
      const h = item.height || fontSize;

      const partial = { text: item.str, x, y, w, h, fontSize, fontName: item.fontName || 'unknown' };
      const bgColor = findBgColor(partial, coloredRects);

      items.push({ ...partial, ...(bgColor ? { bgColor } : {}) });
    }

    totalItems += items.length;
    pages.push({
      pageIndex,
      width: viewport.width,
      height: viewport.height,
      items,
    });

    page.cleanup();
  }

  pdfDoc.destroy();

  if (totalItems === 0) {
    throw new ScannedPdfError(
      'No selectable text found — PDF appears to be scanned or image-only'
    );
  }

  return { pages };
}

export class ScannedPdfError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScannedPdfError';
  }
}
