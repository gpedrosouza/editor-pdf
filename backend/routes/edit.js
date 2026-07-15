import { Router } from 'express';
import { applyEdits, EditError } from '../services/pdfEditor.js';

const router = Router();

/**
 * POST /edit
 * Body: {
 *   pdf: "<base64>",
 *   edits: [{
 *     pageIndex: number,
 *     x: number, y: number, w: number, h: number,
 *     fontSize: number, fontName: string,
 *     originalText: string, newText: string,
 *     transform?: { x, boxY, w, boxH, fontSize }   // moved/resized text block
 *   }],
 *   images?: [{
 *     pageIndex: number,
 *     x: number, y: number, w: number, h: number,
 *     dataUrl: "data:image/png;base64,..." | "data:image/jpeg;base64,..."
 *   }],
 *   shapeEdits?: [{
 *     pageIndex: number,
 *     x: number, y: number, w: number, h: number,
 *     color: { r: number, g: number, b: number },
 *     transform?: { x, y, w, h }   // moved/resized vector shape (bar/rule)
 *   }]
 * }
 * Returns: { pdf: "<base64 of edited PDF>" }
 */
router.post('/', async (req, res) => {
  const { pdf, edits, images = [], shapeEdits = [] } = req.body;

  if (!pdf || typeof pdf !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "pdf" field (expected base64 string)' });
  }
  if (!Array.isArray(edits)) {
    return res.status(400).json({ error: 'Missing or invalid "edits" array' });
  }
  if (!Array.isArray(images)) {
    return res.status(400).json({ error: 'Invalid "images" field (expected an array)' });
  }
  if (!Array.isArray(shapeEdits)) {
    return res.status(400).json({ error: 'Invalid "shapeEdits" field (expected an array)' });
  }
  if (edits.length === 0 && images.length === 0 && shapeEdits.length === 0) {
    return res
      .status(400)
      .json({ error: 'Nothing to apply: "edits", "images" and "shapeEdits" are all empty' });
  }

  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    const missing = ['pageIndex', 'x', 'y', 'w', 'h', 'fontSize', 'newText'].filter(
      (k) => e[k] === undefined || e[k] === null
    );
    if (missing.length > 0) {
      return res.status(400).json({ error: `edits[${i}] is missing fields: ${missing.join(', ')}` });
    }
    if (e.transform !== undefined) {
      if (typeof e.transform !== 'object' || e.transform === null) {
        return res.status(400).json({ error: `edits[${i}].transform must be an object` });
      }
      const bad = ['x', 'boxY', 'w', 'boxH', 'fontSize'].filter(
        (k) => !Number.isFinite(e.transform[k])
      );
      if (bad.length > 0) {
        return res
          .status(400)
          .json({ error: `edits[${i}].transform has missing/invalid fields: ${bad.join(', ')}` });
      }
    }
  }

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const missing = ['pageIndex', 'x', 'y', 'w', 'h', 'dataUrl'].filter(
      (k) => img[k] === undefined || img[k] === null
    );
    if (missing.length > 0) {
      return res.status(400).json({ error: `images[${i}] is missing fields: ${missing.join(', ')}` });
    }
    if (typeof img.dataUrl !== 'string' || !/^data:image\/(png|jpe?g);base64,/i.test(img.dataUrl)) {
      return res.status(400).json({ error: `images[${i}].dataUrl must be a base64 PNG or JPEG data URL` });
    }
  }

  for (let i = 0; i < shapeEdits.length; i++) {
    const s = shapeEdits[i];
    const missing = ['pageIndex', 'x', 'y', 'w', 'h', 'color'].filter(
      (k) => s[k] === undefined || s[k] === null
    );
    if (missing.length > 0) {
      return res.status(400).json({ error: `shapeEdits[${i}] is missing fields: ${missing.join(', ')}` });
    }
    if (
      typeof s.color !== 'object' ||
      s.color === null ||
      ['r', 'g', 'b'].some((k) => !Number.isFinite(s.color[k]))
    ) {
      return res.status(400).json({ error: `shapeEdits[${i}].color must be an {r,g,b} object` });
    }
    if (s.transform !== undefined) {
      if (typeof s.transform !== 'object' || s.transform === null) {
        return res.status(400).json({ error: `shapeEdits[${i}].transform must be an object` });
      }
      const bad = ['x', 'y', 'w', 'h'].filter((k) => !Number.isFinite(s.transform[k]));
      if (bad.length > 0) {
        return res
          .status(400)
          .json({ error: `shapeEdits[${i}].transform has missing/invalid fields: ${bad.join(', ')}` });
      }
    }
  }

  let buffer;
  try {
    buffer = Buffer.from(pdf, 'base64');
  } catch {
    return res.status(400).json({ error: 'Failed to decode base64 PDF data' });
  }

  try {
    const resultBytes = await applyEdits(buffer, edits, images, shapeEdits);
    const resultBase64 = Buffer.from(resultBytes).toString('base64');
    return res.json({ pdf: resultBase64 });
  } catch (err) {
    if (err instanceof EditError) {
      return res.status(400).json({ error: err.message });
    }
    if (err.message?.includes('Failed to parse') || err.message?.includes('Invalid')) {
      return res.status(400).json({ error: 'Invalid or corrupted PDF file' });
    }
    console.error('edit error:', err);
    return res.status(500).json({ error: 'Internal server error during PDF editing' });
  }
});

export default router;
