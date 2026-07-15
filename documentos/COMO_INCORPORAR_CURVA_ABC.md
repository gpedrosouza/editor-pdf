# Como incorporar o gerador de Curva ABC ao `editor-pdf`

## 1. Contexto (o que já existe no projeto)

No chat "Recálculo de balanço e DRE com faturamento de 9 milhões" (mesmo
projeto), já foram construídos e exportados para a pasta
`C:\Users\Guilherme\Desktop\GO Dev\editor-pdf`:

| Arquivo | Função |
|---|---|
| `extrator_gerencial.py` | Lê PDFs JACOM (DRE/Balanço) via `pdfplumber`, extrai ~80+49 campos |
| `jacom_layout.py` | Gera DRE em PDF no layout JACOM reconstruído (ReportLab) |
| `jacom_balanco.py` | Gera Balanço Patrimonial no mesmo layout |
| `FERRAMENTA_PROJECAO_GERENCIAL.xlsx` | Planilha com 305 fórmulas para o cenário |

Além disso, o `editor-pdf` já tem uma tela com duas origens de dados
(confirmado pelos prints que você mandou):

- **Aba "PDF existente"** — parte de um PDF real (DRE/Balanço), extrai
  valores, e gera o documento gerencial ajustado.
- **Aba "Faturamento"** — sem PDF de origem: você digita setor,
  faturamento anual, razão social, CNPJ, período, e um conjunto de
  parâmetros (meta de lucro líquido, RB alvo, % deduções, % redução
  CMV, % redução despesas, % IR/CSL) e o sistema **estima** o DRE e o
  Balanço do zero.

Este chat adiciona um módulo do mesmo tipo para o relatório Curva ABC
de Vendas — mas, seguindo sua instrução, **sem qualquer etapa de OCR**.
O OCR só foi necessário nesta conversa porque o PDF de origem era
escaneado e não havia alternativa; não é parte do desenho do recurso.

## 2. Arquitetura: dois modos, espelhando a tela existente

### Modo "Dados reais" (equivalente a "PDF existente")

Você já tem os valores por cliente — seja de uma planilha/CSV que você
exporta do seu sistema de vendas, seja de uma lista já digitada. Chama
direto:

```python
from curva_abc_gerador import gerar_curva_abc, validar_colisoes

clientes = [
    {"cnpj_cpf": "12345678000199", "nome": "CLIENTE X", "valor": 1500.00},
    {"cnpj_cpf": "98765432000188", "nome": "CLIENTE Y", "valor": 980.50},
    # ...
]

gerar_curva_abc(
    clientes=clientes,
    periodo_ini="01/06/2026",
    periodo_fim="30/06/2026",
    empresa="01-EMPRESA",
    output_path="CURVA_ABC_06_2026.pdf",
    versao_gerencial=True,
)
```

Não há extração nem OCR nesse caminho — os dados chegam prontos
(de um CSV exportado, de uma planilha, de onde você já tiver a lista de
clientes/valores) e o módulo só formata e calcula % real / % acumulado.

### Modo "Estimativa" (equivalente a "Faturamento")

Você não tem uma lista de clientes real — só o faturamento total (o
mesmo campo que já existe na aba "Faturamento" da sua tela). O módulo
gera uma **distribuição estimada e plausível** de clientes fictícios
que soma exatamente o faturamento informado, seguindo uma curva de
concentração (poucos clientes grandes, muitos pequenos) calibrada a
partir do padrão observado na Curva ABC real da empresa exemplo (cliente
nº1 ~46% do total, top 5 ~85% do total):

```python
from curva_abc_gerador import estimar_curva_abc, gerar_curva_abc

clientes_estimados = estimar_curva_abc(
    faturamento_total=7340200.21,   # mesmo campo "Faturamento anual" da tela
    numero_clientes=106,              # opcional, ajustável
    concentracao=1.6,                 # opcional: 1.3-1.4 mais pulverizado, 1.8+ mais concentrado
)

gerar_curva_abc(
    clientes=clientes_estimados,
    periodo_ini="01/01/2025",
    periodo_fim="31/12/2025",
    empresa="ESTIMATIVA - INDUSTRIA",
    output_path="CURVA_ABC_ESTIMADA.pdf",
    versao_gerencial=True,
)
```

**Importante**: no modo estimativa, os nomes de cliente saem como
"CLIENTE 001 (ESTIMADO)" etc. e os CNPJs são placeholders — isso é
proposital, para deixar claro que não são dados reais de clientes.
Se quiser, ajuste a UI para permitir que o usuário edite os nomes
depois de gerada a lista, antes de produzir o PDF final.

## 3. O que muda de metodologia em relação aos módulos anteriores

Os módulos `jacom_layout.py`/`jacom_balanco.py` foram calibrados "de
olho". Neste módulo novo, depois de algumas rodadas de ajuste manual
que ainda geravam colisão de colunas, mudamos de método:

1. **Medição de coordenadas reais**: usamos OCR com bounding boxes
   (só para *ler o layout do documento de referência*, não para
   extrair dados de clientes) — descobrimos exatamente em que
   pixel/mm cada coluna do relatório original começa e termina.
2. **Calibração de fonte por largura real**: medimos a largura real de
   texto (`stringWidth()` do ReportLab) em vez de assumir uma largura
   padrão para "Courier 8pt".
3. **Validação programática pós-geração**: `validar_colisoes()` abre o
   PDF gerado, extrai a posição de cada palavra e verifica se há menos
   de 0.5mm de espaço entre palavras adjacentes — pega qualquer
   sobreposição de coluna automaticamente.

Essa metodologia (itens 2 e 3, que não dependem de OCR de dados) vale a
pena aplicar de volta aos módulos `jacom_layout.py` e `jacom_balanco.py`
caso ainda tenham imprecisões de espaçamento.

## 4. Arquivos deste handoff

- `curva_abc_gerador.py` — módulo com `gerar_curva_abc()` (dados reais)
  e `estimar_curva_abc()` (modo estimativa), mais `validar_colisoes()`.
- `TESTE_MODO_DADOS_REAIS.pdf` — teste com os 106 clientes reais da
  empresa exemplo (deve reproduzir o PDF final já aprovado nesta conversa).
- `TESTE_MODO_ESTIMATIVA.pdf` — teste com os parâmetros dos seus
  prints (faturamento R$ 7.340.200,21, setor Indústria).

## 5. Passo a passo de incorporação

### Opção A — Você mesmo, direto no Python

1. Copie `curva_abc_gerador.py` para dentro da pasta `editor-pdf`.
2. Na aba "Faturamento" existente, adicione um botão "Gerar Curva ABC
   estimada" que chama `estimar_curva_abc()` com o mesmo campo de
   faturamento anual já preenchido, seguido de `gerar_curva_abc()`.
3. Na aba "PDF existente" (ou uma nova aba "Dados reais"), adicione um
   campo de upload de CSV/planilha com clientes e valores, que vira
   direto a lista `clientes` para `gerar_curva_abc()`.
4. Sempre rode `validar_colisoes()` no PDF gerado antes de entregá-lo.

### Opção B — Levar ao Claude Code

Prompt sugerido:

> Tenho um módulo Python (`curva_abc_gerador.py`, anexado) com duas
> funções: `gerar_curva_abc()` (recebe uma lista de clientes/valores já
> prontos e gera o PDF no layout JACOM/Industrial) e
> `estimar_curva_abc()` (recebe apenas um faturamento total e gera uma
> distribuição de clientes estimada, plausível, sem OCR nem extração de
> PDF). Também tem `validar_colisoes()`, que confirma programaticamente
> que não há sobreposição de colunas no PDF gerado.
>
> Preciso integrar isso à tela existente do editor-pdf, que já tem duas
> abas de origem para DRE/Balanço: "PDF existente" e "Faturamento".
> Quero replicar exatamente essa mesma dualidade para a Curva ABC de
> Vendas:
>
> - Na aba "Faturamento": ao lado do campo "Faturamento anual" já
>   existente, adicionar uma opção "Gerar Curva ABC estimada" que chama
>   `estimar_curva_abc(faturamento_total=<valor do campo>)` e em seguida
>   `gerar_curva_abc()`.
> - Numa aba nova (ou reaproveitando "PDF existente" se fizer sentido
>   para import de CSV/planilha de clientes): permitir que o usuário
>   informe uma lista real de clientes e valores (upload de CSV, ou
>   colar dados), que alimenta `gerar_curva_abc()` diretamente — **sem
>   nenhuma etapa de OCR ou extração automática de PDF**, pois os dados
>   já vêm estruturados.
> - Rodar `validar_colisoes()` automaticamente após gerar qualquer PDF,
>   e mostrar um aviso na interface se houver colisão.
>
> Note que, ao contrário do fluxo de DRE/Balanço (que precisa ler PDFs
> escaneados via OCR quando não há alternativa), a Curva ABC não deve
> ter nenhuma dependência de OCR — os dados de clientes sempre chegam
> como lista estruturada, seja real (CSV) ou estimada (função de
> distribuição).

