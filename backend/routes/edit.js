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
 *     originalText: string, newText: string
 *   }]
 * }
 * Returns: { pdf: "<base64 of edited PDF>" }
 */
router.post('/', async (req, res) => {
  const { pdf, edits } = req.body;

  if (!pdf || typeof pdf !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "pdf" field (expected base64 string)' });
  }
  if (!Array.isArray(edits) || edits.length === 0) {
    return res.status(400).json({ error: 'Missing or empty "edits" array' });
  }

  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    const missing = ['pageIndex', 'x', 'y', 'w', 'h', 'fontSize', 'newText'].filter(
      (k) => e[k] === undefined || e[k] === null
    );
    if (missing.length > 0) {
      return res.status(400).json({ error: `edits[${i}] is missing fields: ${missing.join(', ')}` });
    }
  }

  let buffer;
  try {
    buffer = Buffer.from(pdf, 'base64');
  } catch {
    return res.status(400).json({ error: 'Failed to decode base64 PDF data' });
  }

  try {
    const resultBytes = await applyEdits(buffer, edits);
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
