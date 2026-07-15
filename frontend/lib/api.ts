const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

export interface BgColor {
  r: number;
  g: number;
  b: number;
}

export type TextAlign = "left" | "right";
export type FontWeight = "normal" | "bold";

export interface Underline {
  x: number;
  y: number;
  w: number;
  h: number;
  color?: BgColor;
}

export interface BgRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextItem {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  boxY?: number;
  boxH?: number;
  fontSize: number;
  fontName: string;
  fontFamily?: string;
  fontWeight?: FontWeight;
  textAlign?: TextAlign;
  bgColor?: BgColor;
  bgRect?: BgRect;
  underline?: Underline;
}

// A standalone vector shape (bar/rule) extracted from the PDF that isn't
// claimed as any text item's underline — always has a color, unlike a
// text item's optional bgColor.
export interface ShapeItem {
  x: number;
  y: number;
  w: number;
  h: number;
  color: BgColor;
}

export interface PageData {
  pageIndex: number;
  width: number;
  height: number;
  items: TextItem[];
  shapes: ShapeItem[];
}

export interface ExtractResponse {
  pages: PageData[];
}

// New position/size for a moved or resized text block. All fields are
// required together — either a moved edit carries the full new box, or it
// carries none and renders exactly as it does today.
export interface EditTransform {
  x: number;
  boxY: number;
  w: number;
  boxH: number;
  fontSize: number;
}

export interface Edit {
  pageIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  boxY?: number;
  boxH?: number;
  fontSize: number;
  fontName: string;
  fontFamily?: string;
  fontWeight?: FontWeight;
  originalText: string;
  newText: string;
  textAlign?: TextAlign;
  bgColor?: BgColor;
  bgRect?: BgRect;
  underline?: Underline;
  transform?: EditTransform;
}

// New position/size for a moved or resized shape. All fields required
// together, like EditTransform — but plain {x,y,w,h}, since a shape has no
// baseline concept: its (x,y) already IS its box origin.
export interface ShapeTransform {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Mirrors Edit's pattern (original box + optional transform), not
// ImagePlacement's — a shape is existing PDF content being repositioned, so
// it needs an "erase original" identity the way text does.
export interface ShapeEdit {
  pageIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  color: BgColor;
  transform?: ShapeTransform;
}

// A user-inserted image. `dataUrl` keeps its full "data:image/..;base64,"
// prefix (unlike the PDF payload) so the backend can tell PNG from JPEG.
export interface ImagePlacement {
  pageIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  dataUrl: string;
}

// Frontend-only working copy of a placed image; `id` is stripped before send.
export interface PlacedImage extends ImagePlacement {
  id: string;
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function extractText(pdfBase64: string): Promise<ExtractResponse> {
  const res = await fetch(`${BACKEND}/extract-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pdf: pdfBase64 }),
  });

  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Unknown error");
  return data as ExtractResponse;
}

export async function editPdf(
  pdfBase64: string,
  edits: Edit[],
  images: ImagePlacement[],
  shapeEdits: ShapeEdit[] = []
): Promise<string> {
  const res = await fetch(`${BACKEND}/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pdf: pdfBase64, edits, images, shapeEdits }),
  });

  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Unknown error");
  return data.pdf as string;
}
