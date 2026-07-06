"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  GerencialApiError,
  GerencialExtractResponse,
  GerencialProjection,
  ScenarioParams,
  estimateGerencial,
  extractGerencial,
  generateGerencialPdf,
  getEstimatorSectors,
  projectGerencial,
} from "@/lib/gerencialApi";

type SourceMode = "pdf" | "estimate";
type UploadMode = "combined" | "separate";
type BancoParceiro = { nome: string; valorText: string; valor: number };
type ManualField = "capital_pl" | "instalacoes" | "maquinas" | "salarios";

const MANUAL_FIELDS: ManualField[] = ["capital_pl", "instalacoes", "maquinas", "salarios"];
const MANUAL_FIELD_LABELS: Record<ManualField, string> = {
  capital_pl: "Capital Social",
  instalacoes: "Imoveis / Instalacoes (DRE + Balanco)",
  maquinas: "Maquinas e Equipamentos",
  salarios: "Salarios e Ordenados",
};
// Some benchmark rows are the same real-world figure duplicated across DRE
// and Balanco (e.g. "Alugueis de Imoveis" and "Imoveis / Instalacoes" share
// one input): filling the field once applies it to every listed target.
const MANUAL_FIELD_TARGETS: Record<ManualField, { dre?: string; balanco?: string }> = {
  capital_pl: { balanco: "capital_pl" },
  instalacoes: { dre: "alugueis", balanco: "instalacoes" },
  maquinas: { balanco: "maquinas" },
  salarios: { dre: "salarios" },
};

const DEFAULT_PARAMS: ScenarioParams = {
  meta_lucro_pct: 0.182,
  receita_bruta_alvo: null,
  aliquota_deducoes_pct: 0.275,
  reducao_cmv_pct: 0.25,
  reducao_despesas_pct: 0.6,
  provisoes_ir_csl_pct: 0.038,
};

const DEFAULT_DOCUMENT_DATE = new Date().toISOString().slice(0, 10);

export default function GerencialPage() {
  const skipNextProjectionRef = useRef(false);
  const editedParamsRef = useRef<Set<keyof ScenarioParams>>(new Set());
  const editedManualFieldsRef = useRef<Set<ManualField>>(new Set());
  const [sourceMode, setSourceMode] = useState<SourceMode>("pdf");
  const [uploadMode, setUploadMode] = useState<UploadMode>("combined");
  const [combinedPdf, setCombinedPdf] = useState<File | null>(null);
  const [drePdf, setDrePdf] = useState<File | null>(null);
  const [balancoPdf, setBalancoPdf] = useState<File | null>(null);
  const [estimatorSectors, setEstimatorSectors] = useState<{ id: string; label: string }[]>([
    { id: "industria", label: "Industria" },
  ]);
  const [estimateRevenue, setEstimateRevenue] = useState(0);
  const [estimateRevenueText, setEstimateRevenueText] = useState("");
  const [estimateSector, setEstimateSector] = useState("industria");
  const [estimateCompany, setEstimateCompany] = useState("");
  const [estimateCnpj, setEstimateCnpj] = useState("");
  const [estimatePeriod, setEstimatePeriod] = useState("");
  const [documentCity, setDocumentCity] = useState("BOTUCATU");
  const [documentDate, setDocumentDate] = useState(DEFAULT_DOCUMENT_DATE);
  const [businessOwnerName, setBusinessOwnerName] = useState("");
  const [businessOwnerRole, setBusinessOwnerRole] = useState("EMPRESARIO");
  const [businessOwnerCpf, setBusinessOwnerCpf] = useState("");
  const [accountantName, setAccountantName] = useState("");
  const [accountantCrc, setAccountantCrc] = useState("");
  const [accountantCpf, setAccountantCpf] = useState("");
  const [extracted, setExtracted] = useState<GerencialExtractResponse | null>(null);
  const [params, setParams] = useState<ScenarioParams>(DEFAULT_PARAMS);
  const [manualFieldTexts, setManualFieldTexts] = useState<Record<ManualField, string>>({
    capital_pl: "",
    instalacoes: "",
    maquinas: "",
    salarios: "",
  });
  const [manualFieldValues, setManualFieldValues] = useState<Record<ManualField, number>>({
    capital_pl: 0,
    instalacoes: 0,
    maquinas: 0,
    salarios: 0,
  });
  const [bancosParceiros, setBancosParceiros] = useState<BancoParceiro[]>([]);
  const [projection, setProjection] = useState<GerencialProjection | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isProjecting, setIsProjecting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");

  const canExtract = useMemo(() => {
    if (sourceMode === "estimate") return estimateRevenue > 0;
    if (uploadMode === "combined") return !!combinedPdf;
    return !!drePdf && !!balancoPdf;
  }, [balancoPdf, combinedPdf, drePdf, estimateRevenue, sourceMode, uploadMode]);

  useEffect(() => {
    getEstimatorSectors()
      .then((sectors) => {
        if (sectors.length === 0) return;
        setEstimatorSectors(sectors);
        setEstimateSector(sectors[0].id);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!extracted) return;
    if (skipNextProjectionRef.current) {
      skipNextProjectionRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void runProjection(extracted, params);
    }, 250);
    return () => clearTimeout(timer);
  }, [extracted, params, manualFieldValues, bancosParceiros]);

  async function handleExtract() {
    if (!canExtract || isExtracting) return;
    setIsExtracting(true);
    setError("");
    try {
      if (sourceMode === "estimate") {
        const data = await estimateGerencial({
          faturamento: estimateRevenue,
          setor: estimateSector,
          empresa: estimateCompany,
          cnpj: estimateCnpj,
          periodo: estimatePeriod,
          cidade: documentCity,
          data_emissao: documentDate,
        });
        const nextParams = mergeGeneratedParams({ ...DEFAULT_PARAMS, ...data.params });
        skipNextProjectionRef.current = true;
        setExtracted(data);
        setParams(nextParams);
        syncManualFieldsFromExtracted(data.dre, data.balanco);
        await runProjection(data, nextParams);
      } else {
        const data = await extractGerencial({
          pdf: uploadMode === "combined" ? combinedPdf : null,
          drePdf: uploadMode === "separate" ? drePdf : null,
          balancoPdf: uploadMode === "separate" ? balancoPdf : null,
        });
        const nextParams = mergeGeneratedParams({ ...DEFAULT_PARAMS, ...data.params });
        skipNextProjectionRef.current = true;
        setExtracted(data);
        setParams(nextParams);
        syncManualFieldsFromExtracted(data.dre, data.balanco);
        await runProjection(data, nextParams);
      }
    } catch (err) {
      setError(getErrorMessage(err));
      setProjection(null);
    } finally {
      setIsExtracting(false);
    }
  }

  async function runProjection(data: GerencialExtractResponse, nextParams: ScenarioParams) {
    setIsProjecting(true);
    setError("");
    try {
      const next = await projectGerencial({
        dre: buildDreOverrides(data.dre),
        balanco: buildBalancoOverrides(data.balanco),
        params: nextParams,
      });
      setProjection(next);
      if (next.resumo.meta_lucro_ativa) {
        const reducaoCmv = next.resumo.reducao_cmv_calculada;
        const reducaoDespesas = next.resumo.reducao_despesas_calculada;
        if (Number.isFinite(reducaoCmv) && Number.isFinite(reducaoDespesas)) {
          skipNextProjectionRef.current = true;
          setParams((prev) => ({
            ...prev,
            reducao_cmv_pct: reducaoCmv,
            reducao_despesas_pct: reducaoDespesas,
          }));
        }
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsProjecting(false);
    }
  }

  async function handleGenerate(tipo: "dre" | "balanco" | "completo") {
    if (!extracted || isGenerating) return;
    setIsGenerating(true);
    setError("");
    try {
      const blob = await generateGerencialPdf({
        dre: buildDreOverrides(extracted.dre),
        balanco: buildBalancoOverrides(extracted.balanco),
        params,
        documento: {
          cidade: documentCity,
          data_emissao: documentDate,
          empresario_nome: businessOwnerName,
          empresario_cargo: businessOwnerRole,
          empresario_cpf: businessOwnerCpf,
          contador_nome: accountantName,
          contador_crc: accountantCrc,
          contador_cpf: accountantCpf,
        },
        scenario: projection
          ? {
              dre: {
                ...projection.scenario.dre,
                cidade: documentCity,
                data_emissao: documentDate,
                empresario_nome: businessOwnerName,
                empresario_cargo: businessOwnerRole,
                empresario_cpf: businessOwnerCpf,
                contador_nome: accountantName,
                contador_crc: accountantCrc,
                contador_cpf: accountantCpf,
              },
              balanco: projection.scenario.balanco,
            }
          : undefined,
        tipo,
      });
      downloadBlob(blob, filenameFor(tipo));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <main className="min-h-screen bg-app-bg text-primary">
      <header className="h-[52px] border-b border-[#2a2d3a] bg-[#161920] px-4 flex items-center gap-3">
        <div className="w-[26px] h-[26px] rounded-md bg-[#6366F1] flex items-center justify-center">
          <FileIcon />
        </div>
        <div className="font-medium text-sm">Projecao Gerencial</div>
        <div className="flex-1" />
        {isProjecting && <span className="text-xs text-muted">Calculando...</span>}
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-0 min-h-[calc(100vh-52px)]">
        <aside className="bg-[#161920] border-r border-[#2a2d3a] p-4 space-y-4">
          <section className="border border-[#2a2d3a] rounded-lg bg-[#1e2130] p-3 space-y-3">
            <SectionTitle>Origem</SectionTitle>
            <SegmentedControl
              value={sourceMode}
              onChange={setSourceMode}
              options={[
                { value: "pdf", label: "PDF existente" },
                { value: "estimate", label: "Faturamento" },
              ]}
            />

            {sourceMode === "pdf" ? (
              <>
                <SegmentedControl
                  value={uploadMode}
                  onChange={setUploadMode}
                  options={[
                    { value: "combined", label: "PDF unico" },
                    { value: "separate", label: "Separados" },
                  ]}
                />

                {uploadMode === "combined" ? (
                  <FileField label="DRE + Balanco" file={combinedPdf} onChange={setCombinedPdf} />
                ) : (
                  <>
                    <FileField label="DRE" file={drePdf} onChange={setDrePdf} />
                    <FileField label="Balanco" file={balancoPdf} onChange={setBalancoPdf} />
                  </>
                )}
              </>
            ) : (
              <>
                <SelectField
                  label="Setor"
                  value={estimateSector}
                  onChange={setEstimateSector}
                  options={estimatorSectors}
                />
                <MoneyField
                  label="Faturamento anual"
                  value={estimateRevenueText}
                  onChange={(value) => {
                    setEstimateRevenueText(value);
                    setEstimateRevenue(parseMoneyInput(value));
                  }}
                />
                <TextField label="Razao social" value={estimateCompany} onChange={setEstimateCompany} />
                <TextField label="CNPJ" value={estimateCnpj} onChange={setEstimateCnpj} />
                <TextField
                  label="Exercicio"
                  value={estimatePeriod}
                  onChange={setEstimatePeriod}
                  placeholder="01/01/2025 - 31/12/2025"
                />
              </>
            )}

            <button
              onClick={handleExtract}
              disabled={!canExtract || isExtracting}
              className="w-full h-9 rounded-md bg-[#6366F1] text-white text-sm font-medium disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isExtracting ? <SpinnerIcon /> : sourceMode === "estimate" ? <FileIcon /> : <UploadIcon />}
              {isExtracting
                ? sourceMode === "estimate"
                  ? "Estimando..."
                  : "Extraindo..."
                : sourceMode === "estimate"
                ? "Gerar estimativa"
                : "Extrair dados"}
            </button>
          </section>

          <section className="border border-[#2a2d3a] rounded-lg bg-[#1e2130] p-3 space-y-3">
            <SectionTitle>Parametros</SectionTitle>
            <NumberField
              label="Meta lucro liquido"
              suffix="%"
              value={params.meta_lucro_pct * 100}
              onChange={(value) => setParam("meta_lucro_pct", value / 100)}
            />
            <NumberField
              label="RB alvo"
              value={params.receita_bruta_alvo ?? 0}
              onChange={(value) => setParam("receita_bruta_alvo", value)}
            />
            <NumberField
              label="Deducoes"
              suffix="%"
              value={params.aliquota_deducoes_pct * 100}
              onChange={(value) => setParam("aliquota_deducoes_pct", value / 100)}
            />
            <NumberField
              label="Reducao CMV"
              suffix="%"
              value={params.reducao_cmv_pct * 100}
              onChange={(value) => setParam("reducao_cmv_pct", value / 100)}
            />
            <NumberField
              label="Reducao despesas"
              suffix="%"
              value={params.reducao_despesas_pct * 100}
              onChange={(value) => setParam("reducao_despesas_pct", value / 100)}
            />
            <NumberField
              label="IR/CSL"
              suffix="%"
              value={params.provisoes_ir_csl_pct * 100}
              onChange={(value) => setParam("provisoes_ir_csl_pct", value / 100)}
            />
          </section>

          <section className="border border-[#2a2d3a] rounded-lg bg-[#1e2130] p-3 space-y-3">
            <SectionTitle>Balanco</SectionTitle>
            {MANUAL_FIELDS.map((field) => (
              <MoneyField
                key={field}
                label={MANUAL_FIELD_LABELS[field]}
                value={manualFieldTexts[field]}
                onChange={(value) => updateManualField(field, value)}
              />
            ))}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">Bancos parceiros</span>
                <button
                  onClick={addBancoParceiro}
                  className="text-[11px] text-[#6366F1] font-medium"
                >
                  + Adicionar
                </button>
              </div>
              {bancosParceiros.length === 0 && (
                <p className="text-[11px] text-faint">Nenhum banco adicionado.</p>
              )}
              {bancosParceiros.map((banco, index) => (
                <div key={index} className="grid grid-cols-[1fr_100px_20px] gap-2 items-center">
                  <input
                    type="text"
                    value={banco.nome}
                    placeholder="Nome do banco"
                    onChange={(event) => updateBancoParceiroNome(index, event.target.value)}
                    className="w-full h-8 rounded-md border border-[#2a2d3a] bg-[#13151f] px-2 text-xs text-[#e2e4ef] outline-none focus:border-[#6366F1]"
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    value={banco.valorText}
                    placeholder="0,00"
                    onChange={(event) => updateBancoParceiroValor(index, event.target.value)}
                    className="w-full h-8 rounded-md border border-[#2a2d3a] bg-[#13151f] px-2 text-right text-xs text-[#e2e4ef] outline-none focus:border-[#6366F1]"
                  />
                  <button
                    onClick={() => removeBancoParceiro(index)}
                    aria-label="Remover banco"
                    className="h-8 w-5 flex items-center justify-center text-faint hover:text-[#ffb4b4]"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="border border-[#2a2d3a] rounded-lg bg-[#1e2130] p-3 space-y-3">
            <SectionTitle>Documento</SectionTitle>
            <TextField label="Cidade" value={documentCity} onChange={setDocumentCity} />
            <DateField label="Data emissao" value={documentDate} onChange={setDocumentDate} />
            <TextField label="Empresario" value={businessOwnerName} onChange={setBusinessOwnerName} />
            <TextField label="Cargo" value={businessOwnerRole} onChange={setBusinessOwnerRole} />
            <TextField label="CPF empresario" value={businessOwnerCpf} onChange={setBusinessOwnerCpf} />
            <TextField label="Contador" value={accountantName} onChange={setAccountantName} />
            <TextField label="CRC contador" value={accountantCrc} onChange={setAccountantCrc} />
            <TextField label="CPF contador" value={accountantCpf} onChange={setAccountantCpf} />
          </section>

          <section className="border border-[#2a2d3a] rounded-lg bg-[#1e2130] p-3 space-y-2">
            <SectionTitle>Gerar PDF</SectionTitle>
            <ActionButton disabled={!projection || isGenerating} onClick={() => handleGenerate("completo")}>
              <DownloadIcon />
              Completo
            </ActionButton>
            <div className="grid grid-cols-2 gap-2">
              <ActionButton muted disabled={!projection || isGenerating} onClick={() => handleGenerate("dre")}>
                DRE
              </ActionButton>
              <ActionButton muted disabled={!projection || isGenerating} onClick={() => handleGenerate("balanco")}>
                Balanco
              </ActionButton>
            </div>
          </section>

          {error && (
            <div className="border border-[#6E1A1A] bg-[#2a1114] text-[#ffb4b4] text-xs rounded-md p-3 leading-relaxed">
              {error}
            </div>
          )}
        </aside>

        <section className="p-4 md:p-6 overflow-auto">
          {!projection ? (
            <EmptyState />
          ) : (
            <div className="space-y-5 max-w-6xl">
              <MetricGrid projection={projection} />
              <ResultsTable
                title="DRE"
                rows={[
                  ["Receita Bruta", "receita_bruta", "currency"],
                  ["Deducoes", "deducoes", "currency"],
                  ["Receita Liquida", "receita_liquida", "currency"],
                  ["Custos", "custos", "currency"],
                  ["Lucro Bruto", "lucro_bruto", "currency"],
                  ["Despesas Operacionais", "despesas_operacionais", "currency"],
                  ["Despesas Financeiras", "despesas_financeiras", "currency"],
                  ["Receitas Financeiras", "receitas_financeiras", "currency"],
                  ["Resultado Operacional", "resultado_operacional", "currency"],
                  ["Provisoes IR/CSL", "provisoes", "currency"],
                  ["Resultado do Exercicio", "resultado_exercicio", "currency"],
                  ["Margem Liquida", "margem_liquida", "percent"],
                ]}
                original={projection.original.dre_totals}
                scenario={projection.scenario.dre_totals}
              />
              <ResultsTable
                title="Balanco"
                rows={[
                  ["Ativo Circulante", "ativo_circulante", "currency"],
                  ["Ativo Nao-Circulante", "ativo_nao_circulante", "currency"],
                  ["Ativo Total", "ativo_total", "currency"],
                  ["Passivo Circulante", "passivo_circulante", "currency"],
                  ["Passivo Nao-Circulante", "passivo_nao_circulante", "currency"],
                  ["Patrimonio Liquido", "patrimonio_liquido", "currency"],
                  ["Passivo + PL", "passivo_pl_total", "currency"],
                  ["Diferenca", "diferenca", "currency"],
                ]}
                original={projection.original.balanco_totals}
                scenario={projection.scenario.balanco_totals}
              />
            </div>
          )}
        </section>
      </div>
    </main>
  );

  function setParam(key: keyof ScenarioParams, value: number) {
    editedParamsRef.current.add(key);
    setParams((prev) => ({ ...prev, [key]: Number.isFinite(value) ? value : 0 }));
  }

  function buildBalancoOverrides(balanco: Record<string, unknown>): Record<string, unknown> {
    const next: Record<string, unknown> = {
      ...balanco,
      bancos_parceiros: bancosParceiros
        .filter((banco) => banco.nome.trim() !== "")
        .map((banco) => ({ nome: banco.nome.trim(), valor: banco.valor })),
    };
    for (const field of MANUAL_FIELDS) {
      const targetKey = MANUAL_FIELD_TARGETS[field].balanco;
      if (targetKey && editedManualFieldsRef.current.has(field)) {
        next[targetKey] = manualFieldValues[field];
      }
    }
    return next;
  }

  function buildDreOverrides(dre: Record<string, unknown>): Record<string, unknown> {
    const next: Record<string, unknown> = { ...dre };
    const pinnedFields: string[] = [];
    for (const field of MANUAL_FIELDS) {
      const targetKey = MANUAL_FIELD_TARGETS[field].dre;
      if (targetKey && editedManualFieldsRef.current.has(field)) {
        next[targetKey] = manualFieldValues[field];
        pinnedFields.push(targetKey);
      }
    }
    // Manually entered DRE lines are treated as fixed: the reducao_cmv/despesas
    // solver (when a net-profit target is active) recalculates around them
    // instead of scaling them down, so the target profit is still met.
    next._pinned_fields = pinnedFields;
    return next;
  }

  // Keeps the manual-override inputs showing the current extracted/estimated
  // value until the user actually types in them; fields already edited by
  // the user keep their value across a new extraction/estimate. When a field
  // has both a dre and a balanco target, the balanco side is used as the
  // display source (both start out equal, before any manual edit).
  function syncManualFieldsFromExtracted(
    dre: Record<string, unknown>,
    balanco: Record<string, unknown>
  ) {
    const sourceFor = (field: ManualField) => {
      const targets = MANUAL_FIELD_TARGETS[field];
      const source = targets.balanco ? balanco : dre;
      const key = targets.balanco ?? targets.dre;
      return key ? Number(source[key]) || 0 : 0;
    };
    setManualFieldTexts((prev) => {
      const next = { ...prev };
      for (const field of MANUAL_FIELDS) {
        if (editedManualFieldsRef.current.has(field)) continue;
        next[field] = formatMoneyInput(sourceFor(field));
      }
      return next;
    });
    setManualFieldValues((prev) => {
      const next = { ...prev };
      for (const field of MANUAL_FIELDS) {
        if (editedManualFieldsRef.current.has(field)) continue;
        next[field] = sourceFor(field);
      }
      return next;
    });
  }

  function updateManualField(field: ManualField, text: string) {
    editedManualFieldsRef.current.add(field);
    setManualFieldTexts((prev) => ({ ...prev, [field]: text }));
    setManualFieldValues((prev) => ({ ...prev, [field]: parseMoneyInput(text) }));
  }

  function addBancoParceiro() {
    setBancosParceiros((prev) => [...prev, { nome: "", valorText: "", valor: 0 }]);
  }

  function updateBancoParceiroNome(index: number, nome: string) {
    setBancosParceiros((prev) => prev.map((banco, i) => (i === index ? { ...banco, nome } : banco)));
  }

  function updateBancoParceiroValor(index: number, valorText: string) {
    setBancosParceiros((prev) =>
      prev.map((banco, i) =>
        i === index ? { ...banco, valorText, valor: parseMoneyInput(valorText) } : banco
      )
    );
  }

  function removeBancoParceiro(index: number) {
    setBancosParceiros((prev) => prev.filter((_, i) => i !== index));
  }

  function mergeGeneratedParams(generated: ScenarioParams): ScenarioParams {
    return (Object.keys(generated) as (keyof ScenarioParams)[]).reduce(
      (acc, key) => {
        if (editedParamsRef.current.has(key)) {
          return { ...acc, [key]: params[key] };
        }
        return acc;
      },
      generated
    );
  }
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-semibold text-[#e2e4ef] uppercase tracking-[0]">{children}</h2>;
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="grid grid-cols-2 rounded-md border border-[#2a2d3a] overflow-hidden">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={[
            "h-8 text-xs transition-colors",
            value === option.value ? "bg-[#6366F1] text-white" : "bg-[#13151f] text-muted",
          ].join(" ")}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { id: string; label: string }[];
}) {
  return (
    <label className="grid grid-cols-[1fr_132px] items-center gap-3">
      <span className="text-xs text-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full h-8 rounded-md border border-[#2a2d3a] bg-[#13151f] px-2 text-xs text-[#e2e4ef] outline-none focus:border-[#6366F1]"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FileField({
  label,
  file,
  onChange,
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="file"
        accept=".pdf,application/pdf"
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
        className="block w-full text-xs text-muted file:mr-3 file:h-8 file:rounded-md file:border-0 file:bg-[#2a2d3a] file:px-3 file:text-xs file:text-[#e2e4ef]"
      />
      {file && <span className="block text-[11px] text-faint truncate">{file.name}</span>}
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="grid grid-cols-[1fr_132px] items-center gap-3">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full h-8 rounded-md border border-[#2a2d3a] bg-[#13151f] px-2 text-xs text-[#e2e4ef] outline-none focus:border-[#6366F1]"
      />
    </label>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid grid-cols-[1fr_132px] items-center gap-3">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full h-8 rounded-md border border-[#2a2d3a] bg-[#13151f] px-2 text-xs text-[#e2e4ef] outline-none focus:border-[#6366F1]"
      />
    </label>
  );
}

function MoneyField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid grid-cols-[1fr_132px] items-center gap-3">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        placeholder="7.340.200,21"
        onChange={(event) => onChange(event.target.value)}
        className="w-full h-8 rounded-md border border-[#2a2d3a] bg-[#13151f] px-2 text-right text-xs text-[#e2e4ef] outline-none focus:border-[#6366F1]"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <label className="grid grid-cols-[1fr_132px] items-center gap-3">
      <span className="text-xs text-muted">{label}</span>
      <div className="relative">
        <input
          type="number"
          step="0.01"
          value={Number.isFinite(value) ? value : 0}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-full h-8 rounded-md border border-[#2a2d3a] bg-[#13151f] px-2 pr-7 text-right text-xs text-[#e2e4ef] outline-none focus:border-[#6366F1]"
        />
        {suffix && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-faint">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}

function ActionButton({
  children,
  disabled,
  muted,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={[
        "w-full h-9 rounded-md text-sm font-medium disabled:opacity-45 disabled:cursor-not-allowed flex items-center justify-center gap-2",
        muted ? "border border-[#2a2d3a] text-muted" : "bg-[#085041] text-white",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function MetricGrid({ projection }: { projection: GerencialProjection }) {
  const rows = [
    ["Resultado", formatCurrency(projection.scenario.dre_totals.resultado_exercicio)],
    ["Margem", formatPercent(projection.scenario.dre_totals.margem_liquida)],
    ["Meta", formatCurrency(projection.resumo.meta_lucro_valor)],
    ["Dif. meta", formatCurrency(projection.resumo.diferenca_meta)],
    ["Red. CMV", formatPercent(projection.resumo.reducao_cmv_calculada)],
    ["Red. desp.", formatPercent(projection.resumo.reducao_despesas_calculada)],
    ["Ativo", formatCurrency(projection.scenario.balanco_totals.ativo_total)],
    ["A - P+PL", formatCurrency(projection.scenario.balanco_totals.diferenca)],
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-[#2a2d3a] bg-[#161920] p-3">
          <div className="text-[11px] text-faint">{label}</div>
          <div className="mt-1 text-sm font-semibold text-[#e2e4ef] truncate">{value}</div>
        </div>
      ))}
    </div>
  );
}

function ResultsTable({
  title,
  rows,
  original,
  scenario,
}: {
  title: string;
  rows: [string, string, "currency" | "percent"][];
  original: Record<string, number>;
  scenario: Record<string, number>;
}) {
  return (
    <section className="rounded-lg border border-[#2a2d3a] bg-[#161920] overflow-hidden">
      <div className="h-10 px-3 flex items-center border-b border-[#2a2d3a]">
        <h2 className="text-sm font-medium text-[#e2e4ef]">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-faint bg-[#13151f]">
            <tr>
              <th className="text-left font-medium px-3 py-2">Indicador</th>
              <th className="text-right font-medium px-3 py-2">Original</th>
              <th className="text-right font-medium px-3 py-2">Cenario</th>
              <th className="text-right font-medium px-3 py-2">Variacao</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, key, type]) => {
              const originalValue = original[key] ?? 0;
              const scenarioValue = scenario[key] ?? 0;
              return (
                <tr key={key} className="border-t border-[#242735]">
                  <td className="px-3 py-2 text-muted">{label}</td>
                  <td className="px-3 py-2 text-right text-[#e2e4ef]">
                    {formatValue(originalValue, type)}
                  </td>
                  <td className="px-3 py-2 text-right text-[#e2e4ef]">
                    {formatValue(scenarioValue, type)}
                  </td>
                  <td className="px-3 py-2 text-right text-muted">
                    {type === "percent"
                      ? ""
                      : formatPercent(variation(originalValue, scenarioValue))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="h-full min-h-[420px] flex items-center justify-center">
      <div className="text-center">
        <div className="mx-auto w-12 h-12 rounded-lg border border-[#2a2d3a] flex items-center justify-center text-[#4a4e63]">
          <FileIcon />
        </div>
        <p className="mt-3 text-sm text-muted">Nenhum cenario carregado.</p>
      </div>
    </div>
  );
}

function formatValue(value: number, type: "currency" | "percent") {
  return type === "percent" ? formatPercent(value) : formatCurrency(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatMoneyInput(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function variation(original: number, scenario: number) {
  if (!original) return 0;
  return scenario / original - 1;
}

function parseMoneyInput(value: string) {
  const cleaned = value.trim().replace(/[^\d,.-]/g, "");
  if (!cleaned) return 0;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const decimalSeparator = lastComma > lastDot ? "," : lastDot > -1 ? "." : "";

  let normalized = cleaned;
  if (decimalSeparator === ",") {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (decimalSeparator === ".") {
    const decimals = cleaned.length - lastDot - 1;
    normalized = decimals <= 2
      ? normalized.replace(/,/g, "")
      : normalized.replace(/\./g, "").replace(/,/g, ".");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getErrorMessage(err: unknown) {
  if (err instanceof GerencialApiError) return err.message;
  if (err instanceof TypeError) return "Nao foi possivel conectar a API gerencial.";
  return "Erro inesperado no fluxo gerencial.";
}

function filenameFor(tipo: "dre" | "balanco" | "completo") {
  if (tipo === "dre") return "DRE_GERENCIAL.pdf";
  if (tipo === "balanco") return "BALANCO_GERENCIAL.pdf";
  return "DEMONSTRACOES_GERENCIAIS.pdf";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

function FileIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" strokeWidth="2.5" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
