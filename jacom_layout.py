"""
jacom_layout.py
===============
Reconstrói o layout visual do sistema JACOM a partir de texto extraído de PDF.

O sistema JACOM (Jacom Inteligência Contábil Ltda) gera PDFs com estrutura
consistente. Este módulo replica esse layout usando ReportLab para gerar
documentos gerenciais no mesmo padrão visual.

Estrutura do layout JACOM:
  - Cabeçalho: empresa (esq), Folha N (dir), CNPJ (esq), livro (dir), período
  - Título centralizado do documento
  - Colunas: Descrição (esq) | Saldo Parcial (centro-dir) | Saldo Total (dir)
  - Seções em negrito sem recuo
  - Subcontas com 1 nível de recuo (sem fundo diferenciado)
  - Valores negativos entre parênteses: (1.234,56)
  - Totalizadores em negrito na coluna Saldo Total
  - Rodapé: cidade, data, assinaturas (empresário + contador CRC)
  - Marca d'água: "VERSÃO GERENCIAL INTERNA" para documentos gerenciais
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from dataclasses import dataclass, field
from typing import List, Optional, Tuple
from datetime import date, datetime


# ── Constantes do layout ─────────────────────────────────────────────────────
W, H    = A4                  # 210 x 297 mm
MAR_E   = 14 * mm            # margem esquerda
MAR_D   = 14 * mm            # margem direita
MAR_T   = 10 * mm            # margem topo
MAR_B   = 18 * mm            # margem base (rodapé)
COL_A   = MAR_E              # início coluna Descrição
COL_B   = W - 68 * mm        # início col Saldo Parcial (alinhado direita em W-50)
COL_C   = W - MAR_D          # final col Saldo Total (alinhado direita)
COL_B_R = W - 50 * mm        # alinhamento direita Saldo Parcial
LH_NORM = 4.5 * mm           # altura de linha normal
LH_SECT = 5.0 * mm           # altura de linha de seção
FONT    = "Helvetica"
FONT_B  = "Helvetica-Bold"
SZ_BODY = 8.0                 # tamanho fonte corpo
SZ_HEAD = 8.5                 # tamanho fonte cabeçalho
SZ_TITL = 9.5                 # tamanho fonte título

# Temporariamente desabilitado para testar o uso em um sistema contabil oficial.
# Para reativar, altere para True.
EXIBIR_MARCAS_GERENCIAIS = False

MESES_PT = [
    "",
    "Janeiro",
    "Fevereiro",
    "Marco",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
]


# ── Formatação de valores ─────────────────────────────────────────────────────
def fmt_br(v: float, parenteses: bool = True) -> str:
    """Formata valor no padrão brasileiro. Negativos entre parênteses."""
    if v is None:
        return ""
    s = f"{abs(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    if v < 0 and parenteses:
        return f"({s})"
    return s

def fmt_dc(v: float) -> str:
    """Adiciona sufixo D/C para o Balanço."""
    s = fmt_br(abs(v))
    return f"{s}D" if v >= 0 else f"{s}C"


def fmt_data_emissao(value=None) -> str:
    """Formata a data de emissao em portugues."""
    if value is None or value == "":
        dt = date.today()
    elif isinstance(value, date):
        dt = value
    else:
        raw = str(value).strip()
        dt = None
        for pattern in ("%Y-%m-%d", "%d/%m/%Y"):
            try:
                dt = datetime.strptime(raw, pattern).date()
                break
            except ValueError:
                pass
        if dt is None:
            return raw
    return f"{dt.day:02d} de {MESES_PT[dt.month]} de {dt.year}"


# ── Estrutura de linha ────────────────────────────────────────────────────────
@dataclass
class Linha:
    descricao: str
    parcial: Optional[float] = None    # coluna do meio (subconta)
    total: Optional[float] = None      # coluna da direita (totalizador)
    negrito: bool = False
    recuo: int = 0                     # nível de recuo (0=sem recuo, 1=subconta)
    separador: bool = False            # linha vazia de separação
    sufixo_dc: bool = False            # adicionar D/C (balanço)


# ── Gerador principal ─────────────────────────────────────────────────────────
class JacomPDF:
    """
    Gera PDF no padrão visual JACOM.
    
    Uso:
        pdf = JacomPDF("saida.pdf", tipo="DRE")
        pdf.set_empresa("EMPRESA LTDA", "00.000.000/0001-00",
                        "01/01/2025", "31/12/2025")
        pdf.set_modo_gerencial(True)  # adiciona marca d'água e aviso
        
        linhas = [
            Linha("RECEITA BRUTA", negrito=True),
            Linha("  Venda de Produtos", parcial=100000.0),
            Linha("  Servicos Prestados", parcial=50000.0, total=150000.0),
            Linha(""),  # separador
            Linha("LUCRO BRUTO", total=50000.0, negrito=True),
        ]
        pdf.gerar(linhas)
        pdf.salvar()
    """

    def __init__(self, output_path: str, tipo: str = "DRE"):
        self.output_path = output_path
        self.tipo = tipo          # "DRE" ou "BALANCO"
        self.c = rl_canvas.Canvas(output_path, pagesize=A4)
        self.pagina = 1
        self.y = 0.0

        # Dados da empresa
        self.empresa = ""
        self.cnpj = ""
        self.data_ini = ""
        self.data_fim = ""
        self.cidade = "BOTUCATU"
        self.data_emissao = fmt_data_emissao()
        self.numero_livro = "0001"

        # Assinaturas
        self.empresario_nome = ""
        self.empresario_cargo = "EMPRESÁRIO"
        self.empresario_cpf = ""
        self.contador_nome = ""
        self.contador_crc = ""
        self.contador_cpf = ""

        # Modo gerencial
        self.gerencial = False

    def set_empresa(self, nome: str, cnpj: str,
                    data_ini: str, data_fim: str,
                    cidade: str = "CAMPO LIMPO PAULISTA"):
        self.empresa = nome
        self.cnpj = cnpj
        self.data_ini = data_ini
        self.data_fim = data_fim
        self.cidade = cidade

    def set_data_emissao(self, data_emissao):
        self.data_emissao = fmt_data_emissao(data_emissao)

    def set_assinaturas(self, emp_nome: str, emp_cpf: str,
                        cont_nome: str, cont_crc: str, cont_cpf: str,
                        emp_cargo: str = "EMPRESÁRIO"):
        self.empresario_nome = emp_nome
        self.empresario_cpf = emp_cpf
        self.empresario_cargo = emp_cargo
        self.contador_nome = cont_nome
        self.contador_crc = cont_crc
        self.contador_cpf = cont_cpf

    def set_modo_gerencial(self, ativo: bool = True):
        self.gerencial = ativo

    # ── Componentes visuais ──────────────────────────────────────────────────

    def _watermark(self):
        if not self.gerencial or not EXIBIR_MARCAS_GERENCIAIS:
            return
        self.c.saveState()
        self.c.setFont(FONT_B, 55)
        self.c.setFillColor(colors.black)
        self.c.setFillAlpha(0.06)
        self.c.translate(W / 2, H / 2)
        self.c.rotate(45)
        self.c.drawCentredString(0, 20, "VERSÃO GERENCIAL")
        self.c.drawCentredString(0, -30, "INTERNA")
        self.c.restoreState()

    def _cabecalho(self):
        """Replica o cabeçalho padrão JACOM."""
        c = self.c
        y = H - MAR_T

        # Linha 1: Empresa (esq) | Folha (dir)
        c.setFont(FONT_B, SZ_HEAD)
        c.setFillColor(colors.black)
        c.drawString(COL_A, y, f"Empresa:  {self.empresa}")
        c.drawRightString(COL_C, y, f"Folha: {self.pagina:04d}")
        y -= 4.5 * mm

        # Linha 2: CNPJ (esq) | Número livro (dir)
        c.setFont(FONT, SZ_HEAD)
        c.drawString(COL_A, y, f"C.N.P.J.: {self.cnpj}")
        c.drawRightString(COL_C, y, f"Número livro:  {self.numero_livro}")
        y -= 4.5 * mm

        # Linha 3: Período
        c.drawString(COL_A, y, f"Período:  {self.data_ini} - {self.data_fim}")
        y -= 5 * mm

        # Linha separadora
        c.setStrokeColor(colors.black)
        c.setLineWidth(0.5)
        c.line(COL_A, y, COL_C, y)
        y -= 5 * mm

        # Título do documento
        if self.tipo == "DRE":
            titulo = f"DEMONSTRAÇÃO DO RESULTADO DO EXERCÍCIO EM {self.data_fim}"
        else:
            titulo = f"BALANÇO PATRIMONIAL"
            subtit = f"Balanço encerrado em: {self.data_fim}"

        c.setFont(FONT_B, SZ_TITL)
        c.drawCentredString(W / 2, y, titulo)
        y -= 5 * mm

        if self.tipo == "BALANCO":
            c.setFont(FONT, SZ_BODY)
            c.drawCentredString(W / 2, y, subtit)
            y -= 4 * mm

        # Aviso gerencial temporariamente desabilitado.
        # if self.gerencial and EXIBIR_MARCAS_GERENCIAIS:
        if False:
            c.setFont(FONT_B, 7.5)
            c.setFillColor(colors.HexColor("#C05C00"))
            c.drawCentredString(W / 2, y,
                "VERSÃO GERENCIAL INTERNA — Documento não oficial, sem valor contábil ou legal")
            c.setFillColor(colors.black)
            y -= 4 * mm

        # Cabeçalho das colunas
        c.setFont(FONT_B, SZ_BODY)
        c.drawString(COL_A, y, "Descrição")
        c.drawRightString(COL_C, y, "Saldo Total")
        y -= 1.5 * mm
        c.setLineWidth(0.3)
        c.line(COL_A, y, COL_C, y)
        y -= 4 * mm

        self.y = y

    def _rodape(self, ultima_pagina: bool = False):
        """Replica o rodapé padrão JACOM."""
        c = self.c
        y_rod = MAR_B

        # Linha separadora
        c.setStrokeColor(colors.black)
        c.setLineWidth(0.3)
        c.line(COL_A, y_rod + 12 * mm, COL_C, y_rod + 12 * mm)

        c.setFont(FONT, 7.5)
        c.setFillColor(colors.black)

        # Sistema e cidade/data
        if not ultima_pagina:
            c.drawString(COL_A, y_rod + 8 * mm,
                "Sistema licenciado para GR GESTÃO FINANCEIRA LTDA")
            c.drawRightString(COL_C, y_rod + 8 * mm,
                f"{self.cidade}, {self.data_emissao}")
        else:
            # Última página: assinaturas
            c.drawString(COL_A, y_rod + 8 * mm,
                f"{self.cidade}, {self.data_emissao}")

            # Rodape gerencial temporariamente desabilitado.
            # if self.gerencial and EXIBIR_MARCAS_GERENCIAIS:
            if False:
                c.setFont(FONT_B, 7)
                c.setFillColor(colors.HexColor("#C05C00"))
                c.drawCentredString(W / 2, y_rod,
                    "Documento gerencial para uso interno exclusivo. "
                    "Não constitui peça contábil oficial.")
                c.setFillColor(colors.black)
            else:
                # Assinaturas lado a lado
                cx_e = COL_A + 40 * mm
                cx_d = COL_C - 40 * mm
                y_ass = y_rod - 8 * mm

                c.setFont(FONT, 7.5)
                c.drawCentredString(cx_e, y_ass + 4 * mm,
                    "_______________________________________")
                c.drawCentredString(cx_d, y_ass + 4 * mm,
                    "_______________________________________")
                c.setFont(FONT_B, 7.5)
                c.drawCentredString(cx_e, y_ass,
                    self.empresario_nome or "NOME DO EMPRESÁRIO")
                c.drawCentredString(cx_d, y_ass,
                    self.contador_nome or "NOME DO CONTADOR")
                c.setFont(FONT, 7.5)
                c.drawCentredString(cx_e, y_ass - 4 * mm, self.empresario_cargo)
                if self.contador_crc:
                    c.drawCentredString(cx_d, y_ass - 4 * mm,
                        f"Reg. no CRC - SP sob o No. {self.contador_crc}")
                if self.empresario_cpf:
                    c.drawCentredString(cx_e, y_ass - 8 * mm,
                        f"CPF: {self.empresario_cpf}")
                if self.contador_cpf:
                    c.drawCentredString(cx_d, y_ass - 8 * mm,
                        f"CPF: {self.contador_cpf}")

    def _nova_pagina(self, ultima: bool = False):
        self._rodape(ultima_pagina=ultima)
        self.c.showPage()
        self.pagina += 1
        self._watermark()
        self._cabecalho()

    def _checar_pagina(self, h_necessaria: float = LH_NORM):
        """Quebra de página automática."""
        if self.y - h_necessaria < MAR_B + 25 * mm:
            self._nova_pagina()

    # ── Renderização de linhas ───────────────────────────────────────────────

    def _linha(self, l: Linha):
        """Renderiza uma única linha no padrão JACOM."""
        if l.separador or (not l.descricao and l.parcial is None and l.total is None):
            self.y -= LH_NORM * 0.6
            return

        self._checar_pagina(LH_NORM)

        c = self.c
        recuo = l.recuo * 4 * mm
        font = FONT_B if l.negrito else FONT

        # Descrição
        c.setFont(font, SZ_BODY)
        c.setFillColor(colors.black)
        c.drawString(COL_A + recuo, self.y, l.descricao)

        # Saldo Parcial (coluna do meio)
        if l.parcial is not None:
            c.setFont(FONT, SZ_BODY)
            txt = fmt_dc(l.parcial) if l.sufixo_dc else fmt_br(l.parcial)
            c.drawRightString(COL_B_R, self.y, txt)

        # Saldo Total (coluna direita)
        if l.total is not None:
            c.setFont(font, SZ_BODY)
            txt = fmt_dc(l.total) if l.sufixo_dc else fmt_br(l.total)
            c.drawRightString(COL_C, self.y, txt)

        self.y -= LH_NORM

    # ── Interface principal ──────────────────────────────────────────────────

    def gerar(self, linhas: List[Linha]):
        """Gera o documento a partir de uma lista de Linha."""
        self._watermark()
        self._cabecalho()

        for i, l in enumerate(linhas):
            self._linha(l)

        # Última página: rodapé com assinaturas
        self._rodape(ultima_pagina=True)

    def salvar(self):
        self.c.save()
        return self.output_path


# ════════════════════════════════════════════════════════════════════════════
#  FUNÇÕES DE CONVENIÊNCIA
# ════════════════════════════════════════════════════════════════════════════

def gerar_dre_jacom(dados: dict, output_path: str,
                    gerencial: bool = True) -> str:
    """
    Gera DRE no padrão JACOM a partir de um dicionário de valores.
    
    dados = {
        'empresa': 'NOME EMPRESA LTDA',
        'cnpj': '00.000.000/0001-00',
        'data_ini': '01/01/2025',
        'data_fim': '31/12/2025',
        'cidade': 'SAO PAULO',
        # Receita Bruta
        'venda_produtos': 6654807.80,
        'venda_produtos_export': 214654.14,
        ...
        # (todos os campos extraídos pelo extrator)
    }
    """
    pdf = JacomPDF(output_path, tipo="DRE")
    pdf.set_empresa(
        dados.get('empresa', ''),
        dados.get('cnpj', ''),
        dados.get('data_ini', ''),
        dados.get('data_fim', ''),
        dados.get('cidade', 'SAO PAULO'),
    )
    if dados.get('data_emissao'):
        pdf.set_data_emissao(dados.get('data_emissao'))
    pdf.set_modo_gerencial(gerencial)

    # Configurar assinaturas (opcional)
    if dados.get('empresario_nome') or dados.get('contador_nome'):
        pdf.set_assinaturas(
            dados['empresario_nome'], dados.get('empresario_cpf', ''),
            dados.get('contador_nome', ''), dados.get('contador_crc', ''),
            dados.get('contador_cpf', ''),
            dados.get('empresario_cargo', 'EMPRESARIO'),
        )

    def L(desc, par=None, tot=None, bold=False, recuo=0):
        return Linha(desc, parcial=par, total=tot, negrito=bold, recuo=recuo)
    def SEP():
        return Linha("", separador=True)

    d = dados  # atalho

    linhas = [
        L("RECEITA BRUTA", bold=True),
        L("VENDA DE PRODUTOS",                   par=d.get('venda_produtos', 0),          recuo=1),
        L("VENDA DE PRODUTOS EXPORTAÇÃO",        par=d.get('venda_produtos_export', 0),   recuo=1),
        L("VENDA DE MERCADORIAS",                par=d.get('venda_mercadorias', 0),        recuo=1),
        L("VENDA DE MERCADORIAS EXPORTAÇÃO",     par=d.get('venda_mercadorias_export', 0),recuo=1),
        L("SERVIÇOS PRESTADOS",                  par=d.get('servicos_prestados', 0),
          tot=sum(d.get(k,0) for k in ['venda_produtos','venda_produtos_export',
                                        'venda_mercadorias','venda_mercadorias_export',
                                        'servicos_prestados']),                           recuo=1),
        SEP(),
        L("DEDUÇÕES DA RECEITA BRUTA", bold=True),
        L("(-) DEVOLUÇÃO DE VENDA DE MERCADORIAS", par=-d.get('devolucao',0),             recuo=1),
        L("(-) IPI",                             par=-d.get('ipi_ded', 0),                recuo=1),
        L("(-) ICMS",                            par=-d.get('icms_ded', 0),               recuo=1),
        L("(-) COFINS",                          par=-d.get('cofins', 0),                 recuo=1),
        L("(-) PIS",                             par=-d.get('pis', 0),                    recuo=1),
        L("(-) SUBSTITUIÇÃO TRIBUTÁRIA",         par=-d.get('subst_trib', 0),
          tot=-sum(d.get(k,0) for k in ['devolucao','ipi_ded','icms_ded',
                                         'cofins','pis','subst_trib']),                   recuo=1),
        L("RECEITA LÍQUIDA",
          tot=(sum(d.get(k,0) for k in ['venda_produtos','venda_produtos_export',
                                         'venda_mercadorias','venda_mercadorias_export',
                                         'servicos_prestados'])
               - sum(d.get(k,0) for k in ['devolucao','ipi_ded','icms_ded',
                                            'cofins','pis','subst_trib'])),               bold=True),
        SEP(),
        L("CUSTOS", bold=True),
        L("INDUSTRIALIZAÇÃO",                    par=-d.get('industrializacao',0),        recuo=1),
        L("BONIFICAÇÃO",                         par=-d.get('bonificacao',0),             recuo=1),
        L("ICMS DIFERENCIAL DE ALÍQUOTA",        par=-d.get('icms_dif_aliq',0),
          tot=-(d.get('industrializacao',0)+d.get('bonificacao',0)+d.get('icms_dif_aliq',0)), recuo=1),
        L("CMV", bold=True),
        L("CUSTOS DOS PRODUTOS VENDIDOS",        par=-d.get('cpv',0),                     recuo=1),
        L("CUSTOS DAS MERCADORIAS VENDIDAS",     par=-d.get('cmv',0),
          tot=-(d.get('cpv',0)+d.get('cmv',0)),                                           recuo=1),
        L("LUCRO BRUTO",
          tot=(sum(d.get(k,0) for k in ['venda_produtos','venda_produtos_export',
                                         'venda_mercadorias','venda_mercadorias_export',
                                         'servicos_prestados'])
               - sum(d.get(k,0) for k in ['devolucao','ipi_ded','icms_ded',
                                            'cofins','pis','subst_trib',
                                            'industrializacao','bonificacao','icms_dif_aliq',
                                            'cpv','cmv'])),                               bold=True),
        SEP(),
        L("DESPESAS OPERACIONAIS",
          tot=-sum(d.get(k,0) for k in [
              'salarios','pro_labore','premios','decimo_terceiro','ferias',
              'inss_desp','fgts','indenizacoes','assist_medica','adicionais',
              'alim_pessoal','horas_extras','uniformes',
              'alugueis','embalagens_adm','internet','bens_peq_valor',
              'equip_seguranca','manut_maq','limpeza','associacoes','cartorios',
              'equip_protecao','mat_laboratorio','manut_veiculos',
              'ipva','taxas_diversas','taxas_vig_san','icms_nao_contrib','taxas_iss',
              'energia','agua','telefone','postais','seguros','mat_escritorio',
              'mat_higiene','assist_contabil','serv_terceiros','depreciacao',
              'propaganda','assessoria','mat_consumo','combustiveis','seg_patrim',
              'suporte_tecnico','treinamento','alim_geral','agenciamento',
              'dedetizacao','desp_medica','software','fretes','manut_reparo',
          ]),                                                                              bold=True),
        SEP(),
        L("DESPESAS COM PESSOAL", bold=True),
        L("SALÁRIOS E ORDENADOS",               par=-d.get('salarios',0),                recuo=1),
        L("PRÓ-LABORE",                         par=-d.get('pro_labore',0),              recuo=1),
        L("PRÊMIOS E GRATIFICAÇÕES",            par=-d.get('premios',0),                 recuo=1),
        L("13º SALÁRIO",                         par=-d.get('decimo_terceiro',0),         recuo=1),
        L("FÉRIAS",                              par=-d.get('ferias',0),                  recuo=1),
        L("INSS",                                par=-d.get('inss_desp',0),               recuo=1),
        L("FGTS",                                par=-d.get('fgts',0),                    recuo=1),
        L("INDENIZAÇÕES E AVISO PRÉVIO",        par=-d.get('indenizacoes',0),            recuo=1),
        L("ASSISTÊNCIA MÉDICA E SOCIAL",        par=-d.get('assist_medica',0),           recuo=1),
        L("ADICIONAIS",                          par=-d.get('adicionais',0),              recuo=1),
        L("DESPESAS COM ALIMENTAÇÃO",           par=-d.get('alim_pessoal',0),            recuo=1),
        L("HORAS EXTRAS",                        par=-d.get('horas_extras',0),            recuo=1),
        L("UNIFORMES",                           par=-d.get('uniformes',0),
          tot=-sum(d.get(k,0) for k in ['salarios','pro_labore','premios',
                                          'decimo_terceiro','ferias','inss_desp','fgts',
                                          'indenizacoes','assist_medica','adicionais',
                                          'alim_pessoal','horas_extras','uniformes']),   recuo=1),
        L("DESPESAS ADMINISTRATIVAS", bold=True),
        L("ALUGUÉIS DE IMÓVEIS",               par=-d.get('alugueis',0),                recuo=1),
        L("EMBALAGENS",                          par=-d.get('embalagens_adm',0),          recuo=1),
        L("INTERNET",                            par=-d.get('internet',0),                recuo=1),
        L("BENS DE PEQUENO VALOR",              par=-d.get('bens_peq_valor',0),          recuo=1),
        L("EQUIPAMENTOS DE SEGURANÇA",          par=-d.get('equip_seguranca',0),         recuo=1),
        L("MANUTENÇÃO/REPARO MAQ. EQUIPAM.",   par=-d.get('manut_maq',0),               recuo=1),
        L("LIMPEZA E CONSERV. PREDIAL",        par=-d.get('limpeza',0),                 recuo=1),
        L("ASSOCIAÇÕES E ORGÃOS DE CLASSE",    par=-d.get('associacoes',0),             recuo=1),
        L("DESPESAS COM CARTÓRIOS",             par=-d.get('cartorios',0),               recuo=1),
        L("EQUIPAMENTOS DE PROTEÇÃO",           par=-d.get('equip_protecao',0),          recuo=1),
        L("MATERIAIS DE USO LABORATORIO",       par=-d.get('mat_laboratorio',0),         recuo=1),
        L("MANUTENÇÃO/CONSERV VEÍCULOS",        par=-d.get('manut_veiculos',0),
          tot=-sum(d.get(k,0) for k in ['alugueis','embalagens_adm','internet',
                                          'bens_peq_valor','equip_seguranca','manut_maq',
                                          'limpeza','associacoes','cartorios',
                                          'equip_protecao','mat_laboratorio','manut_veiculos']), recuo=1),
        L("DESPESAS TRIBUTÁRIAS", bold=True),
        L("IPVA/LICENCIAMENTO",                  par=-d.get('ipva',0),                   recuo=1),
        L("TAXAS DIVERSAS",                      par=-d.get('taxas_diversas',0),         recuo=1),
        L("TAXAS VIGILANCIA SANITARIA",          par=-d.get('taxas_vig_san',0),          recuo=1),
        L("ICMS - NÃO CONTRIB",                 par=-d.get('icms_nao_contrib',0),        recuo=1),
        L("TAXAS ANUAL/ISS - PREFEITURA",       par=-d.get('taxas_iss',0),
          tot=-sum(d.get(k,0) for k in ['ipva','taxas_diversas','taxas_vig_san',
                                          'icms_nao_contrib','taxas_iss']),               recuo=1),
        L("DESPESAS GERAIS", bold=True),
        L("ENERGIA ELÉTRICA",                   par=-d.get('energia',0),                 recuo=1),
        L("ÁGUA E ESGOTO",                      par=-d.get('agua',0),                    recuo=1),
        L("TELEFONE",                            par=-d.get('telefone',0),                recuo=1),
        L("DESPESAS POSTAIS E TELEGRÁFICAS",   par=-d.get('postais',0),                 recuo=1),
        L("SEGUROS",                             par=-d.get('seguros',0),                 recuo=1),
        L("MATERIAL DE ESCRITÓRIO",             par=-d.get('mat_escritorio',0),          recuo=1),
        L("MATERIAL DE HIGIENE E LIMPEZA",      par=-d.get('mat_higiene',0),             recuo=1),
        L("ASSISTÊNCIA CONTÁBIL",               par=-d.get('assist_contabil',0),         recuo=1),
        L("SERVIÇOS PRESTADOS POR TERCEIROS",   par=-d.get('serv_terceiros',0),          recuo=1),
        L("DEPRECIAÇÕES E AMORTIZAÇÕES",        par=-d.get('depreciacao',0),             recuo=1),
        L("PROPAGANDA/PUBLICIDADE/MARKETING",   par=-d.get('propaganda',0),              recuo=1),
        L("ASSESSORIA E CONSULTORIA",           par=-d.get('assessoria',0),              recuo=1),
        L("MATERIAL DE USO E CONSUMO",          par=-d.get('mat_consumo',0),             recuo=1),
        L("COMBUSTÍVEIS E LUBRIFICANTES",       par=-d.get('combustiveis',0),            recuo=1),
        L("SERV SEGURANCA PATRIMONIAL",         par=-d.get('seg_patrim',0),              recuo=1),
        L("SUPORTE TECNICO",                    par=-d.get('suporte_tecnico',0),         recuo=1),
        L("TREINAMENTO E DESENVOLVIMENTO",      par=-d.get('treinamento',0),             recuo=1),
        L("DESPESAS COM ALIMENTAÇÃO",           par=-d.get('alim_geral',0),              recuo=1),
        L("AGENCIAMENTO E COMISSAO",            par=-d.get('agenciamento',0),            recuo=1),
        L("DESPESAS DEDETIZACAO",               par=-d.get('dedetizacao',0),             recuo=1),
        L("DESPESA MEDICA/PERICIA/EXAMES LABORATORIAIS", par=-d.get('desp_medica',0),   recuo=1),
        L("DESPESA SOFTWARE",                   par=-d.get('software',0),                recuo=1),
        L("FRETES E CARRETOS",                  par=-d.get('fretes',0),                  recuo=1),
        L("MANUTENÇÃO E REPARO",                par=-d.get('manut_reparo',0),
          tot=-sum(d.get(k,0) for k in ['energia','agua','telefone','postais','seguros',
                                          'mat_escritorio','mat_higiene','assist_contabil',
                                          'serv_terceiros','depreciacao','propaganda',
                                          'assessoria','mat_consumo','combustiveis',
                                          'seg_patrim','suporte_tecnico','treinamento',
                                          'alim_geral','agenciamento','dedetizacao',
                                          'desp_medica','software','fretes','manut_reparo']), recuo=1),
        L("DESPESAS FINANCEIRAS", bold=True),
        L("JUROS PASSIVOS",                     par=-d.get('juros_passivos',0),          recuo=1),
        L("TAXAS CAMBIAIS PASSIVAS",            par=-d.get('taxas_cambiais',0),          recuo=1),
        L("IOF",                                par=-d.get('iof',0),                     recuo=1),
        L("JUROS E COMISSÕES BANCÁRIAS",       par=-d.get('juros_comissoes',0),         recuo=1),
        L("JUROS SOBRE EMPRÉSTIMOS E FINANCIAMENTOS", par=-d.get('juros_emp',0),        recuo=1),
        L("MULTAS DE MORA",                     par=-d.get('multas_mora',0),             recuo=1),
        L("TARIFA BANCÁRIA",                    par=-d.get('tarifa_bancaria',0),
          tot=-sum(d.get(k,0) for k in ['juros_passivos','taxas_cambiais','iof',
                                          'juros_comissoes','juros_emp',
                                          'multas_mora','tarifa_bancaria']),              recuo=1),
        L("RECEITAS FINANCEIRAS", bold=True),
        L("JUROS DE APLICAÇÕES",               par=d.get('juros_aplicacoes',0),         recuo=1),
        L("JUROS ATIVOS",                       par=d.get('juros_ativos',0),             recuo=1),
        L("DESCONTOS FINANCEIROS OBTIDOS",      par=d.get('descontos_fin',0),            recuo=1),
        L("BONIFICAÇOES E AMOSTRAS",            par=d.get('bonif_amostras',0),
          tot=sum(d.get(k,0) for k in ['juros_aplicacoes','juros_ativos',
                                         'descontos_fin','bonif_amostras']),              recuo=1),
        SEP(),
        L("RESULTADO OPERACIONAL",
          tot=d.get('_resultado_op', 0),                                                  bold=True),
        SEP(),
        L("RESULTADO ANTES DO IR E CSL",
          tot=d.get('_resultado_op', 0),                                                  bold=True),
        SEP(),
        L("PROVISÕES PARA IR E CSL", bold=True),
        L("PROVISÃO P/ CONTRIBUIÇÃO SOCIAL",   par=-d.get('csll',0),                    recuo=1),
        L("PROVISÃO P/ IMPOSTO DE RENDA",      par=-d.get('irpj',0),
          tot=-(d.get('csll',0)+d.get('irpj',0)),                                        recuo=1),
        SEP(),
        L("PREJUÍZO DO EXERCÍCIO" if d.get('_resultado_final',0) < 0 else "LUCRO DO EXERCÍCIO",
          tot=d.get('_resultado_final', 0),                                               bold=True),
    ]

    pdf.gerar(linhas)
    return pdf.salvar()


def gerar_balanco_jacom(dados: dict, output_path: str,
                        gerencial: bool = True) -> str:
    """Gera Balanco Patrimonial no padrao JACOM a partir do cenario."""
    from gerencial.projection_engine import calculate_balanco_totals

    pdf = JacomPDF(output_path, tipo="BALANCO")
    pdf.set_empresa(
        dados.get('empresa', ''),
        dados.get('cnpj', ''),
        dados.get('data_ini', ''),
        dados.get('data_fim', ''),
        dados.get('cidade', 'SAO PAULO'),
    )
    if dados.get('data_emissao'):
        pdf.set_data_emissao(dados.get('data_emissao'))
    pdf.set_modo_gerencial(gerencial)

    if dados.get('empresario_nome') or dados.get('contador_nome'):
        pdf.set_assinaturas(
            dados['empresario_nome'], dados.get('empresario_cpf', ''),
            dados.get('contador_nome', ''), dados.get('contador_crc', ''),
            dados.get('contador_cpf', ''),
            dados.get('empresario_cargo', 'EMPRESARIO'),
        )

    totals = calculate_balanco_totals(dados)

    def n(key):
        return float(dados.get(key, 0) or 0)

    def s(keys):
        return sum(n(k) for k in keys)

    def debit(value):
        return abs(value) if value is not None else None

    def credit(value):
        return -abs(value) if value is not None else None

    def L(desc, par=None, tot=None, bold=False, recuo=0, side="D"):
        if side == "C":
            par = credit(par) if par is not None else None
            tot = credit(tot) if tot is not None else None
        elif side == "D":
            par = debit(par) if par is not None else None
            tot = debit(tot) if tot is not None else None
        return Linha(desc, parcial=par, total=tot, negrito=bold, recuo=recuo,
                     sufixo_dc=True)

    def SEP():
        return Linha("", separador=True)

    bancos_cp = s(['sicoob_cc', 'santander_cc'])
    financiamentos_cp = s([
        'sicoob_1320100', 'sicoob_1264152', 'sicoob_01606720',
        'bb_conta_garantida', 'bb_giro_peac', 'santander_peac',
        'bb_capital_giro', 'santander_garantida',
    ])
    impostos_recolher = s([
        'ipi_rel', 'irpj_rel', 'csll_rel', 'irrf_rel',
        'pis_rel', 'cofins_rel', 'crf_rel', 'inss_ret_rel',
        'icms_st_rel', 'ir_aluguel',
    ])
    folha_recolher = s([
        'sal_pagar', 'pro_labore_pagar', 'pensao',
        'inss_rel', 'fgts_rel', 'irrf_folha',
    ])
    investimentos = s(['quotas_sicoob', 'banco_sicoob_inv'])
    compulsorios_analiticos = s(['gran_belle', 'solution_vet'])
    compulsorios = compulsorios_analiticos or n('emp_compulsorios')
    depreciacao = s([
        'dep_moveis', 'dep_maquinas', 'dep_veiculos',
        'dep_ti', 'dep_instalacoes',
    ])

    linhas = [
        L("ATIVO", bold=True),
        L("ATIVO CIRCULANTE", bold=True),
        L("DISPONIVEL", bold=True, recuo=1),
        L("CAIXA GERAL", par=n('caixa_geral'), recuo=2),
        L("CAIXA ECONOMICA FEDERAL", par=n('cef'), recuo=2),
        L("BANCO SICOOB", par=n('sicoob_mov'), recuo=2),
        L("BANCO DO BRASIL - APLIC.", par=n('bb_aplic'), recuo=2),
        L("BANCO SANTANDER S.A - APLIC.", par=n('santander_aplic'), recuo=2),
        L("TITULO DE CAPITALIZACAO", par=n('titulo_cap'),
          tot=totals['disponivel'], recuo=2),
        SEP(),
        L("CLIENTES", bold=True, recuo=1),
        L("DUPLICATAS A RECEBER / CLIENTES", par=n('clientes'),
          tot=totals['clientes'], recuo=2),
        L("OUTROS CREDITOS", bold=True, recuo=1),
        L("ADIANTAMENTOS A FORNECEDORES", par=n('adiant_forn_1'), recuo=2),
        L("ALVES & MORAES", par=n('adiant_forn_2'), recuo=2),
        L("ADIANTAMENTO A EMPREGADOS / FERIAS", par=n('adiant_ferias'), recuo=2),
        L("IPI A RECUPERAR", par=n('ipi_rec'), recuo=2),
        L("ICMS A RECUPERAR", par=n('icms_rec'),
          tot=totals['outros_creditos'], recuo=2),
        L("ESTOQUE", bold=True, recuo=1),
        L("MERCADORIAS PARA REVENDA", par=n('merc_revenda'), recuo=2),
        L("PRODUTOS ACABADOS", par=n('prod_acabados'),
          tot=totals['estoque'], recuo=2),
        L("TOTAL ATIVO CIRCULANTE", tot=totals['ativo_circulante'], bold=True),
        SEP(),
        L("ATIVO NAO-CIRCULANTE", bold=True),
        L("EMPRESTIMO DOS SOCIOS", par=n('emp_socios'), recuo=1),
        L("EMPRESTIMOS COMPULSORIOS / A TERCEIROS", par=compulsorios, recuo=1),
        L("INVESTIMENTOS", par=investimentos, recuo=1),
        L("IMOVEIS / INSTALACOES", par=n('instalacoes'), recuo=1),
        L("MOVEIS E UTENSILIOS", par=n('moveis'), recuo=1),
        L("MAQUINAS E EQUIPAMENTOS", par=n('maquinas'), recuo=1),
        L("EQUIPAMENTOS DE TI", par=n('equip_ti'), recuo=1),
        L("VEICULOS", par=n('veiculos'), recuo=1),
        L("(-) DEPRECIACAO ACUMULADA", par=-abs(depreciacao), recuo=1),
        L("TOTAL ATIVO NAO-CIRCULANTE", tot=totals['ativo_nao_circulante'],
          bold=True),
        L("CONTAS DE COMPENSACAO (ATIVO)", par=n('bens_comodato'),
          tot=totals['compensacao_ativo'], recuo=1),
        L("TOTAL ATIVO", tot=totals['ativo_total'], bold=True),
        SEP(),
        L("PASSIVO", bold=True, side="C"),
        L("PASSIVO CIRCULANTE", bold=True, side="C"),
        L("EMPRESTIMOS CP (BANCOS CONTA CORRENTE)", par=bancos_cp,
          recuo=1, side="C"),
        L("FINANCIAMENTOS CP (VARIOS)", par=financiamentos_cp,
          recuo=1, side="C"),
        L("FORNECEDORES", par=n('fornecedores_total'), recuo=1, side="C"),
        L("IMPOSTOS E CONTRIBUICOES A RECOLHER", par=impostos_recolher,
          recuo=1, side="C"),
        L("OBRIGACOES TRABALHISTAS / FOLHA", par=folha_recolher,
          recuo=1, side="C"),
        L("ADIANTAMENTO DE CLIENTES", par=n('adiant_clientes'), recuo=1, side="C"),
        L("SORBELL / OUTROS ADIANTAMENTOS", par=n('sorbell'), recuo=1, side="C"),
        L("PARCELAMENTOS CP", par=n('parc_cp_items'),
          tot=totals['passivo_circulante'], recuo=1, side="C"),
        SEP(),
        L("PASSIVO NAO-CIRCULANTE", bold=True, side="C"),
        L("EMPRESTIMOS DIVERSOS LP", par=n('emp_lp'), recuo=1, side="C"),
        L("PARCELAMENTOS LP", par=n('parc_lp_items'),
          tot=totals['passivo_nao_circulante'], recuo=1, side="C"),
        SEP(),
        L("PATRIMONIO LIQUIDO", bold=True, side="C"),
        L("CAPITAL SOCIAL", par=n('capital_pl'), recuo=1, side="C"),
        L("(-) PREJUIZOS ACUMULADOS ANTERIORES", par=n('prej_acum'), recuo=1),
        L("AJUSTES DE EXERCICIO ANTERIOR", par=n('ajustes_ex_ant'), recuo=1, side="C"),
        L("CONTAS DE COMPENSACAO (PASSIVO)", par=n('bens_comodato'),
          tot=totals['patrimonio_liquido'], recuo=1, side="C"),
        L("TOTAL PASSIVO + PL", tot=totals['passivo_pl_total'], bold=True, side="C"),
        L("VERIFICACAO: ATIVO - PASSIVO + PL",
          tot=totals['diferenca'], bold=True),
    ]

    pdf.gerar(linhas)
    return pdf.salvar()


# ── Demo ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    sys.path.insert(0, '/home/claude')
    from extrator_v2 import extrair_dre

    # Extrai os dados reais
    dados = extrair_dre('/mnt/user-data/uploads/DRE_ANO_2025.pdf')
    dados['empresa']  = dados['meta']['empresa']
    dados['cnpj']     = dados['meta']['cnpj']
    dados['data_ini'] = '01/01/2025'
    dados['data_fim'] = '31/12/2025'
    dados['cidade']   = 'SAO PAULO'
    dados['empresario_nome'] = 'JOAO DA SILVA'
    dados['empresario_cpf']  = '000.000.000-00'
    dados['contador_nome']   = 'MARIA SOUZA'
    dados['contador_crc']    = '1SP000000/O-0'
    dados['contador_cpf']    = '111.111.111-11'

    # Calcula resultado operacional para o documento
    rb = sum(dados.get(k,0) for k in ['venda_produtos','venda_produtos_export',
                                        'venda_mercadorias','venda_mercadorias_export',
                                        'servicos_prestados'])
    ded= sum(dados.get(k,0) for k in ['devolucao','ipi_ded','icms_ded',
                                        'cofins','pis','subst_trib'])
    cus= sum(dados.get(k,0) for k in ['industrializacao','bonificacao','icms_dif_aliq',
                                        'cpv','cmv'])
    desp_op = sum(dados.get(k,0) for k in [
        'salarios','pro_labore','premios','decimo_terceiro','ferias',
        'inss_desp','fgts','indenizacoes','assist_medica','adicionais',
        'alim_pessoal','horas_extras','uniformes','alugueis','embalagens_adm',
        'internet','bens_peq_valor','equip_seguranca','manut_maq','limpeza',
        'associacoes','cartorios','equip_protecao','mat_laboratorio','manut_veiculos',
        'ipva','taxas_diversas','taxas_vig_san','icms_nao_contrib','taxas_iss',
        'energia','agua','telefone','postais','seguros','mat_escritorio',
        'mat_higiene','assist_contabil','serv_terceiros','depreciacao','propaganda',
        'assessoria','mat_consumo','combustiveis','seg_patrim','suporte_tecnico',
        'treinamento','alim_geral','agenciamento','dedetizacao','desp_medica',
        'software','fretes','manut_reparo',
        'juros_passivos','taxas_cambiais','iof','juros_comissoes','juros_emp',
        'multas_mora','tarifa_bancaria',
    ])
    rec_fin = sum(dados.get(k,0) for k in ['juros_aplicacoes','juros_ativos',
                                             'descontos_fin','bonif_amostras'])
    res_op = rb - ded - cus - desp_op + rec_fin
    res_fin = res_op - dados.get('csll',0) - dados.get('irpj',0)

    dados['_resultado_op']    = res_op
    dados['_resultado_final'] = res_fin

    out = gerar_dre_jacom(dados, '/mnt/user-data/outputs/DRE_LAYOUT_JACOM.pdf',
                          gerencial=False)
    print(f"PDF gerado: {out}")
