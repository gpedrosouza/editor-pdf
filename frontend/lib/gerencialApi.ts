const GERENCIAL_API =
  process.env.NEXT_PUBLIC_GERENCIAL_API_URL ?? "http://localhost:8000";

export interface ScenarioParams {
  meta_lucro_pct: number;
  receita_bruta_alvo: number | null;
  aliquota_deducoes_pct: number;
  reducao_cmv_pct: number;
  reducao_despesas_pct: number;
  provisoes_ir_csl_pct: number;
}

export interface GerencialExtractResponse {
  dre: Record<string, unknown>;
  balanco: Record<string, unknown>;
  params: ScenarioParams;
}

export interface GerencialProjection {
  params: ScenarioParams;
  original: {
    dre: Record<string, unknown>;
    balanco: Record<string, unknown>;
    dre_totals: Record<string, number>;
    balanco_totals: Record<string, number>;
  };
  scenario: {
    dre: Record<string, unknown>;
    balanco: Record<string, unknown>;
    dre_totals: Record<string, number>;
    balanco_totals: Record<string, number>;
  };
  resumo: Record<string, number>;
}

export interface GerencialEstimateResponse extends GerencialExtractResponse {
  setor: {
    id: string;
    label: string;
  };
  projection: GerencialProjection;
}

export class GerencialApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "GerencialApiError";
  }
}

export async function extractGerencial(files: {
  pdf?: File | null;
  drePdf?: File | null;
  balancoPdf?: File | null;
}): Promise<GerencialExtractResponse> {
  const form = new FormData();
  if (files.pdf) {
    form.append("pdf", files.pdf);
  } else {
    if (files.drePdf) form.append("dre_pdf", files.drePdf);
    if (files.balancoPdf) form.append("balanco_pdf", files.balancoPdf);
  }

  const res = await fetch(`${GERENCIAL_API}/api/gerencial/extract`, {
    method: "POST",
    body: form,
  });
  return readJson<GerencialExtractResponse>(res);
}

export async function getEstimatorSectors(): Promise<{ id: string; label: string }[]> {
  const res = await fetch(`${GERENCIAL_API}/api/gerencial/estimator/sectors`);
  const data = await readJson<{ sectors: { id: string; label: string }[] }>(res);
  return data.sectors;
}

export async function estimateGerencial(payload: {
  faturamento: number;
  setor: string;
  empresa?: string;
  cnpj?: string;
  periodo?: string;
  cidade?: string;
  data_emissao?: string;
}): Promise<GerencialEstimateResponse> {
  const res = await fetch(`${GERENCIAL_API}/api/gerencial/estimate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson<GerencialEstimateResponse>(res);
}

export async function projectGerencial(payload: {
  dre: Record<string, unknown>;
  balanco: Record<string, unknown>;
  params: ScenarioParams;
}): Promise<GerencialProjection> {
  const res = await fetch(`${GERENCIAL_API}/api/gerencial/project`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson<GerencialProjection>(res);
}

export type GerencialLayout = "jacom" | "moderno" | "formal";

export async function generateGerencialPdf(payload: {
  dre: Record<string, unknown>;
  balanco: Record<string, unknown>;
  params: ScenarioParams;
  scenario?: {
    dre: Record<string, unknown>;
    balanco: Record<string, unknown>;
  };
  documento?: {
    cidade?: string;
    data_emissao?: string;
    empresario_nome?: string;
    empresario_cargo?: string;
    empresario_cpf?: string;
    contador_nome?: string;
    contador_crc?: string;
    contador_cpf?: string;
  };
  tipo: "dre" | "balanco" | "completo";
  layout?: GerencialLayout;
}): Promise<Blob> {
  const res = await fetch(`${GERENCIAL_API}/api/gerencial/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const data = await safeJson(res);
    throw new GerencialApiError(res.status, data?.detail ?? "Erro ao gerar PDF");
  }

  return res.blob();
}

export interface GerencialProjectionPayload {
  scenario: { dre: Record<string, unknown>; balanco: Record<string, unknown>; params: ScenarioParams };
  manual: { values: Record<string, number>; editedFields: string[] };
  editedParams: string[];
  bancosParceiros: { nome: string; valor: number }[];
  documento: {
    cidade: string;
    dataEmissao: string;
    businessOwnerName: string;
    businessOwnerRole: string;
    businessOwnerCpf: string;
    accountantName: string;
    accountantCrc: string;
    accountantCpf: string;
  };
  meta: {
    sourceMode: "pdf" | "estimate";
    uploadMode: "combined" | "separate";
    estimateRevenue: number;
    estimateSector: string;
    estimateCompany: string;
    estimateCnpj: string;
    estimatePeriod: string;
    pdfLayout: GerencialLayout;
  };
}

export interface GerencialProjectionSummary {
  id: number;
  nome: string;
  empresa: string;
  cnpj: string;
  created_at: string;
  updated_at: string;
}

export interface GerencialProjectionRecord extends GerencialProjectionSummary {
  payload: GerencialProjectionPayload;
}

export async function createGerencialProjection(
  nome: string,
  payload: GerencialProjectionPayload
): Promise<GerencialProjectionRecord> {
  const res = await fetch(`${GERENCIAL_API}/api/gerencial/projections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome, payload }),
  });
  return readJson<GerencialProjectionRecord>(res);
}

export async function listGerencialProjections(): Promise<GerencialProjectionSummary[]> {
  const res = await fetch(`${GERENCIAL_API}/api/gerencial/projections`);
  const data = await readJson<{ projections: GerencialProjectionSummary[] }>(res);
  return data.projections;
}

export async function getGerencialProjection(id: number): Promise<GerencialProjectionRecord> {
  const res = await fetch(`${GERENCIAL_API}/api/gerencial/projections/${id}`);
  return readJson<GerencialProjectionRecord>(res);
}

export async function updateGerencialProjection(
  id: number,
  nome: string,
  payload: GerencialProjectionPayload
): Promise<GerencialProjectionRecord> {
  const res = await fetch(`${GERENCIAL_API}/api/gerencial/projections/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome, payload }),
  });
  return readJson<GerencialProjectionRecord>(res);
}

export async function deleteGerencialProjection(id: number): Promise<void> {
  const res = await fetch(`${GERENCIAL_API}/api/gerencial/projections/${id}`, { method: "DELETE" });
  await readJson<{ deleted: boolean }>(res);
}

export interface CurvaAbcCliente {
  cnpj_cpf: string;
  nome: string;
  valor: number;
}

export async function estimateCurvaAbc(payload: {
  faturamento_total: number;
  numero_clientes?: number;
  concentracao?: number;
}): Promise<{ clientes: CurvaAbcCliente[]; total_clientes: number; total_valor: number }> {
  const res = await fetch(`${GERENCIAL_API}/api/gerencial/curva-abc/estimate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson(res);
}

export interface GenerateCurvaAbcPdfResult {
  blob: Blob;
  // -1 = check could not run, 0 = clean, >0 = collisions found
  colisoes: number;
}

export async function generateCurvaAbcPdf(payload: {
  clientes: CurvaAbcCliente[];
  periodo_ini: string;
  periodo_fim: string;
  empresa: string;
  versao_gerencial?: boolean;
  data_emissao?: string;
}): Promise<GenerateCurvaAbcPdfResult> {
  const res = await fetch(`${GERENCIAL_API}/api/gerencial/curva-abc/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const data = await safeJson(res);
    throw new GerencialApiError(res.status, data?.detail ?? "Erro ao gerar PDF da Curva ABC");
  }

  const colisoesHeader = Number(res.headers.get("X-Curva-Abc-Colisoes") ?? "-1");
  const blob = await res.blob();
  return { blob, colisoes: Number.isFinite(colisoesHeader) ? colisoesHeader : -1 };
}

export interface CurvaAbcProjectionPayload {
  clientes: CurvaAbcCliente[];
  meta: {
    empresa: string;
    periodo_ini: string;
    periodo_fim: string;
    data_emissao: string;
    modo: "real" | "estimate";
    versaoGerencial: boolean;
    faturamentoTotal: number;
    numeroClientes: number;
    concentracao: number;
  };
}

export interface CurvaAbcProjectionSummary {
  id: number;
  nome: string;
  empresa: string;
  periodo_ini: string;
  periodo_fim: string;
  modo: string;
  total_clientes: number;
  total_valor: number;
  created_at: string;
  updated_at: string;
}

export interface CurvaAbcProjectionRecord extends CurvaAbcProjectionSummary {
  payload: CurvaAbcProjectionPayload;
}

export async function createCurvaAbcProjection(
  nome: string,
  payload: CurvaAbcProjectionPayload
): Promise<CurvaAbcProjectionRecord> {
  const res = await fetch(`${GERENCIAL_API}/api/gerencial/curva-abc/projections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome, payload }),
  });
  return readJson(res);
}

export async function listCurvaAbcProjections(): Promise<CurvaAbcProjectionSummary[]> {
  const res = await fetch(`${GERENCIAL_API}/api/gerencial/curva-abc/projections`);
  const data = await readJson<{ projections: CurvaAbcProjectionSummary[] }>(res);
  return data.projections;
}

export async function getCurvaAbcProjection(id: number): Promise<CurvaAbcProjectionRecord> {
  const res = await fetch(`${GERENCIAL_API}/api/gerencial/curva-abc/projections/${id}`);
  return readJson(res);
}

export async function updateCurvaAbcProjection(
  id: number,
  nome: string,
  payload: CurvaAbcProjectionPayload
): Promise<CurvaAbcProjectionRecord> {
  const res = await fetch(`${GERENCIAL_API}/api/gerencial/curva-abc/projections/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nome, payload }),
  });
  return readJson(res);
}

export async function deleteCurvaAbcProjection(id: number): Promise<void> {
  const res = await fetch(`${GERENCIAL_API}/api/gerencial/curva-abc/projections/${id}`, { method: "DELETE" });
  await readJson<{ deleted: boolean }>(res);
}

async function readJson<T>(res: Response): Promise<T> {
  const data = await safeJson(res);
  if (!res.ok) {
    throw new GerencialApiError(res.status, data?.detail ?? "Erro na API gerencial");
  }
  return data as T;
}

async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
