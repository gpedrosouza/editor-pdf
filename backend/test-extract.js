/**
 * test-extract.js — smoke test for the /extract-text endpoint.
 *
 * Usage (server must be running on port 3001):
 *   node test-extract.js path/to/file.pdf
 *
 * Or without server (calls pdfExtractor directly):
 *   node test-extract.js path/to/file.pdf --direct
 */

import { readFileSync } from 'fs';
import { extractTextFromBuffer } from './services/pdfExtractor.js';

const [, , pdfPath, mode] = process.argv;

if (!pdfPath) {
  console.error('Usage: node test-extract.js <path-to-pdf> [--direct]');
  process.exit(1);
}

const pdfBuffer = readFileSync(pdfPath);

if (mode === '--direct') {
  // Call the extractor directly (no server needed)
  console.log(`Extracting text from: ${pdfPath} (direct mode)\n`);
  extractTextFromBuffer(pdfBuffer)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      console.log(`\nSummary: ${result.pages.length} page(s), ${result.pages.reduce((acc, p) => acc + p.items.length, 0)} text items`);
    })
    .catch((err) => {
      console.error('Error:', err.message);
      process.exit(1);
    });
} else {
  // POST to the running server
  const base64 = pdfBuffer.toString('base64');
  console.log(`Sending ${pdfPath} (${pdfBuffer.length} bytes) to http://localhost:3001/extract-text\n`);

  fetch('http://localhost:3001/extract-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdf: base64 }),
  })
    .then(async (res) => {
      const data = await res.json();
      if (!res.ok) {
        console.error(`HTTP ${res.status}:`, data);
        process.exit(1);
      }
      console.log(JSON.stringify(data, null, 2));
      console.log(`\nSummary: ${data.pages.length} page(s), ${data.pages.reduce((acc, p) => acc + p.items.length, 0)} text items`);
    })
    .catch((err) => {
      console.error('Network error:', err.message);
      process.exit(1);
    });
}
