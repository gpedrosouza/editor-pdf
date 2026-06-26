import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const COVER_MARGIN = 1.2;

export async function applyEdits(pdfBuffer, edits) {
  const doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const pages = doc.getPages();

  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const timesRoman = await doc.embedFont(StandardFonts.TimesRoman);
  const courier = await doc.embedFont(StandardFonts.Courier);

  for (const edit of edits) {
    const { pageIndex, y, fontSize, fontName, newText, bgColor } = edit;

    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new EditError(`pageIndex ${pageIndex} is out of range (document has ${pages.length} page(s))`);
    }

    const page = pages[pageIndex];
    const font = pickFont(fontName, { helvetica, timesRoman, courier });
    const text = newText ?? '';
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const drawX = getDrawX(edit, font, text);
    const cover = getCoverBounds(edit);
    const coverColor = toPdfColor(bgColor, rgb(1, 1, 1));

    page.drawRectangle({
      x: cover.x,
      y: cover.y,
      width: cover.width,
      height: cover.height,
      color: coverColor,
      opacity: 1,
    });

    if (text.length > 0) {
      page.drawText(text, {
        x: drawX,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    }

    const underline = getReplacementUnderline(edit, drawX, textWidth);
    if (underline) {
      page.drawRectangle({
        x: underline.x,
        y: underline.y,
        width: underline.w,
        height: underline.h,
        color: toPdfColor(underline.color, rgb(0, 0, 0)),
        opacity: 1,
      });
    }
  }

  return doc.save();
}

function getDrawX(edit, font, text) {
  const textWidth = font.widthOfTextAtSize(text ?? '', edit.fontSize);
  if (resolveTextAlign(edit) === 'right') {
    return edit.x + edit.w - textWidth;
  }
  return edit.x;
}

function getCoverBounds(edit) {
  const textBox = getTextBox(edit);
  const boxes = [textBox];

  if (isValidBox(edit.underline)) {
    boxes.push({
      x: edit.underline.x,
      y: edit.underline.y,
      width: edit.underline.w,
      height: edit.underline.h,
    });
  }

  const left = Math.min(...boxes.map((box) => box.x));
  const bottom = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const top = Math.max(...boxes.map((box) => box.y + box.height));

  return {
    x: left - COVER_MARGIN,
    y: bottom - COVER_MARGIN,
    width: right - left + COVER_MARGIN * 2,
    height: top - bottom + COVER_MARGIN * 2,
  };
}

function getTextBox(edit) {
  const descent = Math.max(edit.fontSize * 0.25, 1);
  const boxY = finiteOr(edit.boxY, edit.y - descent);
  const boxH = finiteOr(edit.boxH, edit.h + descent);

  return {
    x: edit.x,
    y: boxY,
    width: edit.w,
    height: boxH,
  };
}

function getReplacementUnderline(edit, drawX, textWidth) {
  if (!isValidBox(edit.underline) || textWidth <= 0.1) return null;

  const align = resolveTextAlign(edit);
  const original = edit.underline;
  const rightEdge = original.x + original.w;
  const x = align === 'right' ? rightEdge - textWidth : drawX;

  return {
    x,
    y: original.y,
    w: textWidth,
    h: Math.max(original.h, 0.4),
    color: original.color,
  };
}

function resolveTextAlign(edit) {
  if (edit.textAlign === 'right') return 'right';
  if (edit.textAlign === 'left') return 'left';
  return looksLikeNumericValue(edit.originalText) || looksLikeNumericValue(edit.newText)
    ? 'right'
    : 'left';
}

function looksLikeNumericValue(text) {
  if (typeof text !== 'string') return false;
  const value = text.trim().replace(/\s+/g, '');
  return /^\(?[-+]?((R\$|\$|\u20AC|\u00A3)?\d{1,3}([.,]\d{3})*([.,]\d+)?|\d+([.,]\d+)?)%?\)?$/.test(value);
}

function isValidBox(box) {
  return !!box &&
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.w) &&
    Number.isFinite(box.h) &&
    box.w > 0 &&
    box.h > 0;
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function toPdfColor(color, fallback) {
  if (!color) return fallback;
  const r = clamp01(color.r);
  const g = clamp01(color.g);
  const b = clamp01(color.b);
  return rgb(r, g, b);
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

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
