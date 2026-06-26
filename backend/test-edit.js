/**
 * test-edit.js — end-to-end smoke test for /extract-text + /edit.
 *
 * Usage (server must be running on port 3001):
 *   node test-edit.js path/to/file.pdf
 *
 * Or direct (no server):
 *   node test-edit.js path/to/file.pdf --direct
 *
 * Output: writes edited PDF to <original-name>.edited.pdf
 */

import { readFileSync, writeFileSync } from 'fs';
import { basename, extname, dirname, join } from 'path';
import { extractTextFromBuffer } from './services/pdfExtractor.js';
import { applyEdits } from './services/pdfEditor.js';

const [, , pdfPath, mode] = process.argv;

if (!pdfPath) {
  console.error('Usage: node test-edit.js <path-to-pdf> [--direct]');
  process.exit(1);
}

const pdfBuffer = readFileSync(pdfPath);
const outPath = join(dirname(pdfPath), basename(pdfPath, extname(pdfPath)) + '.edited.pdf');

if (mode === '--direct') {
  await runDirect(pdfBuffer, outPath);
} else {
  await runViaHttp(pdfBuffer, outPath);
}

async function runDirect(pdfBuffer, outPath) {
  console.log('Step 1: Extracting text...');
  const { pages } = await extractTextFromBuffer(pdfBuffer);

  const allItems = pages.flatMap((p) =>
    p.items.map((item) => ({ ...item, pageIndex: p.pageIndex }))
  );

  console.log(`Found ${allItems.length} text items across ${pages.length} page(s):`);
  allItems.forEach((item, i) =>
    console.log(`  [${i}] p${item.pageIndex} "${item.text}" x=${item.x} y=${item.y} w=${item.w} h=${item.h} size=${item.fontSize}`)
  );

  if (allItems.length === 0) {
    console.error('No text items — scanned PDF, cannot edit.');
    process.exit(1);
  }

  // Replace the first text item as a demonstration.
  const target = allItems[0];
  const edits = [{
    pageIndex: target.pageIndex,
    x: target.x,
    y: target.y,
    w: target.w,
    h: target.h,
    fontSize: target.fontSize,
    fontName: target.fontName,
    originalText: target.text,
    newText: `[EDITED] ${target.text}`,
  }];

  console.log(`\nStep 2: Replacing "${target.text}" with "${edits[0].newText}"...`);
  const resultBytes = await applyEdits(pdfBuffer, edits);
  writeFileSync(outPath, resultBytes);
  console.log(`\nDone! Edited PDF saved to: ${outPath}`);
  console.log('Open the file and verify:');
  console.log(`  - Page ${target.pageIndex + 1}: "[EDITED] ${target.text}" should appear where "${target.text}" was`);
}

async function runViaHttp(pdfBuffer, outPath) {
  const base64 = pdfBuffer.toString('base64');
  const BASE = 'http://localhost:3001';

  console.log('Step 1: POST /extract-text...');
  const extractRes = await fetch(`${BASE}/extract-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdf: base64 }),
  });
  if (!extractRes.ok) {
    console.error('extract-text failed:', await extractRes.json());
    process.exit(1);
  }
  const { pages } = await extractRes.json();
  const allItems = pages.flatMap((p) =>
    p.items.map((item) => ({ ...item, pageIndex: p.pageIndex }))
  );
  console.log(`Found ${allItems.length} text items across ${pages.length} page(s).`);
  allItems.forEach((item, i) =>
    console.log(`  [${i}] p${item.pageIndex} "${item.text}" x=${item.x} y=${item.y}`)
  );

  const target = allItems[0];
  const edits = [{
    pageIndex: target.pageIndex,
    x: target.x,
    y: target.y,
    w: target.w,
    h: target.h,
    fontSize: target.fontSize,
    fontName: target.fontName,
    originalText: target.text,
    newText: `[EDITED] ${target.text}`,
  }];

  console.log(`\nStep 2: POST /edit — replacing "${target.text}"...`);
  const editRes = await fetch(`${BASE}/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdf: base64, edits }),
  });
  if (!editRes.ok) {
    console.error('edit failed:', await editRes.json());
    process.exit(1);
  }
  const { pdf: resultBase64 } = await editRes.json();
  writeFileSync(outPath, Buffer.from(resultBase64, 'base64'));
  console.log(`\nDone! Edited PDF saved to: ${outPath}`);
}
