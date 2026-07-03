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
