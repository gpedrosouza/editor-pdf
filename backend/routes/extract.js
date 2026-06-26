import { Router } from 'express';
import { extractTextFromBuffer, ScannedPdfError } from '../services/pdfExtractor.js';

const router = Router();

/**
 * POST /extract-text
 * Body: { pdf: "<base64 string>" }
 * Returns: { pages: [{ pageIndex, width, height, items: [{ text, x, y, w, h, fontSize, fontName }] }] }
 */
router.post('/', async (req, res) => {
  const { pdf } = req.body;

  if (!pdf || typeof pdf !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid "pdf" field (expected base64 string)' });
  }

  let buffer;
  try {
    buffer = Buffer.from(pdf, 'base64');
  } catch {
    return res.status(400).json({ error: 'Failed to decode base64 PDF data' });
  }

  try {
    const result = await extractTextFromBuffer(buffer);
    return res.json(result);
  } catch (err) {
    if (err instanceof ScannedPdfError) {
      return res.status(422).json({
        error: 'PDF escaneado ou sem texto selecionável detectado. Envie um PDF com texto nativo para edição.',
      });
    }
    console.error('extract-text error:', err);
    return res.status(500).json({ error: 'Internal server error during text extraction' });
  }
});

export default router;
