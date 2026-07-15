# editor-pdf

Suite de ferramentas para edição livre de PDFs e geração/projeção de demonstrações gerenciais (DRE, Balanço Patrimonial e Curva ABC de Vendas), a partir de PDFs reais ou de estimativas paramétricas.

O projeto é composto por três serviços independentes que rodam ao mesmo tempo:

| Serviço | Stack | Porta padrão | Pasta |
|---|---|---|---|
| **Frontend** | Next.js (App Router) + TypeScript | `3000` | `frontend/` |
| **Backend do editor de PDF** | Node.js + Express | `3001` | `backend/` |
| **API Gerencial** | Python + FastAPI | `8000` | `gerencial/` (+ módulos na raiz) |

## Visão geral das funcionalidades

### Editor de PDF (`localhost:3000/`)

- Upload de um PDF e extração de todo o texto editável, preservando fonte, tamanho, alinhamento, cor de fundo e sublinhado de cada trecho.
- Edição do conteúdo de qualquer texto extraído diretamente no PDF.
- **Mover e redimensionar** blocos de texto existentes (arrastar/redimensionar com alças).
- **Inserir, mover e redimensionar imagens** (PNG/JPEG) em qualquer posição da página.
- **Selecionar e mover formas vetoriais** (barras/réguas do layout original, ex. linhas acima de blocos de assinatura) que não pertencem a nenhum texto.
- Importar/exportar edições em massa via planilha Excel.
- Download do PDF editado.

### Projeção Gerencial (`localhost:3000/gerencial`)

- **Duas origens de dados** para DRE/Balanço:
  - **PDF existente**: extrai os valores de um PDF real (um único PDF combinado ou DRE + Balanço separados).
  - **Faturamento**: estima um DRE/Balanço completo a partir apenas do faturamento anual informado, usando benchmarks setoriais.
- Ajuste de cenário via parâmetros (meta de lucro líquido, receita bruta alvo, % de deduções, redução de CMV/despesas, provisão de IR/CSL) e overrides manuais de linhas específicas do Balanço.
- Geração do PDF final em três layouts visuais (JACOM, Extrato Gerencial, Relatório Patrimonial).
- **Histórico de projeções**: salvar, listar, carregar e excluir projeções nomeadas (persistência local em SQLite).
- **Curva ABC de Vendas**: gera o relatório de ranking de clientes por faturamento (com % real e % acumulado), em dois modos:
  - **Dados reais**: upload de uma planilha (XLSX ou CSV) com clientes e valores.
  - **Estimativa**: gera uma distribuição plausível de clientes fictícios a partir só do faturamento total, permitindo renomear os clientes estimados antes de gerar o PDF final.
  - Também com histórico salvo/carregável, próprio e independente do de DRE/Balanço.
  - Verificação automática de colisão de colunas (`validar_colisoes`) após cada geração, com aviso não bloqueante na interface.

Detalhes de cálculo do motor de DRE/Balanço estão documentados em [`README_GERENCIAL.md`](README_GERENCIAL.md); o histórico de decisões da Curva ABC está em [`documentos/COMO_INCORPORAR_CURVA_ABC.md`](documentos/COMO_INCORPORAR_CURVA_ABC.md).

## Arquitetura

```text
editor-pdf/
├── backend/                     # API Node/Express do editor de PDF (porta 3001)
│   ├── index.js
│   ├── routes/
│   │   ├── edit.js              # POST /edit — aplica edições de texto, imagens e formas
│   │   └── extract.js           # POST /extract-text — extrai texto + gráficos vetoriais do PDF
│   └── services/
│       ├── pdfExtractor.js      # Replay da operator-list do pdf.js (texto, fundo, sublinhado, formas)
│       └── pdfEditor.js         # Reescreve o PDF com pdf-lib (apagar + redesenhar)
│
├── frontend/                    # Next.js (App Router), serve as duas telas (porta 3000)
│   ├── app/
│   │   ├── page.tsx             # Editor de PDF principal
│   │   └── gerencial/page.tsx   # Tela de projeção gerencial + Curva ABC
│   ├── components/               # PdfViewer, TextEditPanel, UploadZone, Toast, Topbar...
│   └── lib/                       # Clientes de API (api.ts, gerencialApi.ts) e helpers (excel.ts, image.ts, curvaAbc.ts)
│
├── gerencial/                    # API Python/FastAPI (porta 8000)
│   ├── api.py                    # Rotas HTTP (estimativa, extração, projeção, PDF, histórico)
│   ├── estimator.py               # Estimativa de DRE/Balanço a partir só do faturamento
│   ├── projection_engine.py       # Motor de cálculo/projeção de cenário (DRE + Balanço)
│   └── storage.py                 # Persistência local em SQLite (projeções e curvas ABC salvas)
│
├── curva_abc_gerador.py          # Gerador do relatório Curva ABC (ReportLab), estimativa e validação de layout
├── jacom_layout.py                # Renderizadores do DRE/Balanço em ReportLab (layouts JACOM/Moderno/Formal)
├── extrator_gerencial.py          # Extração de DRE/Balanço de PDFs reais (via pdfplumber)
├── requirements.txt                # Dependências Python (gerencial + geradores de PDF)
└── README_GERENCIAL.md            # Detalhes do motor de cálculo e endpoints da API gerencial
```

Os dois backends (`backend/` em Node e `gerencial/` em Python) são **completamente independentes** entre si — cada um serve sua própria API HTTP, e o frontend fala com os dois via `fetch` (`frontend/lib/api.ts` para o editor de PDF, `frontend/lib/gerencialApi.ts` para o módulo gerencial).

## Como rodar localmente

Os três serviços precisam estar rodando ao mesmo tempo, cada um em seu próprio terminal.

### 1. Backend do editor de PDF (Node, porta 3001)

```powershell
cd backend
npm install
npm run dev
```

### 2. API Gerencial (Python, porta 8000)

A partir da **raiz do repositório** (necessário para que `gerencial.api` e os módulos `jacom_layout`/`curva_abc_gerador`/`extrator_gerencial` sejam resolvidos como imports de nível superior):

```powershell
python -m pip install -r requirements.txt
python -m uvicorn gerencial.api:app --host 127.0.0.1 --port 8000
```

O banco SQLite local (`gerencial/data/gerencial.db`) é criado automaticamente na primeira execução.

### 3. Frontend (Next.js, porta 3000)

```powershell
cd frontend
npm install
npm run dev
```

Depois, acesse:

- Editor de PDF: [http://localhost:3000](http://localhost:3000)
- Projeção Gerencial + Curva ABC: [http://localhost:3000/gerencial](http://localhost:3000/gerencial)

## Testando as APIs diretamente

### Editor de PDF (`backend/`)

```powershell
curl -X POST http://localhost:3001/extract-text -H "Content-Type: application/json" -d "{\"pdf\": \"<base64 do PDF>\"}"
```

### API Gerencial (`gerencial/`)

```powershell
curl http://localhost:8000/health
curl -X POST http://localhost:8000/api/gerencial/curva-abc/estimate -H "Content-Type: application/json" -d "{\"faturamento_total\": 500000}"
```

Veja a lista completa de endpoints gerenciais em [`README_GERENCIAL.md`](README_GERENCIAL.md).

## Stack técnica

- **Frontend**: Next.js 16 (App Router), React, TypeScript, Tailwind, `react-pdf` (renderização), `react-rnd` (arrastar/redimensionar), `xlsx` (import/export de planilhas).
- **Backend do editor**: Node.js/Express, `pdfjs-dist` (extração via replay da operator-list), `pdf-lib` (reescrita do PDF).
- **API Gerencial**: Python/FastAPI, `reportlab` (geração de PDF), `pdfplumber`/`pypdf` (extração/merge de PDF), `sqlite3` (stdlib, persistência local sem ORM).
