"""FastAPI entrypoint for the managerial projection workflow."""

from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from fastapi import Body, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from gerencial.estimator import (
    EstimateInput,
    build_estimated_projection,
    estimate_from_revenue,
    list_estimator_sectors,
)
from gerencial.projection_engine import ScenarioParams, project_all


app = FastAPI(title="JACOM Projecao Gerencial", version="0.1.0")

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
    tipo = str(payload.get("tipo") or "completo").lower()
    if tipo not in {"dre", "balanco", "completo"}:
        raise HTTPException(status_code=400, detail="tipo deve ser `dre`, `balanco` ou `completo`.")

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
        pdf_bytes = _render_pdf(tipo, dre_data, balanco_data)
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


def _project_payload(payload: dict[str, Any]) -> dict[str, Any]:
    dre = payload.get("dre")
    if not isinstance(dre, dict):
        raise HTTPException(status_code=400, detail="Campo `dre` e obrigatorio.")
    balanco = payload.get("balanco") or {}
    if not isinstance(balanco, dict):
        raise HTTPException(status_code=400, detail="Campo `balanco` deve ser objeto.")

    params = payload.get("params") or {}
    return project_all(dre, balanco, params)


def _render_pdf(tipo: str, dre_data: dict[str, Any], balanco_data: dict[str, Any]) -> bytes:
    from jacom_layout import gerar_balanco_jacom, gerar_dre_jacom

    with TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        if tipo == "dre":
            out = tmpdir / "dre.pdf"
            gerar_dre_jacom(dre_data, str(out), gerencial=True)
            return out.read_bytes()
        if tipo == "balanco":
            out = tmpdir / "balanco.pdf"
            gerar_balanco_jacom(balanco_data, str(out), gerencial=True)
            return out.read_bytes()

        dre_out = tmpdir / "dre.pdf"
        bal_out = tmpdir / "balanco.pdf"
        final_out = tmpdir / "demonstracoes.pdf"
        gerar_dre_jacom(dre_data, str(dre_out), gerencial=True)
        gerar_balanco_jacom(balanco_data, str(bal_out), gerencial=True)
        _merge_pdfs([dre_out, bal_out], final_out)
        return final_out.read_bytes()


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
    from gerencial.projection_engine import DRE_RECEITA_FIELDS

    rb = sum(float(dre.get(field, 0) or 0) for field in DRE_RECEITA_FIELDS)
    params = ScenarioParams(receita_bruta_alvo=rb).__dict__
    return params


async def _save_upload(upload: UploadFile, path: Path) -> None:
    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail=f"Arquivo vazio: {upload.filename}")
    path.write_bytes(content)


def _safe_filename(filename: str) -> str:
    safe = "".join(ch for ch in filename if ch.isalnum() or ch in "._- ")
    return safe or "documento.pdf"
