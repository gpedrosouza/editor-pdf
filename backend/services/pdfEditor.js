import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const COVER_MARGIN = 1;
const BACKGROUND_EDGE_INSET = 0.5;

export async function applyEdits(pdfBuffer, edits) {
  const doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  doc.registerFontkit(fontkit);
  const pages = doc.getPages();
  const fonts = await loadFonts(doc);

  for (const edit of edits) {
    const { pageIndex, y, fontSize, newText, bgColor } = edit;

    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new EditError(`pageIndex ${pageIndex} is out of range (document has ${pages.length} page(s))`);
    }

    const page = pages[pageIndex];
    const font = pickFont(edit, fonts);
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

async function loadFonts(doc) {
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const timesRoman = await doc.embedFont(StandardFonts.TimesRoman);
  const timesRomanBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const courier = await doc.embedFont(StandardFonts.Courier);
  const courierBold = await doc.embedFont(StandardFonts.CourierBold);

  const tahoma = await embedFontFile(doc, findSystemFontPath([
    'tahoma.ttf',
    'Tahoma.ttf',
    'DejaVuSans.ttf',
    'Arial.ttf',
    'LiberationSans-Regular.ttf',
  ]));
  const tahomaBold = await embedFontFile(doc, findSystemFontPath([
    'tahomabd.ttf',
    'Tahoma Bold.ttf',
    'DejaVuSans-Bold.ttf',
    'Arial Bold.ttf',
    'LiberationSans-Bold.ttf',
  ]));

  return {
    sans: tahoma || helvetica,
    sansBold: tahomaBold || tahoma || helveticaBold,
    timesRoman,
    timesRomanBold,
    courier,
    courierBold,
  };
}

async function embedFontFile(doc, filePath) {
  if (!filePath) return null;
  return doc.embedFont(readFileSync(filePath), { subset: true });
}

function findSystemFontPath(fileNames) {
  const fontDirs = [
    process.env.WINDIR ? join(process.env.WINDIR, 'Fonts') : null,
    '/Library/Fonts',
    '/System/Library/Fonts',
    '/System/Library/Fonts/Supplemental',
    '/usr/share/fonts/truetype/dejavu',
    '/usr/share/fonts/truetype/liberation2',
    '/usr/share/fonts/truetype/msttcorefonts',
  ].filter(Boolean);

  for (const dir of fontDirs) {
    for (const fileName of fileNames) {
      const candidate = join(dir, fileName);
      if (existsSync(candidate)) return candidate;
    }
  }

  return null;
}

function getDrawX(edit, font, text) {
  const textWidth = font.widthOfTextAtSize(text ?? '', edit.fontSize);
  if (resolveTextAlign(edit) === 'right') {
    return edit.x + edit.w - textWidth;
  }
  return edit.x;
}

function getCoverBounds(edit) {
  const bg = edit.bgRect;

  if (isValidBox(bg)) {
    // Draw inside the detected stripe. PDF row backgrounds often include
    // anti-aliased edge pixels; repainting those edges locally makes a pasted box visible.
    const verticalInset = Math.min(BACKGROUND_EDGE_INSET, bg.h / 4);
    const left = Math.max(edit.x - COVER_MARGIN, bg.x);
    const right = Math.min(edit.x + edit.w + COVER_MARGIN, bg.x + bg.w);

    return {
      x: left,
      y: bg.y + verticalInset,
      width: Math.max(right - left, 0.1),
      height: Math.max(bg.h - verticalInset * 2, 0.1),
    };
  }

  // Fallback for items with no detected background.
  const textBox = getTextBox(edit);
  let top = textBox.y + textBox.height + COVER_MARGIN;
  let bottom = textBox.y - COVER_MARGIN;
  if (isValidBox(edit.underline) && edit.underline.y < bottom) {
    bottom = edit.underline.y - 0.1;
  }
  return {
    x: edit.x - COVER_MARGIN,
    y: bottom,
    width: edit.w + COVER_MARGIN * 2,
    height: Math.max(top - bottom, 0.1),
  };
}

function getTextBox(edit) {
  const descent = Math.max(edit.fontSize * 0.25, 1);
  return {
    x: edit.x,
    y: finiteOr(edit.boxY, edit.y - descent),
    width: edit.w,
    height: finiteOr(edit.boxH, edit.h + descent),
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
  return /^\(?[-+]?((R\$|\$|\u20AC|\u00A3)?\d{1,3}([.,]\d{3})*([.,]\d+)?|\d+([.,]\d+)?)%?[DC]?\)?$/i.test(value);
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

function pickFont(edit, fonts) {
  const family = String(edit.fontFamily || edit.fontName || '').toLowerCase();
  const bold = isBoldFont(edit);

  if (family.includes('courier') || family.includes('mono') || family.includes('typewriter')) {
    return bold ? fonts.courierBold : fonts.courier;
  }

  if (family.includes('times') || family.includes('roman') || (family.includes('serif') && !family.includes('sans-serif'))) {
    return bold ? fonts.timesRomanBold : fonts.timesRoman;
  }

  return bold ? fonts.sansBold : fonts.sans;
}

function isBoldFont(edit) {
  const weight = edit.fontWeight;
  if (typeof weight === 'number') return weight >= 600;
  if (typeof weight === 'string' && Number.isFinite(Number(weight))) {
    return Number(weight) >= 600;
  }

  const source = [
    weight,
    edit.fontFamily,
    edit.fontName,
  ].filter(Boolean).join(' ');

  return /\b(bold|black|heavy|semibold|demi)\b/i.test(source.replace(/[-_,]/g, ' '));
}

export class EditError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EditError';
  }
}
