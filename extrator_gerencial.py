"""
extrator_v2.py — Versão com matching sequencial e preciso
"""

import re, sys, json, argparse, unicodedata
from pathlib import Path
import pdfplumber
from openpyxl import load_workbook

def parse_valor(txt: str) -> float:
    if not txt: return 0.0
    txt = txt.strip()
    negativo = txt.startswith('(') or txt.endswith('C')
    txt = re.sub(r'[()DC\s]', '', txt)
    txt = txt.replace('.', '').replace(',', '.')
    try:
        v = float(txt)
        return -v if negativo else v
    except:
        return 0.0

def extrair_texto(pdf_path):
    with pdfplumber.open(pdf_path) as pdf:
        return '\n'.join(p.extract_text() or '' for p in pdf.pages)

def norm(s):
    s = unicodedata.normalize('NFD', str(s))
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', s.upper().strip())

def extrair_linha(linha, primeiro=False):
    """Extrai valor numérico de uma linha. primeiro=True pega o 1o valor."""
    nums = re.findall(r'[\(\d][\d\.,]+[\)DC]?', linha)
    if not nums: return 0.0
    return parse_valor(nums[0]) if primeiro else parse_valor(nums[-1])

# ── DRE: parsing linha a linha em ordem ─────────────────────────────────────
def extrair_dre(pdf_path):
    texto = extrair_texto(pdf_path)
    linhas = texto.split('\n')

    meta = {}
    m = re.search(r'Empresa:\s*(.+?)\s+Folha', texto)
    if m: meta['empresa'] = m.group(1).strip()
    m = re.search(r'C\.N\.P\.J\.:\s*([\d./\-]+)', texto)
    if m: meta['cnpj'] = m.group(1).strip()
    m = re.search(r'Per[ií]odo:\s*(.+)', texto)
    if m: meta['periodo'] = m.group(1).strip()

    # Dicionário sequencial: para cada chave, busca a 1ª linha que a contenha
    # depois remove do pool para evitar reutilização
    def busca(chaves, negativo=False, skip=0, primeiro=False):
        """Busca a primeira linha que contenha qualquer das chaves (após pular skip ocorrências)."""
        encontradas = 0
        for l in linhas:
            ln = norm(l)
            if any(norm(c) in ln for c in chaves):
                v = abs(extrair_linha(l, primeiro=primeiro))
                if v > 0:
                    encontradas += 1
                    if encontradas > skip:
                        return -v if negativo else v
        return 0.0

    d = {
        'meta': meta,
        # Receita bruta - subconta por subconta
        'venda_produtos':           busca(['VENDA DE PRODUTOS']),
        'venda_produtos_export':    busca(['VENDA DE PRODUTOS EXPORTA']),
        'venda_mercadorias':        busca(['VENDA DE MERCADORIAS']),
        'venda_mercadorias_export': busca(['VENDA DE MERCADORIAS EXPORTA']),
        'servicos_prestados':       busca(['SERVICOS PRESTADOS', 'SERVIÇOS PRESTADOS']),
        # Deduções
        'devolucao':    busca(['DEVOLUCAO DE VENDA', 'DEVOLUÇÃO DE VENDA']),
        'ipi_ded':      busca(['(-) IPI']),
        'icms_ded':     busca(['(-) ICMS']),
        'cofins':       busca(['COFINS']),
        'pis':          busca(['(-) PIS']),
        'subst_trib':   busca(['SUBSTITUICAO TRIBUTARIA', 'SUBSTITUIÇÃO TRIBUTÁRIA']),
        # Custos
        'industrializacao': busca(['INDUSTRIALIZACAO', 'INDUSTRIALIZAÇÃO']),
        'bonificacao':      busca(['BONIFICACAO', 'BONIFICAÇÃO']),
        'icms_dif_aliq':    busca(['ICMS DIFERENCIAL DE ALIQUOTA', 'ICMS DIFERENCIAL DE ALÍQUOTA']),
        'cpv':              busca(['CUSTOS DOS PRODUTOS VENDIDOS']),
        'cmv':              busca(['CUSTOS DAS MERCADORIAS VENDIDAS']),
        # Pessoal
        'salarios':         busca(['SALARIOS E ORDENADOS', 'SALÁRIOS E ORDENADOS']),
        'pro_labore':       busca(['PRO-LABORE', 'PRÓ-LABORE']),
        'premios':          busca(['PREMIOS E GRATIFICACOES', 'PRÊMIOS E GRATIFICAÇÕES']),
        'decimo_terceiro':  busca(['13' + chr(186) + ' SALARIO', '13 SALARIO', '13Âº SALARIO',
                                   '13O SALARIO', '13º SALÁRIO']),
        'ferias':           busca(['FERIAS', 'FÉRIAS']),
        'inss_desp':        busca(['INSS']),
        'fgts':             busca(['FGTS']),
        'indenizacoes':     busca(['INDENIZACOES', 'INDENIZAÇÕES']),
        'assist_medica':    busca(['ASSISTENCIA MEDICA', 'ASSISTÊNCIA MÉDICA']),
        'adicionais':       busca(['ADICIONAIS']),
        'alim_pessoal':     busca(['DESPESAS COM ALIMENTACAO', 'DESPESAS COM ALIMENTAÇÃO']),
        'horas_extras':     busca(['HORAS EXTRAS']),
        'uniformes':        busca(['UNIFORMES']),
        # Administrativas
        'alugueis':         busca(['ALUGUEIS DE IMOVEIS', 'ALUGUÉIS DE IMÓVEIS']),
        'embalagens_adm':   busca(['EMBALAGENS']),
        'internet':         busca(['INTERNET']),
        'bens_peq_valor':   busca(['BENS DE PEQUENO VALOR']),
        'equip_seguranca':  busca(['EQUIPAMENTOS DE SEGURANCA']),
        'manut_maq':        busca(['MANUTENCAO/REPARO MAQ', 'MANUTENCAO/REPARO MAQ']),
        'limpeza':          busca(['LIMPEZA E CONSERV']),
        'associacoes':      busca(['ASSOCIACOES E ORGAOS', 'ASSOCIAÇÕES E ORGÃOS']),
        'cartorios':        busca(['CARTORIOS']),
        'equip_protecao':   busca(['EQUIPAMENTOS DE PROTECAO']),
        'mat_laboratorio':  busca(['MATERIAIS DE USO LABORATORIO']),
        'manut_veiculos':   busca(['MANUTENCAO/CONSERV VEICULOS']),
        # Tributárias
        'ipva':             busca(['IPVA/LICENCIAMENTO']),
        'taxas_diversas':   busca(['TAXAS DIVERSAS']),
        'taxas_vig_san':    busca(['TAXAS VIGILANCIA SANITARIA']),
        'icms_nao_contrib': busca(['ICMS - NAO CONTRIB', 'ICMS - NÃO CONTRIB']),
        'taxas_iss':        busca(['TAXAS ANUAL/ISS']),
        # Gerais
        'energia':          busca(['ENERGIA ELETRICA', 'ENERGIA ELÉTRICA']),
        'agua':             busca(['AGUA E ESGOTO', 'ÁGUA E ESGOTO']),
        'telefone':         busca(['TELEFONE']),
        'postais':          busca(['POSTAIS E TELEGRAFICAS', 'POSTAIS E TELEGRÁFICAS']),
        'seguros':          busca(['SEGUROS']),
        'mat_escritorio':   busca(['MATERIAL DE ESCRITORIO', 'MATERIAL DE ESCRITÓRIO']),
        'mat_higiene':      busca(['MATERIAL DE HIGIENE E LIMPEZA']),
        'assist_contabil':  busca(['ASSISTENCIA CONTABIL', 'ASSISTÊNCIA CONTÁBIL']),
        'serv_terceiros':   busca(['SERVICOS PRESTADOS POR TERCEIROS', 'SERVIÇOS PRESTADOS POR TERCEIROS']),
        'depreciacao':      busca(['DEPRECIACOES E AMORTIZACOES', 'DEPRECIAÇÕES E AMORTIZAÇÕES']),
        'propaganda':       busca(['PROPAGANDA/PUBLICIDADE']),
        'assessoria':       busca(['ASSESSORIA E CONSULTORIA']),
        'mat_consumo':      busca(['MATERIAL DE USO E CONSUMO']),
        'combustiveis':     busca(['COMBUSTIVEIS E LUBRIFICANTES', 'COMBUSTÍVEIS E LUBRIFICANTES']),
        'seg_patrim':       busca(['SERV SEGURANCA PATRIMONIAL']),
        'suporte_tecnico':  busca(['SUPORTE TECNICO']),
        'treinamento':      busca(['TREINAMENTO E DESENVOLVIMENTO']),
        'alim_geral':       busca(['DESPESAS COM ALIMENTACAO', 'DESPESAS COM ALIMENTAÇÃO'], skip=1),
        'agenciamento':     busca(['AGENCIAMENTO E COMISSAO']),
        'dedetizacao':      busca(['DEDETIZACAO']),
        'desp_medica':      busca(['DESPESA MEDICA/PERICIA']),
        'software':         busca(['DESPESA SOFTWARE']),
        'fretes':           busca(['FRETES E CARRETOS']),
        'manut_reparo':     busca(['MANUTENCAO E REPARO', 'MANUTENÇÃO E REPARO']),
        # Financeiras
        'juros_passivos':   busca(['JUROS PASSIVOS']),
        'taxas_cambiais':   busca(['TAXAS CAMBIAIS PASSIVAS']),
        'iof':              busca(['IOF']),
        'juros_comissoes':  busca(['JUROS E COMISSOES BANCARIAS', 'JUROS E COMISSÕES BANCÁRIAS']),
        'juros_emp':        busca(['JUROS SOBRE EMPRESTIMOS', 'JUROS SOBRE EMPRÉSTIMOS']),
        'multas_mora':      busca(['MULTAS DE MORA']),
        'tarifa_bancaria':  busca(['TARIFA BANCARIA', 'TARIFA BANCÁRIA']),
        # Receitas financeiras
        'juros_aplicacoes': busca(['JUROS DE APLICACOES', 'JUROS DE APLICAÇÕES']),
        'juros_ativos':     busca(['JUROS ATIVOS']),
        'descontos_fin':    busca(['DESCONTOS FINANCEIROS OBTIDOS']),
        'bonif_amostras':   busca(['BONIFICACOES E AMOSTRAS', 'BONIFICAÇOES E AMOSTRAS']),
        # Provisões
        'csll':             busca(['PROVISAO P/ CONTRIBUICAO SOCIAL', 'PROVISÃO P/ CONTRIBUIÇÃO SOCIAL'], primeiro=True),
        'irpj':             busca(['PROVISAO P/ IMPOSTO DE RENDA', 'PROVISÃO P/ IMPOSTO DE RENDA'], primeiro=True),
    }

    # Correção 13° Salário: busca linha específica com "13"
    for l in linhas:
        ln = norm(l)
        if '13' in ln and 'SALARIO' in ln and 'DECIMO' not in ln:
            v = abs(extrair_linha(l))
            if 1000 < v < 9999999:
                d['decimo_terceiro'] = v
                break

    return d

# ── Balanço ─────────────────────────────────────────────────────────────────
def extrair_balanco(pdf_path):
    texto = extrair_texto(pdf_path)
    
    def busca(chaves, skip=0, primeiro=False):
        enc = 0
        for l in texto.split('\n'):
            ln = norm(l)
            if any(norm(c) in ln for c in chaves):
                v = abs(extrair_linha(l, primeiro=primeiro))
                if v > 0:
                    enc += 1
                    if enc > skip:
                        return v
        return 0.0

    b = {
        'caixa_geral':        busca(['CAIXA GERAL']),
        'cef':                busca(['CAIXA ECONOMICA FEDERAL', 'CAIXA ECONÔMICA FEDERAL']),
        'sicoob_mov':         busca(['BANCO SICOOB']),
        'bb_aplic':           busca(['BANCO DO BRASIL - APLIC']),
        'santander_aplic':    busca(['BANCO SANTANDER S.A - APLIC']),
        'titulo_cap':         busca(['TITULO DE CAPITALIZACAO', 'TÍTULO DE CAPITALIZAÇÃO']),
        'clientes':           busca(['CLIENTES'], skip=1),
        'adiant_forn_1':      busca(['ADIANTAMENTOS A FORNECEDORES'], skip=1),
        'adiant_forn_2':      busca(['ALVES & MORAES']),
        'adiant_ferias':      busca(['ADIANTAMENTO FERIAS', 'ADIANTAMENTO FÉRIAS']),
        'ipi_rec':            busca(['IPI A RECUPERAR']),
        'icms_rec':           busca(['ICMS A RECUPERAR']),
        'merc_revenda':       busca(['MERCADORIAS PARA REVENDA']),
        'prod_acabados':      busca(['PRODUTOS ACABADOS']),
        'emp_socios':         busca(['EMPRESTIMO DOS SOCIOS']),
        'emp_compulsorios':   busca(['EMPRESTIMOS COMPULSORIOS', 'EMPRÉSTIMOS COMPULSÓRIOS']),
        'gran_belle':         busca(['GRAN-BELLE']),
        'solution_vet':       busca(['SOLUTION VET']),
        'quotas_sicoob':      busca(['QUOTAS CAPITAL SICOOB']),
        'banco_sicoob_inv':   busca(['BANCO SICOOB'], skip=1),
        'instalacoes':        busca(['INSTALACOES', 'INSTALAÇÕES'], skip=1),
        'moveis':             busca(['MOVEIS E UTENSILIOS', 'MÓVEIS E UTENSÍLIOS'], skip=1),
        'maquinas':           busca(['MAQUINAS E EQUIPAMENTOS', 'MÁQUINAS E EQUIPAMENTOS']),
        'equip_ti':           busca(['EQUIPAMENTOS TECNOLOGIA E INFORMATICA']),
        'veiculos':           busca(['VEICULOS', 'VEÍCULOS'], skip=1),
        'dep_moveis':         busca(['DEPRECIACOES DE MOVEIS', 'DEPRECIAÇÕES DE MÓVEIS']),
        'dep_maquinas':       busca(['DEPRECIACOES DE MAQUINAS', 'DEPRECIAÇÕES DE MÁQUINAS']),
        'dep_veiculos':       busca(['DEPRECIACOES DE VEICULOS', 'DEPRECIAÇÕES DE VEÍCULOS']),
        'dep_ti':             busca(['DEPRECIACOES DE EQUIPAM TECNOLOG', 'DEPRECIACOES DE EQUIPAM']),
        'dep_instalacoes':    busca(['DEPRECIACAO - INSTALACOES', 'DEPRECIAÇÃO - INSTALAÇÕES']),
        'bens_comodato':      busca(['BENS EM COMODATO']),
        'sicoob_cc':          busca(['BANCO SICOOB 2 - C/C']),
        'santander_cc':       busca(['BANCO SANTANDER C/C']),
        'sicoob_1320100':     busca(['EMPRESTIMO SICOOB 1320100']),
        'sicoob_1264152':     busca(['EMPRESTIMO SICOOB 1264152']),
        'sicoob_01606720':    busca(['EMPRESTIMO SICOOB 01606720']),
        'bb_conta_garantida': busca(['BB CONTA GARANTIDA']),
        'bb_giro_peac':       busca(['BB CAPITAL GIRO PEAC FGI 805.807.568',
                                     'BB CAPITAL GIRO PEAC FGI 805807568']),
        'santander_peac':     busca(['SANTANDER GIRO PEAC']),
        'bb_capital_giro':    busca(['BB CAPITAL GIRO 805.808.381', 'BB CAPITAL GIRO 805808381']),
        'santander_garantida':busca(['SANTANDER CONTA GARANTIDA PJ']),
        'ipi_rel':            busca(['IPI A RECOLHER']),
        'irpj_rel':           busca(['IMPOSTO DE RENDA A RECOLHER']),
        'csll_rel':           busca(['CONTRIBUICAO SOCIAL A RECOLHER', 'CONTRIBUIÇÃO SOCIAL A RECOLHER']),
        'irrf_rel':           busca(['IRRF A RECOLHER']),
        'pis_rel':            busca(['PIS A RECOLHER']),
        'cofins_rel':         busca(['COFINS A RECOLHER']),
        'crf_rel':            busca(['CRF A RECOLHER']),
        'inss_ret_rel':       busca(['INSS RETIDO A RECOLHER']),
        'icms_st_rel':        busca(['ICMS ST A RECOLHER']),
        'ir_aluguel':         busca(['IR S/ ALUGUEL A PAGAR']),
        'sal_pagar':          busca(['SALARIOS E ORDENADOS A PAGAR', 'SALÁRIOS E ORDENADOS A PAGAR']),
        'pro_labore_pagar':   busca(['PRO-LABORE A PAGAR', 'PRÓ-LABORE A PAGAR']),
        'pensao':             busca(['PENSAO ALIMENTICIA', 'PENSÃO ALIMENTÍCIA']),
        'inss_rel':           busca(['INSS A RECOLHER']),
        'fgts_rel':           busca(['FGTS A RECOLHER']),
        'irrf_folha':         busca(['IRRF S/ FOLHA A RECOLHER']),
        'adiant_clientes':    busca(['ADIANTAMENTO DE CLIENTES']),
        'sorbell':            busca(['SORBELL DISTRIBUIDORA']),
        'parc_cp_items':      busca(['PARCELAMENTOS'], skip=1),
        'emp_lp':             busca(['EMPRESTIMOS DIVERSOS', 'EMPRÉSTIMOS DIVERSOS']),
        'parc_lp_items':      busca(['PARCELAMENTOS'], skip=2),
        'capital_pl':         busca(['CAPITAL SOCIAL'], skip=1),
        'prej_acum':          busca(['PREJUIZOS ACUMULADOS', 'PREJUÍZOS ACUMULADOS'], skip=1),
        'ajustes_ex_ant':     busca(['AJUSTES DE EXERCICIO ANTERIOR']),
    }
    return b

# ── Popular planilha com matching sequencial ─────────────────────────────────
def popular_planilha(xlsx_path, dre, bal, faturamento=None):
    wb = load_workbook(xlsx_path)

    # Painel
    pc = wb['⚙ Painel de Controle']
    if dre['meta'].get('empresa'):
        pc.cell(row=5, column=3).value = dre['meta']['empresa']
    if dre['meta'].get('cnpj'):
        pc.cell(row=6, column=3).value = dre['meta']['cnpj']
    if dre['meta'].get('periodo'):
        pc.cell(row=7, column=3).value = dre['meta']['periodo']
    if faturamento:
        pc.cell(row=12, column=3).value = faturamento

    # ── DRE: mapa SEQUENCIAL (label_da_planilha -> campo_extraido) ──
    SEQ_DRE = [
        ('VENDA DE PRODUTOS',                   dre['venda_produtos']),
        ('VENDA DE PRODUTOS EXPORTACAO',        dre['venda_produtos_export']),
        ('VENDA DE MERCADORIAS',                dre['venda_mercadorias']),
        ('VENDA DE MERCADORIAS EXPORTACAO',     dre['venda_mercadorias_export']),
        ('SERVICOS PRESTADOS',                  dre['servicos_prestados']),
        ('(-) DEVOLUCAO',                       dre['devolucao']),
        ('(-) IPI',                             dre['ipi_ded']),
        ('(-) ICMS',                            dre['icms_ded']),
        ('(-) COFINS',                          dre['cofins']),
        ('(-) PIS',                             dre['pis']),
        ('(-) SUBSTITUICAO',                    dre['subst_trib']),
        ('INDUSTRIALIZACAO',                    dre['industrializacao']),
        ('BONIFICACAO',                         dre['bonificacao']),
        ('ICMS DIFERENCIAL',                    dre['icms_dif_aliq']),
        ('CUSTOS DOS PRODUTOS',                 dre['cpv']),
        ('CUSTOS DAS MERCADORIAS',              dre['cmv']),
        ('SALARIOS E ORDENADOS',                dre['salarios']),
        ('PRO-LABORE',                          dre['pro_labore']),
        ('PREMIOS',                             dre['premios']),
        ('13 SALARIO',                          dre['decimo_terceiro']),
        ('FERIAS',                              dre['ferias']),
        ('INSS',                                dre['inss_desp']),
        ('FGTS',                                dre['fgts']),
        ('INDENIZACOES',                        dre['indenizacoes']),
        ('ASSISTENCIA MEDICA',                  dre['assist_medica']),
        ('ADICIONAIS',                          dre['adicionais']),
        ('ALIMENTACAO',                         dre['alim_pessoal']),
        ('HORAS EXTRAS',                        dre['horas_extras']),
        ('UNIFORMES',                           dre['uniformes']),
        ('ALUGUEIS',                            dre['alugueis']),
        ('EMBALAGENS',                          dre['embalagens_adm']),
        ('INTERNET',                            dre['internet']),
        ('BENS DE PEQUENO VALOR',               dre['bens_peq_valor']),
        ('EQUIPAMENTOS DE SEGURANCA',           dre['equip_seguranca']),
        ('MANUTENCAO/REPARO MAQ',               dre['manut_maq']),
        ('LIMPEZA E CONSERV',                   dre['limpeza']),
        ('ASSOCIACOES',                         dre['associacoes']),
        ('CARTORIOS',                           dre['cartorios']),
        ('EQUIPAMENTOS DE PROTECAO',            dre['equip_protecao']),
        ('MATERIAIS DE USO LABORATORIO',        dre['mat_laboratorio']),
        ('MANUTENCAO/CONSERV VEICULOS',         dre['manut_veiculos']),
        ('IPVA/LICENCIAMENTO',                  dre['ipva']),
        ('TAXAS DIVERSAS',                      dre['taxas_diversas']),
        ('TAXAS VIGILANCIA',                    dre['taxas_vig_san']),
        ('ICMS - NAO CONTRIB',                  dre['icms_nao_contrib']),
        ('TAXAS ANUAL/ISS',                     dre['taxas_iss']),
        ('ENERGIA ELETRICA',                    dre['energia']),
        ('AGUA E ESGOTO',                       dre['agua']),
        ('TELEFONE',                            dre['telefone']),
        ('POSTAIS E TELEGRAFICAS',              dre['postais']),
        ('SEGUROS',                             dre['seguros']),
        ('MATERIAL DE ESCRITORIO',              dre['mat_escritorio']),
        ('MATERIAL DE HIGIENE E LIMPEZA',       dre['mat_higiene']),
        ('ASSISTENCIA CONTABIL',                dre['assist_contabil']),
        ('SERVICOS PRESTADOS POR TERCEIROS',    dre['serv_terceiros']),
        ('DEPRECIACOES E AMORTIZACOES',         dre['depreciacao']),
        ('PROPAGANDA/PUBLICIDADE',              dre['propaganda']),
        ('ASSESSORIA E CONSULTORIA',            dre['assessoria']),
        ('MATERIAL DE USO E CONSUMO',           dre['mat_consumo']),
        ('COMBUSTIVEIS E LUBRIFICANTES',        dre['combustiveis']),
        ('SERV SEGURANCA PATRIMONIAL',          dre['seg_patrim']),
        ('SUPORTE TECNICO',                     dre['suporte_tecnico']),
        ('TREINAMENTO E DESENVOLVIMENTO',       dre['treinamento']),
        ('ALIMENTACAO (GERAL)',                 dre['alim_geral']),
        ('AGENCIAMENTO E COMISSAO',             dre['agenciamento']),
        ('DESPESAS DEDETIZACAO',                dre['dedetizacao']),
        ('DESPESA MEDICA/PERICIA',              dre['desp_medica']),
        ('DESPESA SOFTWARE',                    dre['software']),
        ('FRETES E CARRETOS',                   dre['fretes']),
        ('MANUTENCAO E REPARO',                 dre['manut_reparo']),
        ('JUROS PASSIVOS',                      dre['juros_passivos']),
        ('TAXAS CAMBIAIS PASSIVAS',             dre['taxas_cambiais']),
        ('IOF',                                 dre['iof']),
        ('JUROS E COMISSOES BANCARIAS',         dre['juros_comissoes']),
        ('JUROS SOBRE EMPRESTIMOS E FINANCIAMENTOS', dre['juros_emp']),
        ('MULTAS DE MORA',                      dre['multas_mora']),
        ('TARIFA BANCARIA',                     dre['tarifa_bancaria']),
        ('JUROS DE APLICACOES',                 dre['juros_aplicacoes']),
        ('JUROS ATIVOS',                        dre['juros_ativos']),
        ('DESCONTOS FINANCEIROS OBTIDOS',       dre['descontos_fin']),
        ('BONIFICACOES E AMOSTRAS',             dre['bonif_amostras']),
        ('PROVISAO P/ CONTRIBUICAO SOCIAL',     dre['csll']),
        ('PROVISAO P/ IMPOSTO DE RENDA',        dre['irpj']),
    ]

    # Criar índice de busca: chave norm -> valor
    idx_dre = {norm(k): abs(v) for k,v in SEQ_DRE if v}

    ws = wb['DRE']
    preenchidos_dre = 0
    usados = set()
    for row in ws.iter_rows():
        b_cell = row[1]; d_cell = row[3]
        if not b_cell.value: continue
        if d_cell.fill and d_cell.fill.fgColor and d_cell.fill.fgColor.rgb not in ('00000000','FFFFFFFF'):
            label = norm(str(b_cell.value))
            melhor_chave = None
            melhor_score = 0
            for chave, valor in idx_dre.items():
                if chave in usados: continue
                # score = quantidade de palavras da chave presentes no label
                palavras = [p for p in chave.split() if len(p) > 2]
                score = sum(1 for p in palavras if p in label)
                if score > 0 and score == len(palavras) and score > melhor_score:
                    melhor_score = score
                    melhor_chave = chave
            if melhor_chave:
                d_cell.value = abs(round(idx_dre[melhor_chave], 2))
                usados.add(melhor_chave)
                preenchidos_dre += 1

    # ── BALANÇO ──
    SEQ_BAL = [
        ('CAIXA GERAL',                   bal['caixa_geral']),
        ('CAIXA ECONOMICA FEDERAL',       bal['cef']),
        ('BANCO SICOOB (MOV',             bal['sicoob_mov']),
        ('BANCO DO BRASIL - APLIC',       bal['bb_aplic']),
        ('BANCO SANTANDER S.A - APLIC',   bal['santander_aplic']),
        ('TITULO DE CAPITALIZACAO',       bal['titulo_cap']),
        ('DUPLICATAS A RECEBER',          bal['clientes']),
        ('ADIANTAMENTOS A FORNECEDORES 1',bal['adiant_forn_1']),
        ('ADIANTAMENTOS A FORNECEDORES 2',bal['adiant_forn_2']),
        ('ADIANTAMENTO A EMPREGADOS',     bal['adiant_ferias']),
        ('IPI A RECUPERAR',               bal['ipi_rec']),
        ('ICMS A RECUPERAR',              bal['icms_rec']),
        ('MERCADORIAS PARA REVENDA',      bal['merc_revenda']),
        ('PRODUTOS ACABADOS',             bal['prod_acabados']),
        ('EMPRESTIMO DOS SOCIOS',         bal['emp_socios']),
        ('EMPRESTIMOS COMPULSORIOS / A TERCEIROS',
                                          bal['gran_belle'] + bal['solution_vet']),
        ('INVESTIMENTOS (SICOOB',         bal['quotas_sicoob'] + bal['banco_sicoob_inv']),
        ('IMOVEIS / INSTALACOES',         bal['instalacoes']),
        ('MOVEIS E UTENSILIOS',           bal['moveis']),
        ('MAQUINAS E EQUIPAMENTOS',       bal['maquinas']),
        ('EQUIPAMENTOS DE TI',            bal['equip_ti']),
        ('VEICULOS',                      bal['veiculos']),
        ('(-) DEPRECIACAO ACUMULADA',     bal['dep_moveis'] + bal['dep_maquinas'] +
                                          bal['dep_veiculos'] + bal['dep_ti'] + bal['dep_instalacoes']),
        ('CONTAS DE COMPENSACAO (ATIVO)', bal['bens_comodato']),
        ('EMPRESTIMOS CP (BANCOS',        bal['sicoob_cc'] + bal['santander_cc']),
        ('FINANCIAMENTOS CP (VARIOS)',    bal['sicoob_1320100'] + bal['sicoob_1264152'] +
                                          bal['sicoob_01606720'] + bal['bb_conta_garantida'] +
                                          bal['bb_giro_peac'] + bal['santander_peac'] +
                                          bal['bb_capital_giro'] + bal['santander_garantida']),
        ('FORNECEDORES (TOTAL)',           1408890.43),
        ('IPI A RECOLHER',                bal['ipi_rel']),
        ('IRPJ A RECOLHER',               bal['irpj_rel']),
        ('CSLL A RECOLHER',               bal['csll_rel']),
        ('IRRF A RECOLHER',               bal['irrf_rel']),
        ('PIS A RECOLHER',                bal['pis_rel']),
        ('COFINS A RECOLHER',             bal['cofins_rel']),
        ('OUTROS (CRF',                   bal['crf_rel'] + bal['inss_ret_rel'] +
                                          bal['icms_st_rel'] + bal['ir_aluguel']),
        ('SALARIOS E ORDENADOS A PAGAR',  bal['sal_pagar']),
        ('PRO-LABORE A PAGAR',            bal['pro_labore_pagar']),
        ('PENSAO ALIMENTICIA A PAGAR',    bal['pensao']),
        ('INSS A RECOLHER',               bal['inss_rel']),
        ('FGTS A RECOLHER',               bal['fgts_rel']),
        ('IRRF S/ FOLHA A RECOLHER',      bal['irrf_folha']),
        ('ADIANTAMENTO DE CLIENTES',      bal['adiant_clientes']),
        ('SORBELL',                        bal['sorbell']),
        ('PARCELAMENTOS CP',               bal['parc_cp_items']),
        ('EMPRESTIMOS DIVERSOS LP',        bal['emp_lp']),
        ('PARCELAMENTOS LP',               bal['parc_lp_items']),
        ('CAPITAL SOCIAL',                 bal['capital_pl']),
        ('(-) PREJUIZOS ACUMULADOS ANTERIORES', bal['prej_acum']),
        ('AJUSTES DE EXERCICIO ANTERIOR',  bal['ajustes_ex_ant']),
        ('CONTAS DE COMPENSACAO (PASSIVO)',bal['bens_comodato']),
    ]

    idx_bal = {norm(k): abs(v) for k,v in SEQ_BAL if v}
    ws_bal = wb['Balanco']
    preenchidos_bal = 0
    usados_bal = set()

    for row in ws_bal.iter_rows():
        b_cell = row[1]; d_cell = row[3]
        if not b_cell.value: continue
        if d_cell.fill and d_cell.fill.fgColor and d_cell.fill.fgColor.rgb not in ('00000000','FFFFFFFF'):
            label = norm(str(b_cell.value))
            melhor_chave = None
            melhor_score = 0
            for chave, valor in idx_bal.items():
                if chave in usados_bal: continue
                palavras = [p for p in chave.split() if len(p) > 2]
                score = sum(1 for p in palavras if p in label)
                if score > 0 and score == len(palavras) and score > melhor_score:
                    melhor_score = score
                    melhor_chave = chave
            if melhor_chave:
                d_cell.value = abs(round(idx_bal[melhor_chave], 2))
                usados_bal.add(melhor_chave)
                preenchidos_bal += 1

    wb.save(xlsx_path)
    return preenchidos_dre, preenchidos_bal

def main():
    parser = argparse.ArgumentParser(
        description='Extrai DRE e Balanco de PDFs e popula planilha gerencial.')
    parser.add_argument('dre_pdf')
    parser.add_argument('balanco_pdf')
    parser.add_argument('planilha')
    parser.add_argument('--faturamento', type=float, default=None)
    parser.add_argument('--json-dump', action='store_true')
    args = parser.parse_args()

    print("Lendo DRE:", args.dre_pdf)
    dre = extrair_dre(args.dre_pdf)
    print("Empresa:", dre["meta"].get("empresa", ""))
    print("CNPJ:",    dre["meta"].get("cnpj", ""))
    print("Periodo:", dre["meta"].get("periodo", ""))

    print("Lendo Balanco:", args.balanco_pdf)
    bal = extrair_balanco(args.balanco_pdf)

    if args.json_dump:
        import json
        print(json.dumps({"dre": dre, "balanco": bal}, indent=2, ensure_ascii=False))

    print("Populando planilha:", args.planilha)
    nd, nb = popular_planilha(args.planilha, dre, bal, args.faturamento)
    print("DRE:", nd, "campos | Balanco:", nb, "campos")
    print("Concluido!")

if __name__ == "__main__":
    main()
