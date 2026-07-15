import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const COVER_MARGIN = 1;
const BACKGROUND_EDGE_INSET = 0.5;

export async function applyEdits(pdfBuffer, edits, images = [], shapeEdits = []) {
  const doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  doc.registerFontkit(fontkit);
  const pages = doc.getPages();
  const fonts = await loadFonts(doc);

  for (const edit of edits) {
    const { pageIndex, newText, bgColor } = edit;

    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new EditError(`pageIndex ${pageIndex} is out of range (document has ${pages.length} page(s))`);
    }

    const page = pages[pageIndex];
    const font = pickFont(edit, fonts);
    const text = newText ?? '';
    const target = resolveTarget(edit);
    const textWidth = font.widthOfTextAtSize(text, target.fontSize);
    const drawX = getDrawX(edit, target, font, text);
    // The cover rect always erases the ORIGINAL position/decoration, never the
    // target — that's what makes "move the text elsewhere" work at all.
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
        y: target.y,
        size: target.fontSize,
        font,
        color: rgb(0, 0, 0),
      });
    }

    // An underline is a property of the original row, not of the glyph — moved
    // text has no principled place to synthesize one, so it's simply erased
    // (by the cover rect above) rather than redrawn at the new position.
    if (!edit.transform) {
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
  }

  // Existing vector shapes (bars/rules) being repositioned — same
  // erase-original/redraw-at-target two-step as text, but a plain rectangle
  // since a shape has no baseline/font concept.
  for (const shapeEdit of shapeEdits) {
    const { pageIndex, color } = shapeEdit;

    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new EditError(
        `shapeEdits pageIndex ${pageIndex} is out of range (document has ${pages.length} page(s))`
      );
    }

    const page = pages[pageIndex];
    const target = resolveShapeTarget(shapeEdit);

    // Erase the ORIGINAL box in white — same fallback already used for
    // text's cover-rect when no background is known. Known limitation: a
    // shape sitting on a non-white background leaves a visible white patch,
    // since there's no "what's behind this bar" detection.
    page.drawRectangle({
      x: shapeEdit.x,
      y: shapeEdit.y,
      width: shapeEdit.w,
      height: shapeEdit.h,
      color: rgb(1, 1, 1),
      opacity: 1,
    });

    page.drawRectangle({
      x: target.x,
      y: target.y,
      width: target.w,
      height: target.h,
      color: toPdfColor(color, rgb(0, 0, 0)),
      opacity: 1,
    });
  }

  // Drawn after every edit/shape, so inserted images always render on top.
  for (const image of images) {
    if (image.pageIndex < 0 || image.pageIndex >= pages.length) {
      throw new EditError(
        `images pageIndex ${image.pageIndex} is out of range (document has ${pages.length} page(s))`
      );
    }
    const embedded = await embedImageFromDataUrl(doc, image.dataUrl);
    pages[image.pageIndex].drawImage(embedded, {
      x: image.x,
      y: image.y,
      width: image.w,
      height: image.h,
    });
  }

  return doc.save();
}

// Resolves the box/baseline/fontSize actually used for drawing. Untouched
// edits (no transform) resolve to their original values byte-for-byte.
//
// boxY = baselineY + descent*fontSize (descent is a negative fraction of
// fontSize), so baselineOffset := edit.y - boxY scales linearly with
// fontSize. A pure move (fontSize unchanged) keeps that offset as-is; a
// resize must scale it by the same ratio the font grew/shrank by, or the
// text ends up subtly off its baseline.
function resolveTarget(edit) {
  if (!edit.transform) {
    return { x: edit.x, y: edit.y, w: edit.w, fontSize: edit.fontSize };
  }
  const originalBoxY = getTextBox(edit).y;
  const baselineOffset = edit.y - originalBoxY;
  const ratio = edit.transform.fontSize / edit.fontSize;
  return {
    x: edit.transform.x,
    y: edit.transform.boxY + baselineOffset * ratio,
    w: edit.transform.w,
    fontSize: edit.transform.fontSize,
  };
}

// Resolves the box actually used for drawing a shape. Untouched shapeEdits
// (no transform) resolve to their original box byte-for-byte — a shape's
// (x,y) already IS its box origin, unlike text's baseline-relative y.
function resolveShapeTarget(shapeEdit) {
  if (!shapeEdit.transform) {
    return { x: shapeEdit.x, y: shapeEdit.y, w: shapeEdit.w, h: shapeEdit.h };
  }
  return {
    x: shapeEdit.transform.x,
    y: shapeEdit.transform.y,
    w: shapeEdit.transform.w,
    h: shapeEdit.transform.h,
  };
}

async function embedImageFromDataUrl(doc, dataUrl) {
  const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!match) throw new EditError('Invalid image data URL');
  // Buffer.from() on small inputs allocates from Node's shared pool, so
  // `.buffer` can be a much larger, offset ArrayBuffer than the data itself.
  // pdf-lib's embedders read `imageData.buffer` directly (ignoring
  // byteOffset), so a pooled buffer can leak bytes from a previously
  // embedded image. Copying into a fresh, exactly-sized Uint8Array avoids it.
  const bytes = new Uint8Array(Buffer.from(match[1], 'base64'));

  // Sniff the actual magic bytes rather than trusting the declared mime type.
  const isPng =
    bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

  if (isPng) return doc.embedPng(bytes);
  if (isJpeg) return doc.embedJpg(bytes);
  throw new EditError('Unsupported image format - only PNG and JPEG are supported');
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

function getDrawX(edit, target, font, text) {
  const textWidth = font.widthOfTextAtSize(text ?? '', target.fontSize);
  if (resolveTextAlign(edit) === 'right') {
    return target.x + target.w - textWidth;
  }
  return target.x;
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
