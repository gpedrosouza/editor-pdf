# -*- coding: utf-8 -*-
"""
curva_abc_gerador.py
=====================
Gera relatório "Curva ABC de Vendas" no layout do sistema JACOM/Industrial
(aiver210), com opção de marca de versão gerencial.

Reconstruído por medição direta de coordenadas do PDF original via OCR
(bounding boxes), convertidas para mm. Este é o mesmo princípio de
jacom_layout.py / jacom_balanco.py: reconstrução visual fiel usando
ReportLab canvas com coordenadas fixas, sem Platypus.

Uso:
    from curva_abc_gerador import gerar_curva_abc

    clientes = [
        {"cnpj_cpf": "61730517000120", "nome": "LMB COSMETICOS LTDA", "valor": 322860.20},
        ...
    ]
    gerar_curva_abc(
        clientes=clientes,
        periodo_ini="01/05/2026",
        periodo_fim="31/05/2026",
        empresa="01-EMPRESA",
        output_path="CURVA_ABC.pdf",
        versao_gerencial=True,
    )
"""
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from datetime import date

W, H = A4

FONT = "Courier"
FS = 7.2            # fonte de dados (calibrada por medição real do relatório original)
FS_HEADER_TOP = 8.3  # fonte do cabeçalho superior (empresa/sistema/data) - texto solto, sem colunas

MAR_L = 14*mm
MAR_R = 14*mm
TOP_Y = H - 14*mm
LINE_H = 13.2

# Posições de coluna (mm, right-edge), calculadas com folga de segurança
# a partir da largura máxima esperada de cada coluna nesta fonte/tamanho.
COL_CNPJ_R      = 37.5*mm
COL_NAME_X      = 39.5*mm
COL_VALOR_R     = 105.6*mm
COL_PCTREAL_R   = 125.9*mm
COL_ACUM_R      = 152.2*mm
COL_PCTACUM_R   = 169.3*mm
COL_NO_R        = 181.9*mm

NAME_MAX_W = COL_VALOR_R - 16*mm - COL_NAME_X


def fmt_money(v):
    s = f"{v:,.2f}"
    return s.replace(",", "X").replace(".", ",").replace("X", ".")


def fmt_pct(v, casas=4):
    return f"{v:.{casas}f}".replace(".", ",")


def estimar_curva_abc(
    faturamento_total,
    numero_clientes=106,
    concentracao=1.6,
    setor="Industria",
    seed=42,
):
    """
    Gera uma lista de clientes ESTIMADA (fictícia, plausível) para uso no
    modo "Faturamento" — quando não há PDF/CSV de origem, apenas o valor
    total de faturamento informado pelo usuário (mesmo padrão da tela
    "PDF existente" vs "Faturamento" já usada para DRE/Balanço).

    A distribuição de valores por cliente segue uma lei de potência
    (Pareto/Zipf), parâmetro `concentracao`, calibrada para reproduzir o
    padrão de concentração observado em uma Curva ABC real de referência
    (cliente nº1 ~45% do total, top 5 ~85% do total, cauda longa de
    clientes residuais). Ajuste `concentracao` para carteiras mais/menos
    concentradas:
        1.3-1.4 -> carteira mais pulverizada (top1 ~32-37%)
        1.6     -> padrão de referência observado (top1 ~46%)
        1.8+    -> carteira mais concentrada (top1 ~54%+)

    Os nomes de cliente são genéricos ("CLIENTE 001", "CLIENTE 002", ...)
    e os CNPJs são placeholders sequenciais — este modo NÃO gera dados
    reais de clientes, apenas uma distribuição de valores plausível para
    fins de estimativa gerencial. Troque os nomes/CNPJs depois se
    necessário, ou use o modo "dados reais" (gerar_curva_abc diretamente
    com uma lista de clientes de verdade) quando precisar de precisão
    por cliente.

    Retorna: lista de dicts no formato aceito por gerar_curva_abc()
             (cnpj_cpf, nome, valor).
    """
    import random
    rnd = random.Random(seed)

    n = numero_clientes
    ranks = list(range(1, n + 1))
    pesos = [1.0 / (r ** concentracao) for r in ranks]
    soma_pesos = sum(pesos)
    valores = [faturamento_total * (p / soma_pesos) for p in pesos]

    clientes = []
    for i, valor in enumerate(valores, 1):
        cnpj_fake = f"{rnd.randint(10**13, 10**14 - 1)}"
        clientes.append({
            "cnpj_cpf": cnpj_fake,
            "nome": f"CLIENTE {i:03d} (ESTIMADO)",
            "valor": round(valor, 2),
        })

    # Corrige arredondamento no maior cliente para bater exato com o total informado
    soma_atual = sum(c["valor"] for c in clientes)
    diff = round(faturamento_total - soma_atual, 2)
    clientes[0]["valor"] = round(clientes[0]["valor"] + diff, 2)

    return clientes


def gerar_curva_abc(
    clientes,                  # list[dict]: cnpj_cpf, nome, valor
    periodo_ini,                # "dd/mm/aaaa"
    periodo_fim,                # "dd/mm/aaaa"
    empresa="01-EMPRESA",
    output_path="CURVA_ABC.pdf",
    versao_gerencial=False,
    data_emissao=None,          # default: hoje
    hora_emissao="09:19:24",
):
    """
    Gera o PDF da Curva ABC de Vendas.

    clientes: lista de dicts com chaves 'cnpj_cpf', 'nome', 'valor' (float).
              A ordem da lista define a ordem de exibição (normalmente já
              ordenada do maior para o menor valor).
    versao_gerencial: se True, adiciona nota de rodapé identificando o
              documento como versão gerencial interna (não altera o
              cabeçalho, que permanece fiel ao layout original).
    """
    if data_emissao is None:
        data_emissao = date.today().strftime("%d/%m/%Y")

    # Ordena por valor decrescente (caso não venha ordenado) e calcula % / acumulado
    clientes_ordenados = sorted(clientes, key=lambda c: -c["valor"])
    total = sum(c["valor"] for c in clientes_ordenados)

    rows = []
    acumulado = 0.0
    for i, c in enumerate(clientes_ordenados, 1):
        valor = c["valor"]
        pct_real = (valor / total * 100) if total else 0
        acumulado += valor
        pct_acum = (acumulado / total * 100) if total else 0
        rows.append((c["cnpj_cpf"], c["nome"], valor, pct_real, acumulado, pct_acum, i))

    def draw_header(c, page_num):
        y = TOP_Y
        c.setFont(FONT, FS_HEADER_TOP)
        c.drawString(MAR_L, y, f"EMPRESA : {empresa}")
        c.drawRightString(W-MAR_R, y, f"PAG -            {page_num}")
        y -= LINE_H
        c.drawString(MAR_L, y, "SISTEMA : INDUSTRIAL")
        c.drawCentredString(W/2, y, "RELATORIO DE VENDAS (CURVA ABC)")
        c.drawRightString(W-MAR_R, y, f"DATA - {data_emissao}")
        y -= LINE_H
        c.drawString(MAR_L, y, "aiver210: R020")
        c.drawCentredString(W/2, y, f"PERIODO DE {periodo_ini} A {periodo_fim} - FAT: BRUTO")
        c.drawRightString(W-MAR_R, y, f"HORA -   {hora_emissao}")
        y -= 7
        c.line(MAR_L, y, W-MAR_R, y)
        y -= LINE_H
        c.setFont(FONT, FS)   # MESMA fonte dos dados -- crítico para não colidir colunas
        c.drawString(MAR_L + 2*mm, y, "CLIENTE")
        c.drawRightString(COL_VALOR_R, y, "VALOR CLIENTE")
        c.drawRightString(COL_PCTREAL_R, y, "%  REAL")
        c.drawRightString(COL_ACUM_R, y, "VALOR ACUMULADO")
        c.drawRightString(COL_PCTACUM_R, y, "% ACUM")
        c.drawRightString(COL_NO_R, y, "No")
        y -= 7
        c.line(MAR_L, y, W-MAR_R, y)
        y -= LINE_H
        return y

    def draw_footer(c):
        c.setFont(FONT, 7.5)
        c.drawString(MAR_L, 14*mm, f"{'SAO PAULO'}, {data_emissao.replace('/', ' de ', 1) if False else data_emissao}")
        if versao_gerencial:
            c.setFont(FONT, 6.3)
            c.drawString(MAR_L, 9*mm,
                "Documento gerencial interno - versao ajustada para uso interno - nao substitui o relatorio oficial assinado")

    def draw_row(c, y, cnpj, nome, valor, pct_real, acumulado, pct_acum, no):
        c.setFont(FONT, FS)
        nome_trunc = nome
        while stringWidth(nome_trunc, FONT, FS) > NAME_MAX_W and len(nome_trunc) > 5:
            nome_trunc = nome_trunc[:-1]
        c.drawRightString(COL_CNPJ_R, y, cnpj)
        c.drawString(COL_NAME_X, y, nome_trunc)
        c.drawRightString(COL_VALOR_R, y, fmt_money(valor))
        c.drawRightString(COL_PCTREAL_R, y, fmt_pct(pct_real, 4) + " %")
        c.drawRightString(COL_ACUM_R, y, fmt_money(acumulado))
        c.drawRightString(COL_PCTACUM_R, y, fmt_pct(pct_acum, 2) + " %")
        c.drawRightString(COL_NO_R, y, f"{no:02d}" if no < 100 else str(no))

    cv = canvas.Canvas(output_path, pagesize=A4)

    header_block_height = 3*LINE_H + 14 + LINE_H + 7
    usable_top = TOP_Y - header_block_height
    usable_bottom = 24*mm
    rows_per_page = int((usable_top - usable_bottom) / LINE_H)

    idx = 0
    page_num = 1
    n = len(rows)
    while idx < n:
        y = draw_header(cv, page_num)
        count_this_page = 0
        while idx < n and count_this_page < rows_per_page:
            cnpj, nome, valor, pct_real, acumulado, pct_acum, no = rows[idx]
            draw_row(cv, y, cnpj, nome, valor, pct_real, acumulado, pct_acum, no)
            y -= LINE_H
            idx += 1
            count_this_page += 1
        if idx >= n:
            y -= 6
            cv.line(MAR_L, y, MAR_L + 90*mm, y)
            y -= LINE_H
            cv.setFont(FONT, 8.5)
            cv.drawString(MAR_L + 20*mm, y, "T O T A L   ----------->")
            cv.drawRightString(COL_VALOR_R, y, fmt_money(total))
        draw_footer(cv)
        cv.showPage()
        page_num += 1

    cv.save()
    return {
        "output_path": output_path,
        "total_clientes": n,
        "total_valor": total,
        "paginas": page_num - 1,
    }


def validar_colisoes(pdf_path, gap_minimo_mm=0.5):
    """
    Validação programática pós-geração: extrai coordenadas de cada palavra
    via pdftotext -bbox e verifica se o espaço entre palavras adjacentes na
    mesma linha é >= gap_minimo_mm. Retorna lista de colisões encontradas
    (vazia = layout seguro). Requer poppler-utils (pdftotext) no sistema.
    """
    import subprocess, re
    from collections import defaultdict

    info = subprocess.run(["pdfinfo", pdf_path], capture_output=True, text=True).stdout
    n_pages = 1
    for line in info.splitlines():
        if line.startswith("Pages:"):
            n_pages = int(line.split(":")[1].strip())

    pt_per_mm = 72/25.4
    pattern = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>')
    all_collisions = []

    for p in range(1, n_pages+1):
        out = subprocess.run(
            ["pdftotext", "-bbox", "-f", str(p), "-l", str(p), pdf_path, "-"],
            capture_output=True, text=True
        ).stdout
        words = [(float(a), float(b), float(c), float(d), e) for a, b, c, d, e in pattern.findall(out)]
        lines = defaultdict(list)
        for w in words:
            lines[round(w[1], 1)].append(w)
        for y, ws in sorted(lines.items()):
            ws.sort(key=lambda w: w[0])
            for i in range(len(ws)-1):
                gap_mm = (ws[i+1][0] - ws[i][2]) / pt_per_mm
                if gap_mm < gap_minimo_mm:
                    all_collisions.append({
                        "pagina": p, "y": y,
                        "texto1": ws[i][4], "texto2": ws[i+1][4],
                        "gap_mm": round(gap_mm, 2),
                    })
    return all_collisions
