"""Build estimated DRE and Balanco values from benchmark percentages."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import unicodedata
from typing import Any

from openpyxl import load_workbook

from gerencial.projection_engine import calculate_balanco_totals, calculate_dre_totals


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ESTIMATOR_PATH = ROOT / "ESTIMADOR_DRE_BALANCO.xlsx"
INDUSTRY_DEFAULT_PROVISION_RATE_ON_PROFIT = 0.24
INDUSTRY_FINANCIAL_REVENUE_MIN_PCTS = {
    "juros_aplicacoes": 0.0003,
    "juros_ativos": 0.0001,
    "descontos_fin": 0.0002,
    "bonif_amostras": 0.0010,
}


DRE_ROW_FIELDS = {
    14: "venda_produtos",
    15: "venda_produtos_export",
    16: "venda_mercadorias",
    17: "venda_mercadorias_export",
    18: "servicos_prestados",
    22: "devolucao",
    23: "ipi_ded",
    24: "icms_ded",
    25: "cofins",
    26: "pis",
    27: "subst_trib",
    33: "industrializacao",
    34: "bonificacao",
    35: "icms_dif_aliq",
    36: "cpv",
    37: "cmv",
    44: "salarios",
    45: "pro_labore",
    46: "premios",
    47: "decimo_terceiro",
    48: "ferias",
    49: "inss_desp",
    50: "fgts",
    51: "indenizacoes",
    52: "assist_medica",
    53: "adicionais",
    54: "alim_pessoal",
    55: "horas_extras",
    56: "uniformes",
    60: "alugueis",
    61: "embalagens_adm",
    62: "internet",
    63: "bens_peq_valor",
    64: "equip_seguranca",
    65: "manut_maq",
    66: "limpeza",
    67: "associacoes",
    68: "cartorios",
    69: "equip_protecao",
    70: "mat_laboratorio",
    71: "manut_veiculos",
    75: "ipva",
    76: "taxas_diversas",
    77: "taxas_vig_san",
    78: "icms_nao_contrib",
    79: "taxas_iss",
    83: "energia",
    84: "agua",
    85: "telefone",
    86: "postais",
    87: "seguros",
    88: "mat_escritorio",
    89: "mat_higiene",
    90: "assist_contabil",
    91: "serv_terceiros",
    92: "depreciacao",
    93: "propaganda",
    94: "assessoria",
    95: "mat_consumo",
    96: "combustiveis",
    97: "seg_patrim",
    98: "suporte_tecnico",
    99: "treinamento",
    100: "alim_geral",
    101: "agenciamento",
    102: "dedetizacao",
    103: "desp_medica",
    104: "software",
    105: "fretes",
    106: "manut_reparo",
    112: "juros_passivos",
    113: "taxas_cambiais",
    114: "iof",
    115: "juros_comissoes",
    116: "juros_emp",
    117: "multas_mora",
    118: "tarifa_bancaria",
    122: "juros_aplicacoes",
    123: "juros_ativos",
    124: "descontos_fin",
    125: "bonif_amostras",
    133: "csll",
    134: "irpj",
}


BAL_ROW_FIELDS = {
    9: "caixa_geral",
    10: "sicoob_mov",
    11: "bb_aplic",
    15: "clientes",
    19: "adiant_forn_1",
    20: "adiant_ferias",
    21: "ipi_rec",
    22: "icms_rec",
    26: "merc_revenda",
    27: "prod_acabados",
    33: "emp_socios",
    34: "gran_belle",
    35: "quotas_sicoob",
    36: "instalacoes",
    37: "moveis",
    38: "maquinas",
    39: "equip_ti",
    40: "veiculos",
    41: "dep_moveis",
    48: "sicoob_1320100",
    49: "fornecedores_total",
    50: "ipi_rel",
    51: "irpj_rel",
    52: "cofins_rel",
    53: "crf_rel",
    54: "sal_pagar",
    55: "inss_rel",
    56: "adiant_clientes",
    57: "parc_cp_items",
    61: "emp_lp",
    62: "parc_lp_items",
    66: "capital_pl",
    67: "prej_acum",
    68: "ajustes_ex_ant",
}


@dataclass(frozen=True)
class EstimateInput:
    faturamento: float
    setor: str = "industria"
    empresa: str = ""
    cnpj: str = ""
    periodo: str = ""
    cidade: str = "BOTUCATU"
    data_emissao: str = ""


def list_estimator_sectors(path: Path = DEFAULT_ESTIMATOR_PATH) -> list[dict[str, str]]:
    if not path.exists():
        return []
    wb = load_workbook(path, read_only=True, data_only=True)
    try:
        dre_ws = wb["Estimador DRE"]
        title = str(dre_ws["B1"].value or dre_ws["A1"].value or "INDUSTRIA")
    finally:
        wb.close()

    label = _sector_from_title(title)
    return [{"id": _slug(label), "label": label}]


def estimate_from_revenue(
    request: EstimateInput,
    path: Path = DEFAULT_ESTIMATOR_PATH,
) -> dict[str, Any]:
    if request.faturamento <= 0:
        raise ValueError("O faturamento deve ser maior que zero.")
    if not path.exists():
        raise FileNotFoundError(f"Planilha estimadora nao encontrada: {path}")

    wb = load_workbook(path, data_only=True)
    try:
        sector_label = _sector_from_title(str(wb["Estimador DRE"]["B1"].value or "INDUSTRIA"))
        dre = _build_values(wb["Estimador DRE"], DRE_ROW_FIELDS, request.faturamento)
        balanco = _build_values(wb["Estimador Balanço"], BAL_ROW_FIELDS, request.faturamento)
    finally:
        wb.close()

    _apply_industry_financial_revenue_defaults(dre, request.faturamento)

    # Split combined benchmark lines into the detailed fields expected downstream.
    if balanco.get("irpj_rel"):
        balanco["csll_rel"] = balanco["irpj_rel"] * 0.45
        balanco["irpj_rel"] = balanco["irpj_rel"] * 0.55
    if balanco.get("cofins_rel"):
        total = balanco["cofins_rel"]
        balanco["pis_rel"] = total * 0.18
        balanco["cofins_rel"] = total * 0.82

    dre["meta"] = {
        "empresa": request.empresa,
        "cnpj": request.cnpj,
        "periodo": request.periodo,
    }
    dre["empresa"] = request.empresa
    dre["cnpj"] = request.cnpj
    dre["periodo"] = request.periodo
    data_ini, data_fim = _parse_periodo(request.periodo)
    dre["data_ini"] = data_ini
    dre["data_fim"] = data_fim
    dre["cidade"] = request.cidade or "BOTUCATU"
    dre["data_emissao"] = request.data_emissao
    dre["_estimado"] = True
    dre["_setor"] = sector_label

    dre_totals = calculate_dre_totals(dre)
    dre["_resultado_op"] = dre_totals["resultado_operacional"]
    dre["_resultado_final"] = dre_totals["resultado_exercicio"]

    balanco["_estimado"] = True
    balanco["_setor"] = sector_label
    balanco_totals = calculate_balanco_totals(balanco)

    return {
        "dre": dre,
        "balanco": balanco,
        "dre_totals": dre_totals,
        "balanco_totals": balanco_totals,
        "params": _default_params_from_estimate(dre_totals, request.faturamento),
        "setor": {"id": _slug(sector_label), "label": sector_label},
    }


def build_estimated_projection(estimated: dict[str, Any]) -> dict[str, Any]:
    dre = estimated["dre"]
    balanco = estimated["balanco"]
    dre_totals = estimated["dre_totals"]
    balanco_totals = estimated["balanco_totals"]
    return {
        "params": estimated["params"],
        "original": {
            "dre": dre,
            "balanco": balanco,
            "dre_totals": dre_totals,
            "balanco_totals": balanco_totals,
        },
        "scenario": {
            "dre": dre,
            "balanco": balanco,
            "dre_totals": dre_totals,
            "balanco_totals": balanco_totals,
        },
        "resumo": {
            "meta_lucro_pct": estimated["params"]["meta_lucro_pct"],
            "meta_lucro_valor": dre_totals["receita_bruta"] * estimated["params"]["meta_lucro_pct"],
            "resultado_exercicio": dre_totals["resultado_exercicio"],
            "margem_liquida": dre_totals["margem_liquida"],
            "diferenca_meta": dre_totals["resultado_exercicio"]
            - dre_totals["receita_bruta"] * estimated["params"]["meta_lucro_pct"],
            "ativo_total": balanco_totals["ativo_total"],
            "passivo_pl_total": balanco_totals["passivo_pl_total"],
            "diferenca_balanco": balanco_totals["diferenca"],
            "variacao_ativo_total": 0.0,
            "variacao_receita_bruta": 0.0,
            "variacao_resultado": 0.0,
        },
    }


GROUP_WEIGHT_SPREAD = 0.6
GOLDEN_RATIO_CONJUGATE = 0.6180339887498949


def _build_values(ws, row_fields: dict[int, str], faturamento: float) -> dict[str, float]:
    raw_pcts = {row: _number(ws.cell(row=row, column=4).value) for row in row_fields}
    weighted_pcts = _weight_tied_percentages(raw_pcts)
    return {field: abs(weighted_pcts[row] * faturamento) for row, field in row_fields.items()}


def _weight_tied_percentages(raw_pcts: dict[int, float]) -> dict[int, float]:
    """Spread out benchmark rows that share an identical % within the same
    spreadsheet block, so the estimate doesn't surface repeated values on
    unrelated line items. The sum of each tied group is preserved exactly,
    so block/DRE/Balanco totals are unaffected.
    """
    weighted = dict(raw_pcts)
    for block in _contiguous_blocks(sorted(raw_pcts)):
        groups: dict[float, list[int]] = {}
        for row in block:
            pct = raw_pcts[row]
            if pct == 0:
                continue
            groups.setdefault(round(pct, 6), []).append(row)
        for pct, rows in groups.items():
            if len(rows) < 2:
                continue
            for row, offset in zip(rows, _irregular_offsets(rows)):
                weighted[row] = pct * (1 + GROUP_WEIGHT_SPREAD * offset)
    return weighted


def _irregular_offsets(rows: list[int]) -> list[float]:
    """Deterministic offsets in [-1, 1] with irregular (non-arithmetic) steps
    between consecutive rows, summing to zero so the group total is preserved.
    Uses a Weyl low-discrepancy sequence keyed by row number instead of rank,
    so gaps between neighboring values don't form a straight staircase.
    """
    points = [(row * GOLDEN_RATIO_CONJUGATE) % 1.0 for row in rows]
    mean = sum(points) / len(points)
    deviations = [p - mean for p in points]
    peak = max(abs(d) for d in deviations)
    if peak == 0:
        return [0.0 for _ in rows]
    return [d / peak for d in deviations]


def _contiguous_blocks(rows: list[int]) -> list[list[int]]:
    blocks: list[list[int]] = []
    for row in rows:
        if blocks and row == blocks[-1][-1] + 1:
            blocks[-1].append(row)
        else:
            blocks.append([row])
    return blocks


def _default_params_from_estimate(dre_totals: dict[str, float], faturamento: float) -> dict[str, float]:
    before_tax = dre_totals["resultado_antes_ir_csl"]
    provisoes_pct = (
        dre_totals["provisoes"] / before_tax
        if before_tax > 0
        else INDUSTRY_DEFAULT_PROVISION_RATE_ON_PROFIT
    )
    return {
        "meta_lucro_pct": 0.0,
        "receita_bruta_alvo": faturamento,
        "aliquota_deducoes_pct": dre_totals["deducoes"] / faturamento,
        "reducao_cmv_pct": 0.0,
        "reducao_despesas_pct": 0.0,
        "provisoes_ir_csl_pct": provisoes_pct,
    }


BONIF_AMOSTRAS_JITTER_PCT = 0.045


def _apply_industry_financial_revenue_defaults(dre: dict[str, Any], faturamento: float) -> None:
    for field, pct in INDUSTRY_FINANCIAL_REVENUE_MIN_PCTS.items():
        if abs(float(dre.get(field, 0) or 0)) < 1e-9:
            dre[field] = faturamento * pct

    # A planilha benchmark crava 0,10% fixo para "bonif_amostras", o que
    # sempre resulta num percentual redondo demais no DRE. Desloca uma
    # fatia dela para cima e tira o mesmo valor de "descontos_fin",
    # preservando o total das duas contas.
    bonif = dre.get("bonif_amostras", 0.0)
    descontos_fin = dre.get("descontos_fin", 0.0)
    if bonif > 0 and descontos_fin > 0:
        delta = min(bonif * BONIF_AMOSTRAS_JITTER_PCT, descontos_fin)
        dre["bonif_amostras"] = bonif + delta
        dre["descontos_fin"] = descontos_fin - delta


def _number(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace("%", "")
    try:
        number = float(text.replace(".", "").replace(",", "."))
    except ValueError:
        return 0.0
    return number / 100 if abs(number) > 1 else number


def _sector_from_title(title: str) -> str:
    match = re.search(r"[—-]\s*(.+)$", title or "")
    return (match.group(1) if match else title or "INDUSTRIA").strip().title()


def _slug(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value.lower())
    normalized = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    text = re.sub(r"[^a-z0-9]+", "-", normalized)
    return text.strip("-") or "industria"


def _parse_periodo(periodo: str) -> tuple[str, str]:
    dates = re.findall(r"\d{2}/\d{2}/\d{4}", periodo or "")
    if len(dates) >= 2:
        return dates[0], dates[1]
    if len(dates) == 1:
        return "", dates[0]
    return "", ""
