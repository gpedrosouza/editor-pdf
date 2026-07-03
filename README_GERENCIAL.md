# Fluxo Gerencial JACOM

## Servidores

Instale as dependencias Python:

```powershell
python -m pip install -r requirements.txt
```

Suba a API gerencial:

```powershell
python -m uvicorn gerencial.api:app --host 127.0.0.1 --port 8000
```

Suba o frontend:

```powershell
cd frontend
npm run dev
```

A interface fica em:

```text
http://localhost:3000/gerencial
```

## Endpoints

- `GET /api/gerencial/estimator/sectors`: lista setores disponiveis na planilha estimadora.
- `POST /api/gerencial/estimate`: recebe faturamento, setor e dados basicos da empresa, e gera DRE/Balanco estimados.
- `POST /api/gerencial/extract`: recebe `pdf` combinado ou `dre_pdf` + `balanco_pdf`.
- `POST /api/gerencial/project`: recebe `{ dre, balanco, params }` e retorna o cenario calculado.
- `POST /api/gerencial/pdf`: recebe `{ dre, balanco, params, tipo }`, com `tipo` = `dre`, `balanco` ou `completo`.

## Observacao De Calculo

O motor usa os valores extraidos como magnitudes positivas e aplica sinais na apuracao:
deducoes, custos, despesas e provisoes reduzem o resultado; receitas financeiras aumentam.

Quando `Meta lucro liquido` for maior que zero, ela vira uma restricao ativa:
o sistema calcula as reducoes necessarias de CMV e despesas para fazer o
resultado do exercicio bater `Meta % x RB alvo`. Se a meta ficar em zero, o
motor usa diretamente as reducoes informadas nos campos.

No Balanco, a conta sintetica `emp_compulsorios` e ignorada quando as analiticas
`gran_belle` e `solution_vet` existem, para seguir a mesma regra da planilha.

## Estimativa Sem DRE/Balanco

Quando nao houver DRE ou Balanco existente, use a origem `Faturamento` na tela.
O sistema le `ESTIMADOR_DRE_BALANCO.xlsx`, usa os percentuais ajustados da coluna D
e multiplica cada linha pelo faturamento informado.

Para industria, quando nao houver historico real, o sistema tambem aplica:

- IR/CSL padrao: 24% sobre o resultado antes do IR/CSL.
- Receitas financeiras minimas: 0,16% do faturamento, distribuidas entre juros
  de aplicacoes, juros ativos, descontos financeiros e bonificacoes/amostras.

Na planilha atual existe benchmark para `Industria`. Para alterar os percentuais,
edite a coluna D da planilha e reinicie a API.
