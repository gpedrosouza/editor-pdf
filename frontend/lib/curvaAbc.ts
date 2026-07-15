import * as XLSX from "xlsx";

export interface ParsedCliente {
  cnpj_cpf: string;
  nome: string;
  valor: number;
}

export interface ParseClientesResult {
  clientes: ParsedCliente[];
  skippedRows: number;
}

const CNPJ_ALIASES = ["cnpj_cpf", "cnpj", "cpf", "cnpj/cpf", "documento"];
const NOME_ALIASES = ["nome", "cliente", "razao social", "razão social", "nome do cliente"];
const VALOR_ALIASES = ["valor", "valor cliente", "total", "faturamento", "valor total"];

// Parses a client list (cnpj_cpf, nome, valor) from an XLSX or CSV file,
// entirely client-side. XLSX.read auto-detects the format from the buffer
// content, so both are handled by the exact same code path.
export async function parseClientesFile(file: File): Promise<ParseClientesResult> {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });

  if (rows.length === 0) {
    return { clientes: [], skippedRows: 0 };
  }

  const headerMap = buildHeaderMap(Object.keys(rows[0]));
  const clientes: ParsedCliente[] = [];
  let skippedRows = 0;

  for (const row of rows) {
    const nome = headerMap.nome ? String(row[headerMap.nome] ?? "").trim() : "";
    const valorRaw = headerMap.valor ? row[headerMap.valor] : undefined;
    const valor = parseNumericCell(valorRaw);

    if (!nome || valor === null) {
      skippedRows += 1;
      continue;
    }

    const cnpjRaw = headerMap.cnpj_cpf ? row[headerMap.cnpj_cpf] : "";
    clientes.push({
      cnpj_cpf: String(cnpjRaw ?? "").trim(),
      nome,
      valor,
    });
  }

  return { clientes, skippedRows };
}

function buildHeaderMap(headers: string[]): { cnpj_cpf?: string; nome?: string; valor?: string } {
  const normalize = (h: string) => h.trim().toLowerCase();
  const find = (aliases: string[]) => headers.find((h) => aliases.includes(normalize(h)));
  return {
    cnpj_cpf: find(CNPJ_ALIASES),
    nome: find(NOME_ALIASES),
    valor: find(VALOR_ALIASES),
  };
}

function parseNumericCell(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string" || !raw.trim()) return null;

  const cleaned = raw.trim().replace(/[^\d,.-]/g, "");
  if (!cleaned) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (lastComma > lastDot) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > -1) {
    const decimals = cleaned.length - lastDot - 1;
    normalized = decimals <= 2 ? normalized.replace(/,/g, "") : normalized.replace(/\./g, "").replace(/,/g, ".");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
