"""Local persistence for saved DRE/Balanco projections.

A single SQLite table (stdlib `sqlite3`, no new dependency): `dre`/`balanco`
are already untyped dicts everywhere else in this app, so the saved scenario
is stored as one JSON blob, with a handful of denormalized columns
(`nome`/`empresa`/`cnpj`/timestamps) kept alongside it purely so the history
list can be queried/sorted without deserializing every row.

Each function opens and closes its own short-lived connection rather than
sharing one across requests - sidesteps SQLite's thread-affinity rules at
negligible cost for a single local user.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DB_PATH = Path(__file__).resolve().parent / "data" / "gerencial.db"


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS projections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL,
                empresa TEXT NOT NULL DEFAULT '',
                cnpj TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                payload TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_projections_updated_at ON projections(updated_at)"
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS curva_abc_projections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL,
                empresa TEXT NOT NULL DEFAULT '',
                periodo_ini TEXT NOT NULL DEFAULT '',
                periodo_fim TEXT NOT NULL DEFAULT '',
                modo TEXT NOT NULL DEFAULT '',
                total_clientes INTEGER NOT NULL DEFAULT 0,
                total_valor REAL NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                payload TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_curva_abc_projections_updated_at "
            "ON curva_abc_projections(updated_at)"
        )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _row_to_summary(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "nome": row["nome"],
        "empresa": row["empresa"],
        "cnpj": row["cnpj"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def save_projection(nome: str, empresa: str, cnpj: str, payload: dict[str, Any]) -> dict[str, Any]:
    now = _now()
    with _connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO projections (nome, empresa, cnpj, created_at, updated_at, payload)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (nome, empresa, cnpj, now, now, json.dumps(payload)),
        )
        new_id = cur.lastrowid
    return get_projection(new_id)  # type: ignore[return-value]


def list_projections() -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, nome, empresa, cnpj, created_at, updated_at "
            "FROM projections ORDER BY updated_at DESC"
        ).fetchall()
    return [_row_to_summary(row) for row in rows]


def get_projection(projection_id: int) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM projections WHERE id = ?", (projection_id,)
        ).fetchone()
    if row is None:
        return None
    record = _row_to_summary(row)
    record["payload"] = json.loads(row["payload"])
    return record


def update_projection(
    projection_id: int, nome: str, empresa: str, cnpj: str, payload: dict[str, Any]
) -> dict[str, Any] | None:
    with _connect() as conn:
        cur = conn.execute(
            """
            UPDATE projections
            SET nome = ?, empresa = ?, cnpj = ?, updated_at = ?, payload = ?
            WHERE id = ?
            """,
            (nome, empresa, cnpj, _now(), json.dumps(payload), projection_id),
        )
        if cur.rowcount == 0:
            return None
    return get_projection(projection_id)


def delete_projection(projection_id: int) -> bool:
    with _connect() as conn:
        cur = conn.execute("DELETE FROM projections WHERE id = ?", (projection_id,))
    return cur.rowcount > 0


def _row_to_curva_abc_summary(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "nome": row["nome"],
        "empresa": row["empresa"],
        "periodo_ini": row["periodo_ini"],
        "periodo_fim": row["periodo_fim"],
        "modo": row["modo"],
        "total_clientes": row["total_clientes"],
        "total_valor": row["total_valor"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def save_curva_abc_projection(
    nome: str,
    empresa: str,
    periodo_ini: str,
    periodo_fim: str,
    modo: str,
    total_clientes: int,
    total_valor: float,
    payload: dict[str, Any],
) -> dict[str, Any]:
    now = _now()
    with _connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO curva_abc_projections
                (nome, empresa, periodo_ini, periodo_fim, modo, total_clientes, total_valor,
                 created_at, updated_at, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (nome, empresa, periodo_ini, periodo_fim, modo, total_clientes, total_valor,
             now, now, json.dumps(payload)),
        )
        new_id = cur.lastrowid
    return get_curva_abc_projection(new_id)  # type: ignore[return-value]


def list_curva_abc_projections() -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, nome, empresa, periodo_ini, periodo_fim, modo, total_clientes, "
            "total_valor, created_at, updated_at "
            "FROM curva_abc_projections ORDER BY updated_at DESC"
        ).fetchall()
    return [_row_to_curva_abc_summary(row) for row in rows]


def get_curva_abc_projection(projection_id: int) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM curva_abc_projections WHERE id = ?", (projection_id,)
        ).fetchone()
    if row is None:
        return None
    record = _row_to_curva_abc_summary(row)
    record["payload"] = json.loads(row["payload"])
    return record


def update_curva_abc_projection(
    projection_id: int,
    nome: str,
    empresa: str,
    periodo_ini: str,
    periodo_fim: str,
    modo: str,
    total_clientes: int,
    total_valor: float,
    payload: dict[str, Any],
) -> dict[str, Any] | None:
    with _connect() as conn:
        cur = conn.execute(
            """
            UPDATE curva_abc_projections
            SET nome = ?, empresa = ?, periodo_ini = ?, periodo_fim = ?, modo = ?,
                total_clientes = ?, total_valor = ?, updated_at = ?, payload = ?
            WHERE id = ?
            """,
            (nome, empresa, periodo_ini, periodo_fim, modo, total_clientes, total_valor,
             _now(), json.dumps(payload), projection_id),
        )
        if cur.rowcount == 0:
            return None
    return get_curva_abc_projection(projection_id)


def delete_curva_abc_projection(projection_id: int) -> bool:
    with _connect() as conn:
        cur = conn.execute(
            "DELETE FROM curva_abc_projections WHERE id = ?", (projection_id,)
        )
    return cur.rowcount > 0
