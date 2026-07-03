import * as XLSX from "xlsx";
import { PageData, Edit, BgColor, BgRect, Underline } from "./api";

const USER_COLS = ["Pagina", "Texto Original", "Texto Novo"] as const;
const HIDDEN_COLS = [
  "__pageIndex",
  "__x",
  "__y",
  "__w",
  "__h",
  "__boxY",
  "__boxH",
  "__fontSize",
  "__fontName",
  "__fontFamily",
  "__fontWeight",
  "__textAlign",
  "__bgColor",
  "__bgRect",
  "__underline",
] as const;

interface ExcelRow {
  Pagina: number;
  "Texto Original": string;
  "Texto Novo": string;
  __pageIndex: number;
  __x: number;
  __y: number;
  __w: number;
  __h: number;
  __boxY: number;
  __boxH: number;
  __fontSize: number;
  __fontName: string;
  __fontFamily: string;
  __fontWeight: string;
  __textAlign: string;
  __bgColor: string;
  __bgRect: string;
  __underline: string;
}

export function exportToExcel(pages: PageData[], pdfFilename: string): number {
  const rows: ExcelRow[] = [];

  for (const page of pages) {
    for (const item of page.items) {
      if (!looksLikeEditableValue(item.text)) continue;

      rows.push({
        Pagina: page.pageIndex + 1,
        "Texto Original": item.text,
        "Texto Novo": "",
        __pageIndex: page.pageIndex,
        __x: item.x,
        __y: item.y,
        __w: item.w,
        __h: item.h,
        __boxY: item.boxY ?? item.y,
        __boxH: item.boxH ?? item.h,
        __fontSize: item.fontSize,
        __fontName: item.fontName,
        __fontFamily: item.fontFamily ?? "",
        __fontWeight: item.fontWeight ?? "",
        __textAlign: item.textAlign ?? "",
        __bgColor: JSON.stringify(item.bgColor ?? null),
        __bgRect: JSON.stringify(item.bgRect ?? null),
        __underline: JSON.stringify(item.underline ?? null),
      });
    }
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows, {
    header: [...USER_COLS, ...HIDDEN_COLS],
  });

  ws["!cols"] = [
    { wch: 8 },
    { wch: 28 },
    { wch: 28 },
    ...HIDDEN_COLS.map(() => ({ hidden: true })),
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Edicoes");

  const base = pdfFilename.replace(/\.pdf$/i, "");
  XLSX.writeFile(wb, `${base}-edicoes.xlsx`);
  return rows.length;
}

export async function importFromExcel(file: File): Promise<Edit[]> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<ExcelRow>(ws, { defval: "" });

  const edits: Edit[] = [];

  for (const row of rows) {
    const newText = String(row["Texto Novo"] ?? "").trim();
    if (!newText) continue;

    const bgColor = tryParse<BgColor | null>(row.__bgColor);
    const bgRect = tryParse<BgRect | null>(row.__bgRect);
    const underline = tryParse<Underline | null>(row.__underline);

    edits.push({
      pageIndex: Number(row.__pageIndex),
      x: Number(row.__x),
      y: Number(row.__y),
      w: Number(row.__w),
      h: Number(row.__h),
      boxY: Number(row.__boxY),
      boxH: Number(row.__boxH),
      fontSize: Number(row.__fontSize),
      fontName: String(row.__fontName ?? ""),
      fontFamily: String(row.__fontFamily ?? "") || undefined,
      fontWeight: (row.__fontWeight as "normal" | "bold") || undefined,
      originalText: String(row["Texto Original"] ?? ""),
      newText,
      textAlign: (row.__textAlign as "left" | "right") || undefined,
      bgColor: bgColor ?? undefined,
      bgRect: bgRect ?? undefined,
      underline: underline ?? undefined,
    });
  }

  return edits;
}

function looksLikeEditableValue(text: string): boolean {
  const value = text.trim().replace(/\s+/g, "");
  return /^\(?[-+]?(R\$)?\d{1,3}(\.\d{3})*,\d{2}[DC]?\)?$/i.test(value);
}

function tryParse<T>(json: unknown): T | null {
  try {
    return JSON.parse(String(json));
  } catch {
    return null;
  }
}
