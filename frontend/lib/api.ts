const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface BgColor {
  r: number; g: number; b: number; // 0–1 range
}

export interface TextItem {
  text: string;
  x: number;       // PDF space (bottom-left origin)
  y: number;       // PDF space (bottom-left origin, baseline)
  w: number;       // bounding box width in points
  h: number;       // bounding box height in points
  fontSize: number;
  fontName: string;
  bgColor?: BgColor;
}

export interface PageData {
  pageIndex: number;   // 0-based
  width: number;       // page width in points
  height: number;      // page height in points
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
  fontSize: number;
  fontName: string;
  originalText: string;
  newText: string;
  bgColor?: BgColor;
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

// ── API calls ──────────────────────────────────────────────────────────────────

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
