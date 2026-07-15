"""FastAPI entrypoint for the managerial projection workflow."""

from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

import gerencial.storage as storage
from gerencial.estimator import (
    EstimateInput,
    build_estimated_projection,
    estimate_from_revenue,
    list_estimator_sectors,
)
from gerencial.projection_engine import ScenarioParams, project_all


app = FastAPI(title="JACOM Projecao Gerencial", version="0.1.0")
storage.init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/gerencial/default-params")
async def default_params() -> dict[str, Any]:
    return {"params": ScenarioParams().__dict__}


@app.get("/api/gerencial/estimator/sectors")
async def estimator_sectors() -> dict[str, Any]:
    return {"sectors": list_estimator_sectors()}


@app.post("/api/gerencial/estimate")
async def estimate_documents(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        estimated = estimate_from_revenue(
            EstimateInput(
                faturamento=float(payload.get("faturamento") or 0),
                setor=str(payload.get("setor") or "industria"),
                empresa=str(payload.get("empresa") or ""),
                cnpj=str(payload.get("cnpj") or ""),
                periodo=str(payload.get("periodo") or ""),
                cidade=str(payload.get("cidade") or "BOTUCATU"),
                data_emissao=str(payload.get("data_emissao") or ""),
            )
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Falha ao estimar documentos: {exc}") from exc

    return {
        "dre": estimated["dre"],
        "balanco": estimated["balanco"],
        "params": estimated["params"],
        "setor": estimated["setor"],
        "projection": build_estimated_projection(estimated),
    }


@app.post("/api/gerencial/extract")
async def extract_documents(
    pdf: UploadFile | None = File(default=None),
    dre_pdf: UploadFile | None = File(default=None),
    balanco_pdf: UploadFile | None = File(default=None),
) -> dict[str, Any]:
    """Extract DRE and Balanco values.

    Accepts either one combined PDF in `pdf`, or separate uploads in `dre_pdf`
    and `balanco_pdf`.
    """
    if pdf is None and (dre_pdf is None or balanco_pdf is None):
        raise HTTPException(
            status_code=400,
            detail="Envie `pdf` combinado ou `dre_pdf` e `balanco_pdf` separados.",
        )

    try:
        with TemporaryDirectory() as tmp:
            tmpdir = Path(tmp)
            if pdf is not None:
                combined_path = tmpdir / _safe_filename(pdf.filename or "documento.pdf")
                await _save_upload(pdf, combined_path)
                dre_path = combined_path
                balanco_path = combined_path
            else:
                dre_path = tmpdir / _safe_filename(dre_pdf.filename or "dre.pdf")
                balanco_path = tmpdir / _safe_filename(balanco_pdf.filename or "balanco.pdf")
                await _save_upload(dre_pdf, dre_path)
                await _save_upload(balanco_pdf, balanco_path)

            from extrator_gerencial import extrair_balanco, extrair_dre

            dre = extrair_dre(dre_path)
            balanco = extrair_balanco(balanco_path)
    except ModuleNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Dependencia Python ausente: {exc.name}. Rode `pip install -r requirements.txt`.",
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Falha ao extrair PDF: {exc}") from exc

    return {
        "dre": dre,
        "balanco": balanco,
        "params": _params_from_extraction(dre),
    }


@app.post("/api/gerencial/project")
async def project(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    return _project_payload(payload)


@app.post("/api/gerencial/pdf")
async def generate_pdf(payload: dict[str, Any] = Body(...)) -> Response:
    from jacom_layout import LAYOUTS_DISPONIVEIS

    tipo = str(payload.get("tipo") or "completo").lower()
    if tipo not in {"dre", "balanco", "completo"}:
        raise HTTPException(status_code=400, detail="tipo deve ser `dre`, `balanco` ou `completo`.")

    layout = str(payload.get("layout") or "jacom").lower()
    if layout not in LAYOUTS_DISPONIVEIS:
        raise HTTPException(
            status_code=400,
            detail=f"layout deve ser um de: {', '.join(LAYOUTS_DISPONIVEIS)}.",
        )

    scenario = payload.get("scenario")
    if isinstance(scenario, dict) and isinstance(scenario.get("dre"), dict):
        dre_data = dict(scenario["dre"])
        balanco_source = scenario.get("balanco") if isinstance(scenario.get("balanco"), dict) else {}
    else:
        projected = _project_payload(payload)
        dre_data = dict(projected["scenario"]["dre"])
        balanco_source = projected["scenario"]["balanco"]

    documento = payload.get("documento") if isinstance(payload.get("documento"), dict) else {}
    if documento.get("cidade"):
        dre_data["cidade"] = str(documento["cidade"])
    if documento.get("data_emissao"):
        dre_data["data_emissao"] = str(documento["data_emissao"])
    for key in [
        "empresario_nome",
        "empresario_cargo",
        "empresario_cpf",
        "contador_nome",
        "contador_crc",
        "contador_cpf",
    ]:
        if documento.get(key):
            dre_data[key] = str(documento[key])

    balanco_data = {
        **balanco_source,
        "empresa": dre_data.get("empresa", ""),
        "cnpj": dre_data.get("cnpj", ""),
        "data_ini": dre_data.get("data_ini", ""),
        "data_fim": dre_data.get("data_fim", ""),
        "cidade": dre_data.get("cidade", "BOTUCATU"),
        "data_emissao": dre_data.get("data_emissao", ""),
        "empresario_nome": dre_data.get("empresario_nome", ""),
        "empresario_cargo": dre_data.get("empresario_cargo", ""),
        "empresario_cpf": dre_data.get("empresario_cpf", ""),
        "contador_nome": dre_data.get("contador_nome", ""),
        "contador_crc": dre_data.get("contador_crc", ""),
        "contador_cpf": dre_data.get("contador_cpf", ""),
    }

    try:
        pdf_bytes = _render_pdf(tipo, dre_data, balanco_data, layout)
    except ModuleNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Dependencia Python ausente: {exc.name}. Rode `pip install -r requirements.txt`.",
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Falha ao gerar PDF: {exc}") from exc

    filename = {
        "dre": "DRE_GERENCIAL.pdf",
        "balanco": "BALANCO_GERENCIAL.pdf",
        "completo": "DEMONSTRACOES_GERENCIAIS.pdf",
    }[tipo]

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


CURVA_ABC_COLISOES_HEADER = "X-Curva-Abc-Colisoes"


@app.post("/api/gerencial/curva-abc/estimate")
async def estimate_curva_abc(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    from curva_abc_gerador import estimar_curva_abc

    faturamento_total = float(payload.get("faturamento_total") or 0)
    if faturamento_total <= 0:
        raise HTTPException(status_code=400, detail="Campo `faturamento_total` deve ser maior que zero.")

    numero_clientes = int(payload.get("numero_clientes") or 106)
    concentracao = float(payload.get("concentracao") or 1.6)

    try:
        clientes = estimar_curva_abc(
            faturamento_total=faturamento_total,
            numero_clientes=numero_clientes,
            concentracao=concentracao,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Falha ao estimar Curva ABC: {exc}") from exc

    return {
        "clientes": clientes,
        "total_clientes": len(clientes),
        "total_valor": sum(c["valor"] for c in clientes),
    }


@app.post("/api/gerencial/curva-abc/pdf")
async def generate_curva_abc_pdf(payload: dict[str, Any] = Body(...)) -> Response:
    clientes = payload.get("clientes")
    if not isinstance(clientes, list) or not clientes:
        raise HTTPException(status_code=400, detail="Campo `clientes` deve ser uma lista nao vazia.")

    for c in clientes:
        if not isinstance(c, dict) or "nome" not in c or "valor" not in c:
            raise HTTPException(status_code=400, detail="Cada cliente deve ter `nome` e `valor`.")

    clientes_norm = [
        {
            "cnpj_cpf": str(c.get("cnpj_cpf") or ""),
            "nome": str(c.get("nome") or ""),
            "valor": float(c.get("valor") or 0),
        }
        for c in clientes
    ]

    periodo_ini = str(payload.get("periodo_ini") or "").strip()
    periodo_fim = str(payload.get("periodo_fim") or "").strip()
    if not periodo_ini or not periodo_fim:
        raise HTTPException(
            status_code=400,
            detail="Campos `periodo_ini` e `periodo_fim` sao obrigatorios (dd/mm/aaaa).",
        )

    empresa = str(payload.get("empresa") or "01-EMPRESA")
    versao_gerencial = bool(payload.get("versao_gerencial", True))
    data_emissao = payload.get("data_emissao") or None

    try:
        pdf_bytes, n_colisoes = _render_curva_abc_pdf(
            clientes_norm, periodo_ini, periodo_fim, empresa, versao_gerencial, data_emissao
        )
    except ModuleNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Dependencia Python ausente: {exc.name}. Rode `pip install -r requirements.txt`.",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Falha ao gerar PDF da Curva ABC: {exc}") from exc

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="CURVA_ABC.pdf"',
            CURVA_ABC_COLISOES_HEADER: str(n_colisoes),
        },
    )


@app.post("/api/gerencial/curva-abc/projections")
async def create_curva_abc_projection(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    nome, payload = _validate_projection_body(body)
    empresa, periodo_ini, periodo_fim, modo, total_clientes, total_valor = _curva_abc_listing_fields(payload)
    return storage.save_curva_abc_projection(
        nome, empresa, periodo_ini, periodo_fim, modo, total_clientes, total_valor, payload
    )


@app.get("/api/gerencial/curva-abc/projections")
async def list_curva_abc_projections() -> dict[str, Any]:
    return {"projections": storage.list_curva_abc_projections()}


@app.get("/api/gerencial/curva-abc/projections/{projection_id}")
async def get_curva_abc_projection(projection_id: int) -> dict[str, Any]:
    record = storage.get_curva_abc_projection(projection_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Curva ABC nao encontrada.")
    return record


@app.put("/api/gerencial/curva-abc/projections/{projection_id}")
async def update_curva_abc_projection(projection_id: int, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    nome, payload = _validate_projection_body(body)
    empresa, periodo_ini, periodo_fim, modo, total_clientes, total_valor = _curva_abc_listing_fields(payload)
    record = storage.update_curva_abc_projection(
        projection_id, nome, empresa, periodo_ini, periodo_fim, modo, total_clientes, total_valor, payload
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Curva ABC nao encontrada.")
    return record


@app.delete("/api/gerencial/curva-abc/projections/{projection_id}")
async def delete_curva_abc_projection(projection_id: int) -> dict[str, Any]:
    if not storage.delete_curva_abc_projection(projection_id):
        raise HTTPException(status_code=404, detail="Curva ABC nao encontrada.")
    return {"deleted": True}


@app.post("/api/gerencial/projections")
async def create_projection(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    nome, payload = _validate_projection_body(body)
    empresa, cnpj = _listing_fields_from_payload(payload)
    return storage.save_projection(nome, empresa, cnpj, payload)


@app.get("/api/gerencial/projections")
async def list_projections() -> dict[str, Any]:
    return {"projections": storage.list_projections()}


@app.get("/api/gerencial/projections/{projection_id}")
async def get_projection(projection_id: int) -> dict[str, Any]:
    record = storage.get_projection(projection_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Projecao nao encontrada.")
    return record


@app.put("/api/gerencial/projections/{projection_id}")
async def update_projection(projection_id: int, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    nome, payload = _validate_projection_body(body)
    empresa, cnpj = _listing_fields_from_payload(payload)
    record = storage.update_projection(projection_id, nome, empresa, cnpj, payload)
    if record is None:
        raise HTTPException(status_code=404, detail="Projecao nao encontrada.")
    return record


@app.delete("/api/gerencial/projections/{projection_id}")
async def delete_projection(projection_id: int) -> dict[str, Any]:
    if not storage.delete_projection(projection_id):
        raise HTTPException(status_code=404, detail="Projecao nao encontrada.")
    return {"deleted": True}


def _validate_projection_body(body: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    nome = str(body.get("nome") or "").strip()
    if not nome:
        raise HTTPException(status_code=400, detail="Campo `nome` e obrigatorio.")
    payload = body.get("payload")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Campo `payload` deve ser objeto.")
    return nome, payload


def _listing_fields_from_payload(payload: dict[str, Any]) -> tuple[str, str]:
    scenario = payload.get("scenario") if isinstance(payload.get("scenario"), dict) else {}
    dre = scenario.get("dre") if isinstance(scenario.get("dre"), dict) else {}
    return str(dre.get("empresa") or ""), str(dre.get("cnpj") or "")


def _curva_abc_listing_fields(payload: dict[str, Any]) -> tuple[str, str, str, str, int, float]:
    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    clientes = payload.get("clientes") if isinstance(payload.get("clientes"), list) else []
    return (
        str(meta.get("empresa") or ""),
        str(meta.get("periodo_ini") or ""),
        str(meta.get("periodo_fim") or ""),
        str(meta.get("modo") or ""),
        len(clientes),
        sum(float(c.get("valor") or 0) for c in clientes if isinstance(c, dict)),
    )


def _project_payload(payload: dict[str, Any]) -> dict[str, Any]:
    dre = payload.get("dre")
    if not isinstance(dre, dict):
        raise HTTPException(status_code=400, detail="Campo `dre` e obrigatorio.")
    balanco = payload.get("balanco") or {}
    if not isinstance(balanco, dict):
        raise HTTPException(status_code=400, detail="Campo `balanco` deve ser objeto.")

    params = payload.get("params") or {}
    return project_all(dre, balanco, params)


def _render_pdf(
    tipo: str, dre_data: dict[str, Any], balanco_data: dict[str, Any], layout: str = "jacom"
) -> bytes:
    from jacom_layout import gerar_balanco, gerar_dre

    with TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        if tipo == "dre":
            out = tmpdir / "dre.pdf"
            gerar_dre(dre_data, str(out), layout=layout, gerencial=True)
            return out.read_bytes()
        if tipo == "balanco":
            out = tmpdir / "balanco.pdf"
            gerar_balanco(balanco_data, str(out), layout=layout, gerencial=True)
            return out.read_bytes()

        dre_out = tmpdir / "dre.pdf"
        bal_out = tmpdir / "balanco.pdf"
        final_out = tmpdir / "demonstracoes.pdf"
        gerar_dre(dre_data, str(dre_out), layout=layout, gerencial=True)
        gerar_balanco(balanco_data, str(bal_out), layout=layout, gerencial=True)
        _merge_pdfs([dre_out, bal_out], final_out)
        return final_out.read_bytes()


def _render_curva_abc_pdf(
    clientes: list[dict[str, Any]],
    periodo_ini: str,
    periodo_fim: str,
    empresa: str,
    versao_gerencial: bool,
    data_emissao: str | None,
) -> tuple[bytes, int]:
    from curva_abc_gerador import gerar_curva_abc, validar_colisoes

    with TemporaryDirectory() as tmp:
        out = Path(tmp) / "curva_abc.pdf"
        gerar_curva_abc(
            clientes=clientes,
            periodo_ini=periodo_ini,
            periodo_fim=periodo_fim,
            empresa=empresa,
            output_path=str(out),
            versao_gerencial=versao_gerencial,
            data_emissao=data_emissao,
        )

        try:
            n_colisoes = len(validar_colisoes(str(out)))
        except Exception:
            # Defense-in-depth QA check, not a hard requirement (e.g. poppler
            # missing on some future deploy target) - never let it block delivery.
            n_colisoes = -1

        return out.read_bytes(), n_colisoes


def _merge_pdfs(inputs: list[Path], output: Path) -> None:
    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter()
    for path in inputs:
        reader = PdfReader(str(path))
        for page in reader.pages:
            writer.add_page(page)
    with output.open("wb") as fh:
        writer.write(fh)


def _params_from_extraction(dre: dict[str, Any]) -> dict[str, Any]:
    from gerencial.projection_engine import calculate_dre_totals, normalize_dre

    totals = calculate_dre_totals(normalize_dre(dre))
    rb = totals["receita_bruta"]
    defaults = ScenarioParams()

    # Default the rate-based params to the company's own extracted figures
    # (same approach as the "estimar por faturamento" flow) so a scenario
    # nobody has touched yet reproduces the real DRE instead of silently
    # applying the dataclass' generic assumptions.
    aliquota_deducoes_pct = totals["deducoes"] / rb if rb > 0 else defaults.aliquota_deducoes_pct
    before_tax = totals["resultado_antes_ir_csl"]
    provisoes_ir_csl_pct = (
        totals["provisoes"] / before_tax if before_tax > 0 else defaults.provisoes_ir_csl_pct
    )

    params = ScenarioParams(
        # No target/reduction is active yet, mirroring "estimar por
        # faturamento": the user opts into a hypothetical scenario by moving
        # a slider, instead of one being silently applied from the first render.
        meta_lucro_pct=0.0,
        receita_bruta_alvo=rb,
        aliquota_deducoes_pct=aliquota_deducoes_pct,
        reducao_cmv_pct=0.0,
        reducao_despesas_pct=0.0,
        provisoes_ir_csl_pct=provisoes_ir_csl_pct,
    ).__dict__
    return params


async def _save_upload(upload: UploadFile, path: Path) -> None:
    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail=f"Arquivo vazio: {upload.filename}")
    path.write_bytes(content)


def _safe_filename(filename: str) -> str:
    safe = "".join(ch for ch in filename if ch.isalnum() or ch in "._- ")
    return safe or "documento.pdf"
