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

export interface PageData {
  pageIndex: number;
  width: number;
  height: number;
  items: TextItem[];
}

export interface ExtractResponse {
  pages: PageData[];
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

export async function editPdf(pdfBase64: string, edits: Edit[]): Promise<string> {
  const res = await fetch(`${BACKEND}/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pdf: pdfBase64, edits }),
  });

  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Unknown error");
  return data.pdf as string;
}
