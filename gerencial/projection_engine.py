"""Pure calculation engine for the JACOM managerial projection flow.

The extractor returns most accounting lines as positive magnitudes. This module
keeps that convention for line items and applies accounting signs only when
calculating totals.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, replace
import re
from typing import Any, Mapping


DRE_RECEITA_FIELDS = [
    "venda_produtos",
    "venda_produtos_export",
    "venda_mercadorias",
    "venda_mercadorias_export",
    "servicos_prestados",
]

DRE_DEDUCAO_FIELDS = [
    "devolucao",
    "ipi_ded",
    "icms_ded",
    "cofins",
    "pis",
    "subst_trib",
]

DRE_CUSTO_FIELDS = [
    "industrializacao",
    "bonificacao",
    "icms_dif_aliq",
    "cpv",
    "cmv",
]

DRE_PESSOAL_FIELDS = [
    "salarios",
    "pro_labore",
    "premios",
    "decimo_terceiro",
    "ferias",
    "inss_desp",
    "fgts",
    "indenizacoes",
    "assist_medica",
    "adicionais",
    "alim_pessoal",
    "horas_extras",
    "uniformes",
]

DRE_ADMIN_FIELDS = [
    "alugueis",
    "embalagens_adm",
    "internet",
    "bens_peq_valor",
    "equip_seguranca",
    "manut_maq",
    "limpeza",
    "associacoes",
    "cartorios",
    "equip_protecao",
    "mat_laboratorio",
    "manut_veiculos",
]

DRE_TRIBUTARIA_FIELDS = [
    "ipva",
    "taxas_diversas",
    "taxas_vig_san",
    "icms_nao_contrib",
    "taxas_iss",
]

DRE_GERAL_FIELDS = [
    "energia",
    "agua",
    "telefone",
    "postais",
    "seguros",
    "mat_escritorio",
    "mat_higiene",
    "assist_contabil",
    "serv_terceiros",
    "depreciacao",
    "propaganda",
    "assessoria",
    "mat_consumo",
    "combustiveis",
    "seg_patrim",
    "suporte_tecnico",
    "treinamento",
    "alim_geral",
    "agenciamento",
    "dedetizacao",
    "desp_medica",
    "software",
    "fretes",
    "manut_reparo",
]

DRE_DESPESA_OPERACIONAL_FIELDS = (
    DRE_PESSOAL_FIELDS
    + DRE_ADMIN_FIELDS
    + DRE_TRIBUTARIA_FIELDS
    + DRE_GERAL_FIELDS
)

DRE_DESPESA_FINANCEIRA_FIELDS = [
    "juros_passivos",
    "taxas_cambiais",
    "iof",
    "juros_comissoes",
    "juros_emp",
    "multas_mora",
    "tarifa_bancaria",
]

DRE_RECEITA_FINANCEIRA_FIELDS = [
    "juros_aplicacoes",
    "juros_ativos",
    "descontos_fin",
    "bonif_amostras",
]

DRE_PROVISAO_FIELDS = ["csll", "irpj"]

DRE_VALUE_FIELDS = (
    DRE_RECEITA_FIELDS
    + DRE_DEDUCAO_FIELDS
    + DRE_CUSTO_FIELDS
    + DRE_DESPESA_OPERACIONAL_FIELDS
    + DRE_DESPESA_FINANCEIRA_FIELDS
    + DRE_RECEITA_FINANCEIRA_FIELDS
    + DRE_PROVISAO_FIELDS
)


BAL_DISPONIVEL_FIELDS = [
    "caixa_geral",
    "cef",
    "sicoob_mov",
    "bb_aplic",
    "santander_aplic",
    "titulo_cap",
]

BAL_CLIENTES_FIELDS = ["clientes"]

BAL_OUTROS_CREDITOS_CMV_FIELDS = ["adiant_forn_1"]
BAL_OUTROS_CREDITOS_DESP_FIELDS = ["adiant_ferias"]
BAL_OUTROS_CREDITOS_DED_FIELDS = ["ipi_rec", "icms_rec"]

BAL_ESTOQUE_FIELDS = ["merc_revenda", "prod_acabados"]

BAL_ATIVO_NAO_CIRC_FIELDS = [
    "emp_socios",
    "gran_belle",
    "solution_vet",
    "quotas_sicoob",
    "banco_sicoob_inv",
    "instalacoes",
    "moveis",
    "maquinas",
    "equip_ti",
    "veiculos",
    "dep_moveis",
    "dep_maquinas",
    "dep_veiculos",
    "dep_ti",
    "dep_instalacoes",
]

BAL_COMPENSACAO_ATIVO_FIELDS = ["bens_comodato"]

BAL_PASSIVO_CP_MANTIDO_FIELDS = [
    "sicoob_cc",
    "santander_cc",
    "sicoob_1320100",
    "sicoob_1264152",
    "sicoob_01606720",
    "bb_conta_garantida",
    "bb_giro_peac",
    "santander_peac",
    "bb_capital_giro",
    "santander_garantida",
]

BAL_FORNECEDORES_FIELDS = ["fornecedores_total"]

BAL_PASSIVO_DED_FIELDS = [
    "ipi_rel",
    "irpj_rel",
    "csll_rel",
    "irrf_rel",
    "pis_rel",
    "cofins_rel",
    "crf_rel",
    "inss_ret_rel",
    "icms_st_rel",
    "ir_aluguel",
]

BAL_PASSIVO_DESP_FIELDS = [
    "sal_pagar",
    "pro_labore_pagar",
    "pensao",
    "inss_rel",
    "fgts_rel",
    "irrf_folha",
]

BAL_PASSIVO_CIRC_MANTIDO_FIELDS = [
    "adiant_clientes",
    "parc_cp_items",
]

BAL_PASSIVO_NAO_CIRC_FIELDS = ["emp_lp", "parc_lp_items"]

BAL_PL_FIELDS = [
    "capital_pl",
    "prej_acum",
    "ajustes_ex_ant",
    "bens_comodato",
]

BAL_EXTRA_FIELDS = ["emp_compulsorios"]

BAL_VALUE_FIELDS = (
    BAL_DISPONIVEL_FIELDS
    + BAL_CLIENTES_FIELDS
    + BAL_OUTROS_CREDITOS_CMV_FIELDS
    + BAL_OUTROS_CREDITOS_DESP_FIELDS
    + BAL_OUTROS_CREDITOS_DED_FIELDS
    + BAL_ESTOQUE_FIELDS
    + BAL_ATIVO_NAO_CIRC_FIELDS
    + BAL_COMPENSACAO_ATIVO_FIELDS
    + BAL_PASSIVO_CP_MANTIDO_FIELDS
    + BAL_FORNECEDORES_FIELDS
    + BAL_PASSIVO_DED_FIELDS
    + BAL_PASSIVO_DESP_FIELDS
    + BAL_PASSIVO_CIRC_MANTIDO_FIELDS
    + BAL_PASSIVO_NAO_CIRC_FIELDS
    + BAL_PL_FIELDS
    + BAL_EXTRA_FIELDS
)


@dataclass(frozen=True)
class ScenarioParams:
    meta_lucro_pct: float = 0.182
    receita_bruta_alvo: float | None = None
    aliquota_deducoes_pct: float = 0.275
    reducao_cmv_pct: float = 0.25
    reducao_despesas_pct: float = 0.60
    provisoes_ir_csl_pct: float = 0.038

    @classmethod
    def from_mapping(cls, raw: Mapping[str, Any] | None) -> "ScenarioParams":
        raw = raw or {}
        return cls(
            meta_lucro_pct=_rate(_pick(raw, "meta_lucro_pct", "metaLucroPct", default=0.182)),
            receita_bruta_alvo=_optional_float(
                _pick(raw, "receita_bruta_alvo", "rb_alvo", "rbAlvo", default=None)
            ),
            aliquota_deducoes_pct=_rate(
                _pick(raw, "aliquota_deducoes_pct", "aliquotaDeducoesPct", default=0.275)
            ),
            reducao_cmv_pct=_rate(_pick(raw, "reducao_cmv_pct", "reducaoCmvPct", default=0.25)),
            reducao_despesas_pct=_rate(
                _pick(raw, "reducao_despesas_pct", "reducaoDespesasPct", default=0.60)
            ),
            provisoes_ir_csl_pct=_rate(
                _pick(raw, "provisoes_ir_csl_pct", "provisoesIrCslPct", default=0.038)
            ),
        )


def project_all(
    dre: Mapping[str, Any],
    balanco: Mapping[str, Any] | None,
    params: ScenarioParams | Mapping[str, Any] | None,
) -> dict[str, Any]:
    scenario_params = params if isinstance(params, ScenarioParams) else ScenarioParams.from_mapping(params)
    original_dre = normalize_dre(dre)
    original_balanco = normalize_balanco(balanco or {})

    dre_original_totals = calculate_dre_totals(original_dre)
    dre_scenario = project_dre(original_dre, scenario_params)
    dre_scenario_totals = calculate_dre_totals(dre_scenario)

    effective_params = replace(
        scenario_params,
        reducao_cmv_pct=float(
            dre_scenario.get("_reducao_cmv_calculada", scenario_params.reducao_cmv_pct)
        ),
        reducao_despesas_pct=float(
            dre_scenario.get("_reducao_despesas_calculada", scenario_params.reducao_despesas_pct)
        ),
    )

    balanco_scenario = project_balanco(
        original_balanco,
        original_dre_totals=dre_original_totals,
        scenario_dre_totals=dre_scenario_totals,
        params=effective_params,
    )
    balanco_original_totals = calculate_balanco_totals(original_balanco)
    balanco_scenario_totals = calculate_balanco_totals(balanco_scenario)

    return {
        "params": asdict(scenario_params),
        "original": {
            "dre": original_dre,
            "balanco": original_balanco,
            "dre_totals": dre_original_totals,
            "balanco_totals": balanco_original_totals,
        },
        "scenario": {
            "dre": dre_scenario,
            "balanco": balanco_scenario,
            "dre_totals": dre_scenario_totals,
            "balanco_totals": balanco_scenario_totals,
        },
        "resumo": build_resumo(
            scenario_params,
            dre_original_totals,
            dre_scenario_totals,
            balanco_original_totals,
            balanco_scenario_totals,
            dre_scenario,
        ),
    }


def normalize_dre(raw: Mapping[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    meta = raw.get("meta") if isinstance(raw.get("meta"), Mapping) else {}
    out["meta"] = dict(meta)
    out["empresa"] = str(meta.get("empresa") or raw.get("empresa") or "")
    out["cnpj"] = str(meta.get("cnpj") or raw.get("cnpj") or "")
    out["periodo"] = str(meta.get("periodo") or raw.get("periodo") or "")
    data_ini, data_fim = parse_periodo(out["periodo"])
    out["data_ini"] = str(raw.get("data_ini") or data_ini)
    out["data_fim"] = str(raw.get("data_fim") or data_fim)
    out["cidade"] = str(raw.get("cidade") or "BOTUCATU")

    for field in DRE_VALUE_FIELDS:
        out[field] = _number(raw.get(field, 0.0))

    for key, value in raw.items():
        if key not in out and key != "meta":
            out[key] = value
    return out


def normalize_balanco(raw: Mapping[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {field: _number(raw.get(field, 0.0)) for field in BAL_VALUE_FIELDS}

    # The current extractor does not read a total fornecedores line; the
    # validated workbook uses this fixed value until the extraction is expanded.
    out["fornecedores_total"] = _number(raw.get("fornecedores_total", 1_408_890.43))

    # Bancos parceiros are company-specific and can't be benchmarked or
    # extracted generically, so they are entered by hand: a free-form list of
    # {nome, valor} pairs. A bank can be listed with valor 0 when the name is
    # known but the balance isn't.
    out["bancos_parceiros"] = normalize_bancos_parceiros(raw.get("bancos_parceiros"))
    return out


def normalize_bancos_parceiros(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    bancos = []
    for entry in raw:
        if not isinstance(entry, Mapping):
            continue
        nome = str(entry.get("nome") or "").strip()
        if not nome:
            continue
        bancos.append({"nome": nome, "valor": _number(entry.get("valor", 0.0))})
    return bancos


def sum_bancos_parceiros(bancos: Any) -> float:
    return sum(_number(entry.get("valor", 0.0)) for entry in bancos) if isinstance(bancos, list) else 0.0


def project_dre(original: Mapping[str, Any], params: ScenarioParams) -> dict[str, Any]:
    scenario = normalize_dre(original)
    pinned_fields = _pinned_fields_from(original)
    original_rb = _sum(original, DRE_RECEITA_FIELDS)
    rb_target = params.receita_bruta_alvo if params.receita_bruta_alvo is not None else original_rb
    rb_factor = _safe_div(rb_target, original_rb, default=1.0)

    for field, value in _allocate(original, DRE_RECEITA_FIELDS, rb_target, fallback="servicos_prestados").items():
        scenario[field] = value

    deducoes_target = rb_target * params.aliquota_deducoes_pct
    for field, value in _allocate(original, DRE_DEDUCAO_FIELDS, deducoes_target, fallback="icms_ded").items():
        scenario[field] = value

    for field in DRE_RECEITA_FINANCEIRA_FIELDS:
        scenario[field] = _number(original.get(field, 0.0)) * rb_factor

    reducao_cmv, reducao_despesas = resolve_reductions_for_target(
        original,
        scenario,
        params,
        rb_factor,
        pinned_fields,
    )

    custos_target = _sum(original, DRE_CUSTO_FIELDS) * rb_factor * (1 - reducao_cmv)
    for field, value in _allocate_with_pins(
        original, DRE_CUSTO_FIELDS, custos_target, pinned_fields, fallback="cmv"
    ).items():
        scenario[field] = value

    for field in DRE_DESPESA_OPERACIONAL_FIELDS + DRE_DESPESA_FINANCEIRA_FIELDS:
        if field in pinned_fields:
            scenario[field] = _number(original.get(field, 0.0))
        else:
            scenario[field] = _number(original.get(field, 0.0)) * (1 - reducao_despesas)

    before_tax = calculate_dre_totals({**scenario, "csll": 0.0, "irpj": 0.0})[
        "resultado_antes_ir_csl"
    ]
    provisao_total = max(before_tax, 0.0) * params.provisoes_ir_csl_pct
    for field, value in _allocate(original, DRE_PROVISAO_FIELDS, provisao_total, fallback="irpj").items():
        scenario[field] = value

    totals = calculate_dre_totals(scenario)
    scenario["_resultado_op"] = totals["resultado_operacional"]
    scenario["_resultado_final"] = totals["resultado_exercicio"]
    scenario["_meta_lucro_valor"] = rb_target * params.meta_lucro_pct
    scenario["_diferenca_meta"] = totals["resultado_exercicio"] - scenario["_meta_lucro_valor"]
    scenario["_meta_lucro_ativa"] = abs(params.meta_lucro_pct) > 1e-9
    scenario["_reducao_cmv_calculada"] = reducao_cmv
    scenario["_reducao_despesas_calculada"] = reducao_despesas
    return scenario


def resolve_reductions_for_target(
    original: Mapping[str, Any],
    scenario: Mapping[str, Any],
    params: ScenarioParams,
    rb_factor: float,
    pinned_fields: frozenset[str] = frozenset(),
) -> tuple[float, float]:
    if abs(params.meta_lucro_pct) <= 1e-9:
        return params.reducao_cmv_pct, params.reducao_despesas_pct

    pinned_custo_fields = [f for f in DRE_CUSTO_FIELDS if f in pinned_fields]
    pinned_despesa_fields = [
        f for f in DRE_DESPESA_OPERACIONAL_FIELDS + DRE_DESPESA_FINANCEIRA_FIELDS if f in pinned_fields
    ]
    # Manually pinned lines are kept at the user's exact value (see project_dre),
    # so they're removed from the reducible base and from the amount the
    # reduction still needs to close, letting the remaining fields absorb
    # whatever the target net profit requires.
    pinned_total = _sum(original, pinned_custo_fields) + _sum(original, pinned_despesa_fields)

    receita_bruta = _sum(scenario, DRE_RECEITA_FIELDS)
    custos_base = (_sum(original, DRE_CUSTO_FIELDS) - _sum(original, pinned_custo_fields)) * rb_factor
    despesas_base = _sum(
        original, DRE_DESPESA_OPERACIONAL_FIELDS + DRE_DESPESA_FINANCEIRA_FIELDS
    ) - _sum(original, pinned_despesa_fields)
    controllable_base = custos_base + despesas_base
    if abs(receita_bruta) < 1e-9 or abs(controllable_base) < 1e-9:
        return params.reducao_cmv_pct, params.reducao_despesas_pct

    target_net = receita_bruta * params.meta_lucro_pct
    provision_rate = params.provisoes_ir_csl_pct
    if target_net >= 0 and provision_rate < 1:
        required_before_tax = target_net / (1 - provision_rate)
    else:
        required_before_tax = target_net

    result_before_controls = (
        receita_bruta
        - _sum(scenario, DRE_DEDUCAO_FIELDS)
        + _sum(scenario, DRE_RECEITA_FINANCEIRA_FIELDS)
    )
    required_control_total = result_before_controls - required_before_tax - pinned_total
    reduction = 1 - (required_control_total / controllable_base)
    return reduction, reduction


def calculate_dre_totals(values: Mapping[str, Any]) -> dict[str, float]:
    receita_bruta = _sum(values, DRE_RECEITA_FIELDS)
    deducoes = _sum(values, DRE_DEDUCAO_FIELDS)
    receita_liquida = receita_bruta - deducoes
    custos = _sum(values, DRE_CUSTO_FIELDS)
    lucro_bruto = receita_liquida - custos
    despesas_operacionais = _sum(values, DRE_DESPESA_OPERACIONAL_FIELDS)
    despesas_financeiras = _sum(values, DRE_DESPESA_FINANCEIRA_FIELDS)
    receitas_financeiras = _sum(values, DRE_RECEITA_FINANCEIRA_FIELDS)
    resultado_operacional = (
        lucro_bruto - despesas_operacionais - despesas_financeiras + receitas_financeiras
    )
    resultado_antes_ir_csl = resultado_operacional
    provisoes = _sum(values, DRE_PROVISAO_FIELDS)
    resultado_exercicio = resultado_antes_ir_csl - provisoes

    return {
        "receita_bruta": receita_bruta,
        "deducoes": deducoes,
        "receita_liquida": receita_liquida,
        "custos": custos,
        "lucro_bruto": lucro_bruto,
        "despesas_operacionais": despesas_operacionais,
        "despesas_financeiras": despesas_financeiras,
        "receitas_financeiras": receitas_financeiras,
        "resultado_operacional": resultado_operacional,
        "resultado_antes_ir_csl": resultado_antes_ir_csl,
        "provisoes": provisoes,
        "resultado_exercicio": resultado_exercicio,
        "margem_liquida": _safe_div(resultado_exercicio, receita_bruta),
    }


def project_balanco(
    original: Mapping[str, Any],
    *,
    original_dre_totals: Mapping[str, float],
    scenario_dre_totals: Mapping[str, float],
    params: ScenarioParams,
) -> dict[str, float]:
    scenario = normalize_balanco(original)
    original_rb = original_dre_totals.get("receita_bruta", 0.0)
    scenario_rb = scenario_dre_totals.get("receita_bruta", 0.0)
    rb_factor = _safe_div(scenario_rb, original_rb, default=1.0)
    delta_resultado = (
        scenario_dre_totals.get("resultado_exercicio", 0.0)
        - original_dre_totals.get("resultado_exercicio", 0.0)
    )

    disponivel_target = _sum(original, BAL_DISPONIVEL_FIELDS) + delta_resultado
    for field, value in _allocate(original, BAL_DISPONIVEL_FIELDS, disponivel_target, fallback="caixa_geral").items():
        scenario[field] = value

    for field in BAL_CLIENTES_FIELDS:
        scenario[field] = _number(original.get(field, 0.0)) * rb_factor

    for field in BAL_OUTROS_CREDITOS_CMV_FIELDS + BAL_ESTOQUE_FIELDS + BAL_FORNECEDORES_FIELDS:
        scenario[field] = _number(original.get(field, 0.0)) * (1 - params.reducao_cmv_pct)

    for field in BAL_OUTROS_CREDITOS_DESP_FIELDS + BAL_PASSIVO_DESP_FIELDS:
        scenario[field] = _number(original.get(field, 0.0)) * (1 - params.reducao_despesas_pct)

    ded_factor = _safe_div(params.aliquota_deducoes_pct, 0.35)
    for field in BAL_OUTROS_CREDITOS_DED_FIELDS + BAL_PASSIVO_DED_FIELDS:
        scenario[field] = _number(original.get(field, 0.0)) * ded_factor

    # Patrimonio liquido absorbs the result change, following the workbook.
    scenario["prej_acum"] = (
        _number(original.get("prej_acum", 0.0))
        - original_dre_totals.get("resultado_exercicio", 0.0)
        + scenario_dre_totals.get("resultado_exercicio", 0.0)
    )
    return scenario


def calculate_balanco_totals(values: Mapping[str, Any]) -> dict[str, float]:
    bancos_parceiros_total = sum_bancos_parceiros(values.get("bancos_parceiros"))
    disponivel = _sum(values, BAL_DISPONIVEL_FIELDS) + bancos_parceiros_total
    clientes = _sum(values, BAL_CLIENTES_FIELDS)
    outros_creditos = _sum(
        values,
        BAL_OUTROS_CREDITOS_CMV_FIELDS
        + BAL_OUTROS_CREDITOS_DESP_FIELDS
        + BAL_OUTROS_CREDITOS_DED_FIELDS,
    )
    estoque = _sum(values, BAL_ESTOQUE_FIELDS)
    ativo_circulante = disponivel + clientes + outros_creditos + estoque
    ativo_nao_circulante = _sum(values, BAL_ATIVO_NAO_CIRC_FIELDS)
    compensacao_ativo = _sum(values, BAL_COMPENSACAO_ATIVO_FIELDS)
    ativo_total = ativo_circulante + ativo_nao_circulante + compensacao_ativo

    emprestimos_cp = _sum(values, BAL_PASSIVO_CP_MANTIDO_FIELDS)
    passivo_deducoes = _sum(values, BAL_PASSIVO_DED_FIELDS)
    passivo_despesas = _sum(values, BAL_PASSIVO_DESP_FIELDS)
    passivo_circ_mantido = _sum(values, BAL_PASSIVO_CIRC_MANTIDO_FIELDS)
    fornecedores = _sum(values, BAL_FORNECEDORES_FIELDS)
    passivo_circulante = (
        emprestimos_cp
        + fornecedores
        + passivo_deducoes
        + passivo_despesas
        + passivo_circ_mantido
    )
    passivo_nao_circulante = _sum(values, BAL_PASSIVO_NAO_CIRC_FIELDS)
    patrimonio_liquido = _sum(values, BAL_PL_FIELDS)
    passivo_pl_total = passivo_circulante + passivo_nao_circulante + patrimonio_liquido

    return {
        "disponivel": disponivel,
        "bancos_parceiros_total": bancos_parceiros_total,
        "clientes": clientes,
        "outros_creditos": outros_creditos,
        "estoque": estoque,
        "ativo_circulante": ativo_circulante,
        "ativo_nao_circulante": ativo_nao_circulante,
        "compensacao_ativo": compensacao_ativo,
        "ativo_total": ativo_total,
        "emprestimos_cp": emprestimos_cp,
        "fornecedores": fornecedores,
        "passivo_deducoes": passivo_deducoes,
        "passivo_despesas": passivo_despesas,
        "passivo_circ_mantido": passivo_circ_mantido,
        "passivo_circulante": passivo_circulante,
        "passivo_nao_circulante": passivo_nao_circulante,
        "patrimonio_liquido": patrimonio_liquido,
        "passivo_pl_total": passivo_pl_total,
        "diferenca": ativo_total - passivo_pl_total,
    }


def build_resumo(
    params: ScenarioParams,
    dre_original: Mapping[str, float],
    dre_scenario: Mapping[str, float],
    bal_original: Mapping[str, float],
    bal_scenario: Mapping[str, float],
    scenario_values: Mapping[str, Any] | None = None,
) -> dict[str, float]:
    scenario_values = scenario_values or {}
    meta_valor = dre_scenario["receita_bruta"] * params.meta_lucro_pct
    return {
        "meta_lucro_pct": params.meta_lucro_pct,
        "meta_lucro_valor": meta_valor,
        "meta_lucro_ativa": 1.0 if scenario_values.get("_meta_lucro_ativa") else 0.0,
        "reducao_cmv_calculada": float(
            scenario_values.get("_reducao_cmv_calculada", params.reducao_cmv_pct)
        ),
        "reducao_despesas_calculada": float(
            scenario_values.get("_reducao_despesas_calculada", params.reducao_despesas_pct)
        ),
        "resultado_exercicio": dre_scenario["resultado_exercicio"],
        "margem_liquida": dre_scenario["margem_liquida"],
        "diferenca_meta": dre_scenario["resultado_exercicio"] - meta_valor,
        "variacao_receita_bruta": _variation(
            dre_original["receita_bruta"], dre_scenario["receita_bruta"]
        ),
        "variacao_resultado": _variation(
            dre_original["resultado_exercicio"], dre_scenario["resultado_exercicio"]
        ),
        "ativo_total": bal_scenario["ativo_total"],
        "passivo_pl_total": bal_scenario["passivo_pl_total"],
        "diferenca_balanco": bal_scenario["diferenca"],
        "variacao_ativo_total": _variation(
            bal_original["ativo_total"], bal_scenario["ativo_total"]
        ),
    }


def parse_periodo(periodo: str) -> tuple[str, str]:
    dates = re.findall(r"\d{2}/\d{2}/\d{4}", periodo or "")
    if len(dates) >= 2:
        return dates[0], dates[1]
    if len(dates) == 1:
        return "", dates[0]
    return "", ""


def _allocate(
    values: Mapping[str, Any],
    fields: list[str],
    target: float,
    *,
    fallback: str,
) -> dict[str, float]:
    base = _sum(values, fields)
    allocated = {field: 0.0 for field in fields}
    if not fields:
        return allocated
    if abs(target) < 1e-9:
        return allocated
    if abs(base) < 1e-9:
        allocated[fallback if fallback in allocated else fields[0]] = target
        return allocated
    for field in fields:
        allocated[field] = _number(values.get(field, 0.0)) / base * target
    return allocated


def _allocate_with_pins(
    values: Mapping[str, Any],
    fields: list[str],
    target: float,
    pinned_fields: frozenset[str],
    *,
    fallback: str,
) -> dict[str, float]:
    pinned = [field for field in fields if field in pinned_fields]
    free = [field for field in fields if field not in pinned_fields]
    allocated = {field: _number(values.get(field, 0.0)) for field in pinned}
    free_target = target - sum(allocated.values())
    free_fallback = fallback if fallback in free else (free[0] if free else fallback)
    allocated.update(_allocate(values, free, free_target, fallback=free_fallback))
    return allocated


def _pinned_fields_from(values: Mapping[str, Any]) -> frozenset[str]:
    raw = values.get("_pinned_fields")
    if not isinstance(raw, list):
        return frozenset()
    return frozenset(field for field in raw if isinstance(field, str))


def _sum(values: Mapping[str, Any], fields: list[str]) -> float:
    return sum(_number(values.get(field, 0.0)) for field in fields)


def _number(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return 0.0
    negative = text.startswith("(") or text.endswith("C")
    text = re.sub(r"[()DC\sR$]", "", text, flags=re.IGNORECASE)
    text = text.replace(".", "").replace(",", ".")
    try:
        parsed = float(text)
    except ValueError:
        return 0.0
    return -parsed if negative else parsed


def _optional_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    return _number(value)


def _rate(value: Any) -> float:
    number = _number(value)
    if abs(number) > 1:
        return number / 100
    return number


def _safe_div(num: float, den: float, default: float = 0.0) -> float:
    return default if abs(den) < 1e-9 else num / den


def _variation(original: float, scenario: float) -> float:
    return _safe_div(scenario, original) - 1 if abs(original) >= 1e-9 else 0.0


def _pick(raw: Mapping[str, Any], *keys: str, default: Any) -> Any:
    for key in keys:
        if key in raw:
            return raw[key]
    return default
