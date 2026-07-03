import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { getDocument, GlobalWorkerOptions, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

// pdfjs-dist v4 requires an explicit worker source even in Node.js.
const _require = createRequire(import.meta.url);
GlobalWorkerOptions.workerSrc = pathToFileURL(
  _require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
).href;

const FILL_OPS = new Set([
  OPS.fill,
  OPS.eoFill,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
]);

const STROKE_OPS = new Set([
  OPS.stroke,
  OPS.closeStroke,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
]);

const END_PATH_OPS = new Set([OPS.stroke, OPS.closeStroke, OPS.endPath]);
const DEFAULT_FILL = { r: 0, g: 0, b: 0 };
const DEFAULT_STROKE = { r: 0, g: 0, b: 0 };
const IDENTITY_MATRIX = [1, 0, 0, 1, 0, 0];
const DEFAULT_ASCENT = 0.8;
const DEFAULT_DESCENT = -0.2;
const SUBSET_PREFIX_PATTERN = /^[A-Z]{6}\+/;
const BOLD_FONT_PATTERN = /\b(bold|black|heavy|semibold|demi)\b/i;

function cloneColor(color) {
  return color ? { r: color.r, g: color.g, b: color.b } : null;
}

function cloneState(state) {
  return {
    ctm: [...state.ctm],
    fillColor: cloneColor(state.fillColor),
    strokeColor: cloneColor(state.strokeColor),
    lineWidth: state.lineWidth,
  };
}

function multiplyMatrices(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function transformPoint(matrix, x, y) {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  };
}

function transformRect(matrix, x, y, w, h) {
  const points = [
    transformPoint(matrix, x, y),
    transformPoint(matrix, x + w, y),
    transformPoint(matrix, x, y + h),
    transformPoint(matrix, x + w, y + h),
  ];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function matrixScale(matrix) {
  const sx = Math.hypot(matrix[0], matrix[1]) || 1;
  const sy = Math.hypot(matrix[2], matrix[3]) || sx;
  return (sx + sy) / 2;
}

function normalizeRect(x, y, w, h) {
  return {
    x: w < 0 ? x + w : x,
    y: h < 0 ? y + h : y,
    w: Math.abs(w),
    h: Math.abs(h),
  };
}

function normalizeColorArgs(args, mode) {
  if (mode === 'gray') {
    const v = args[0] > 1 ? args[0] / 255 : args[0];
    return { r: v, g: v, b: v };
  }

  if (mode === 'rgb') {
    const norm = args.some((v) => v > 1) ? 255 : 1;
    return { r: args[0] / norm, g: args[1] / norm, b: args[2] / norm };
  }

  const norm = args.some((v) => v > 1) ? 255 : 1;
  const [c, m, y, k] = [args[0] / norm, args[1] / norm, args[2] / norm, args[3] / norm];
  return {
    r: (1 - c) * (1 - k),
    g: (1 - m) * (1 - k),
    b: (1 - y) * (1 - k),
  };
}

function normalizeHorizontalRule(x1, y1, x2, y2, thickness, color) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.abs(dx) < 0.01) return null;

  if (Math.abs(dy) > Math.max(0.75, Math.abs(dx) * 0.03)) return null;

  const ruleThickness = Math.max(Math.abs(thickness) || 0, 0.4);
  return {
    x: Math.min(x1, x2),
    y: (y1 + y2) / 2 - ruleThickness / 2,
    w: Math.abs(dx),
    h: ruleThickness,
    color: cloneColor(color) || DEFAULT_STROKE,
  };
}

function rectAsHorizontalRule(rect, color) {
  const isThin = rect.h <= Math.max(2, rect.w * 0.08);
  const isWide = rect.w >= 2;
  if (!isThin || !isWide) return null;
  return {
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: Math.max(rect.h, 0.4),
    color: cloneColor(color) || DEFAULT_FILL,
  };
}

function nearlyEqual(a, b, tolerance = 0.01) {
  return Math.abs(a - b) <= tolerance;
}

function pushUnique(values, value) {
  if (!values.some((candidate) => nearlyEqual(candidate, value))) {
    values.push(value);
  }
}

function inferRectFromLines(lines) {
  if (lines.length < 4) return null;

  const xs = [];
  const ys = [];
  for (const line of lines) {
    const isVertical = nearlyEqual(line.x1, line.x2);
    const isHorizontal = nearlyEqual(line.y1, line.y2);
    if (!isVertical && !isHorizontal) return null;

    pushUnique(xs, line.x1);
    pushUnique(xs, line.x2);
    pushUnique(ys, line.y1);
    pushUnique(ys, line.y2);
  }

  if (xs.length !== 2 || ys.length !== 2) return null;

  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(...xs) - x;
  const h = Math.max(...ys) - y;
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

async function extractGraphics(page) {
  const { fnArray, argsArray } = await page.getOperatorList();

  let state = {
    ctm: [...IDENTITY_MATRIX],
    fillColor: cloneColor(DEFAULT_FILL),
    strokeColor: cloneColor(DEFAULT_STROKE),
    lineWidth: 1,
  };
  const stack = [];
  const coloredRects = [];
  const horizontalRules = [];
  let pendingRects = [];
  let pendingLines = [];
  let currentPoint = null;
  let subpathStart = null;

  function resetPath() {
    pendingRects = [];
    pendingLines = [];
    currentPoint = null;
    subpathStart = null;
  }

  function addRect(x, y, w, h) {
    const normalized = normalizeRect(x, y, w, h);
    pendingRects.push(transformRect(
      state.ctm,
      normalized.x,
      normalized.y,
      normalized.w,
      normalized.h
    ));
    currentPoint = { x, y };
    subpathStart = { x, y };
  }

  function moveTo(x, y) {
    currentPoint = { x, y };
    subpathStart = { x, y };
  }

  function lineTo(x, y) {
    if (currentPoint) {
      const p1 = transformPoint(state.ctm, currentPoint.x, currentPoint.y);
      const p2 = transformPoint(state.ctm, x, y);
      pendingLines.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
    }
    currentPoint = { x, y };
  }

  function closePath() {
    if (currentPoint && subpathStart) {
      lineTo(subpathStart.x, subpathStart.y);
    }
  }

  function fillPath() {
    const inferredRect = inferRectFromLines(pendingLines);
    const rects = inferredRect ? [...pendingRects, inferredRect] : pendingRects;

    for (const rect of rects) {
      coloredRects.push({ ...rect, color: cloneColor(state.fillColor) || DEFAULT_FILL });
      const rule = rectAsHorizontalRule(rect, state.fillColor);
      if (rule) horizontalRules.push(rule);
    }
  }

  function strokePath() {
    const thickness = state.lineWidth * matrixScale(state.ctm);

    for (const line of pendingLines) {
      const rule = normalizeHorizontalRule(
        line.x1,
        line.y1,
        line.x2,
        line.y2,
        thickness,
        state.strokeColor
      );
      if (rule) horizontalRules.push(rule);
    }

    for (const rect of pendingRects) {
      const top = normalizeHorizontalRule(
        rect.x,
        rect.y + rect.h,
        rect.x + rect.w,
        rect.y + rect.h,
        thickness,
        state.strokeColor
      );
      const bottom = normalizeHorizontalRule(
        rect.x,
        rect.y,
        rect.x + rect.w,
        rect.y,
        thickness,
        state.strokeColor
      );
      if (top) horizontalRules.push(top);
      if (bottom) horizontalRules.push(bottom);
    }
  }

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];

    if (fn === OPS.save) {
      stack.push(cloneState(state));
    } else if (fn === OPS.restore) {
      state = stack.pop() || state;
      resetPath();
    } else if (fn === OPS.transform) {
      state.ctm = multiplyMatrices(state.ctm, args);
    } else if (fn === OPS.setLineWidth) {
      state.lineWidth = args[0] || 1;
    } else if (fn === OPS.setFillRGBColor) {
      state.fillColor = normalizeColorArgs(args, 'rgb');
    } else if (fn === OPS.setFillGray) {
      state.fillColor = normalizeColorArgs(args, 'gray');
    } else if (fn === OPS.setFillCMYKColor) {
      state.fillColor = normalizeColorArgs(args, 'cmyk');
    } else if (fn === OPS.setStrokeRGBColor) {
      state.strokeColor = normalizeColorArgs(args, 'rgb');
    } else if (fn === OPS.setStrokeGray) {
      state.strokeColor = normalizeColorArgs(args, 'gray');
    } else if (fn === OPS.setStrokeCMYKColor) {
      state.strokeColor = normalizeColorArgs(args, 'cmyk');
    } else if (fn === OPS.rectangle) {
      addRect(args[0], args[1], args[2], args[3]);
    } else if (fn === OPS.moveTo) {
      moveTo(args[0], args[1]);
    } else if (fn === OPS.lineTo) {
      lineTo(args[0], args[1]);
    } else if (fn === OPS.closePath) {
      closePath();
    } else if (fn === OPS.constructPath) {
      const pathOps = args[0];
      const pathArgs = args[1];
      let ai = 0;

      for (const op of pathOps) {
        if (op === OPS.rectangle) {
          addRect(pathArgs[ai], pathArgs[ai + 1], pathArgs[ai + 2], pathArgs[ai + 3]);
          ai += 4;
        } else if (op === OPS.moveTo) {
          moveTo(pathArgs[ai], pathArgs[ai + 1]);
          ai += 2;
        } else if (op === OPS.lineTo) {
          lineTo(pathArgs[ai], pathArgs[ai + 1]);
          ai += 2;
        } else if (op === OPS.curveTo) {
          currentPoint = { x: pathArgs[ai + 4], y: pathArgs[ai + 5] };
          ai += 6;
        } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
          currentPoint = { x: pathArgs[ai + 2], y: pathArgs[ai + 3] };
          ai += 4;
        } else if (op === OPS.closePath) {
          closePath();
        }
      }
    } else if (FILL_OPS.has(fn)) {
      fillPath();
      if (STROKE_OPS.has(fn)) strokePath();
      resetPath();
    } else if (END_PATH_OPS.has(fn)) {
      if (STROKE_OPS.has(fn)) strokePath();
      resetPath();
    }
  }

  return { coloredRects, horizontalRules };
}

function findBgColor(item, coloredRects) {
  const boxY = Number.isFinite(item.boxY) ? item.boxY : item.y;
  const boxH = Number.isFinite(item.boxH) ? item.boxH : item.h;
  const cx = item.x + item.w / 2;
  const cy = boxY + boxH / 2;
  // Minimum height to be a plausible row background (not an underline stroke).
  const minH = Math.max(item.fontSize || item.h || 10, 2) * 0.5;
  let best = null;

  for (const rect of coloredRects) {
    if (rect.h < minH) continue; // skip thin rules
    if (cx < rect.x || cx > rect.x + rect.w) continue;
    if (cy < rect.y || cy > rect.y + rect.h) continue;
    // Prefer the smallest-height rect: the most specific background for this row.
    // A full-page or multi-row background will always have larger h than the faixa.
    if (!best || rect.h < best.h) {
      best = rect;
    }
  }

  if (!best || (best.color.r > 0.99 && best.color.g > 0.99 && best.color.b > 0.99)) return null;
  return best;
}

function overlapLength(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function findUnderline(item, horizontalRules) {
  const itemLeft = item.x;
  const itemRight = item.x + item.w;
  const baselineY = item.y;
  const fontSize = item.fontSize || item.h || 10;
  const minY = baselineY - fontSize * 0.35;
  const maxY = baselineY + fontSize * 0.18;

  let best = null;
  let bestScore = -Infinity;

  for (const rule of horizontalRules) {
    const ruleCenterY = rule.y + rule.h / 2;
    if (ruleCenterY < minY || ruleCenterY > maxY) continue;
    if (rule.h > Math.max(2.5, fontSize * 0.2)) continue;

    const ruleRight = rule.x + rule.w;
    const overlap = overlapLength(itemLeft, itemRight, rule.x, ruleRight);
    if (overlap < item.w * 0.55) continue;

    const widthRatio = rule.w / Math.max(item.w, 0.01);
    if (widthRatio < 0.45 || widthRatio > 1.8) continue;

    const yDistance = Math.abs(ruleCenterY - baselineY);
    const score = overlap - yDistance * 4 - Math.abs(1 - widthRatio) * item.w * 0.25;
    if (score > bestScore) {
      bestScore = score;
      best = rule;
    }
  }

  if (!best) return null;
  return {
    x: best.x,
    y: best.y,
    w: best.w,
    h: best.h,
    color: cloneColor(best.color) || DEFAULT_STROKE,
  };
}

function looksLikeNumericValue(text) {
  const value = text.trim().replace(/\s+/g, '');
  return /^\(?[-+]?((R\$|\$|\u20AC|\u00A3)?\d{1,3}([.,]\d{3})*([.,]\d+)?|\d+([.,]\d+)?)%?[DC]?\)?$/i.test(value);
}

function getTextBox(item, style, fontSize) {
  const rawAscent = Number.isFinite(style?.ascent) ? style.ascent : DEFAULT_ASCENT;
  const rawDescent = Number.isFinite(style?.descent) ? style.descent : DEFAULT_DESCENT;
  const ascent = rawAscent > 0 ? rawAscent : DEFAULT_ASCENT;
  const descent = rawDescent > 0 ? -rawDescent : rawDescent;
  const boxY = item.transform[5] + descent * fontSize;
  const boxH = Math.max(fontSize * (ascent - descent), item.height || fontSize);

  return { boxY, boxH, ascent, descent };
}

function getFontMetadata(page, fontName, style) {
  let pdfFont = null;
  try {
    pdfFont = page.commonObjs?.get(fontName);
  } catch {
    pdfFont = null;
  }

  const rawFontName = normalizeFontName(pdfFont?.name || '');
  const styleFamily = typeof style?.fontFamily === 'string' ? style.fontFamily : '';
  const fontFamily = getFontFamily(rawFontName) || styleFamily || '';
  const weightSource = [rawFontName, styleFamily, fontName].filter(Boolean).join(' ');

  return {
    fontFamily,
    fontWeight: isBoldFontName(weightSource) ? 'bold' : 'normal',
  };
}

function normalizeFontName(name) {
  return String(name || '').replace(SUBSET_PREFIX_PATTERN, '');
}

function getFontFamily(name) {
  const normalized = normalizeFontName(name);
  if (!normalized) return '';
  return normalized
    .split(',')[0]
    .replace(/[-\s]?(bold|black|heavy|semibold|demi|regular|italic|oblique|mt)$/ig, '')
    .trim();
}

function isBoldFontName(name) {
  return BOLD_FONT_PATTERN.test(String(name || '').replace(/[-_,]/g, ' '));
}

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

    const [textContent, graphics] = await Promise.all([
      page.getTextContent(),
      extractGraphics(page),
    ]);
    const { coloredRects, horizontalRules } = graphics;

    const items = [];
    for (const item of textContent.items) {
      if (!item.str || item.str.trim() === '') continue;

      const [a, b, c, d, x, y] = item.transform;
      const fontSize = Math.hypot(c, d) || Math.hypot(a, b) || item.height || 10;
      const w = item.width;
      const h = item.height || fontSize;
      const style = textContent.styles?.[item.fontName] || {};
      const textBox = getTextBox(item, style, fontSize);
      const fontMetadata = getFontMetadata(page, item.fontName, style);

      const partial = {
        text: item.str,
        x,
        y,
        w,
        h,
        ...textBox,
        fontSize,
        fontName: item.fontName || 'unknown',
        ...fontMetadata,
        textAlign: looksLikeNumericValue(item.str) ? 'right' : 'left',
      };
      const bgResult = findBgColor(partial, coloredRects);
      const underline = findUnderline(partial, horizontalRules);

      items.push({
        ...partial,
        ...(bgResult ? {
          bgColor: cloneColor(bgResult.color),
          bgRect: { x: bgResult.x, y: bgResult.y, w: bgResult.w, h: bgResult.h },
        } : {}),
        ...(underline ? { underline } : {}),
      });
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
      'No selectable text found - PDF appears to be scanned or image-only'
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
