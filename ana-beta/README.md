# ANA / HidroWeb beta — Climogramas BR

Este módulo foi criado isoladamente para não alterar o funcionamento atual do `index.html` (INMET).

## Arquitetura

```
GitHub Pages (ana-beta/)
        |
        v
proxy serverless seguro
        |
        v
API HidroWebService / ANA
```

O navegador **não** recebe CPF/CNPJ, senha nem token da ANA.

## O que já existe

- inventário de estações por UF;
- busca por código, nome, município, rio e bacia;
- séries de chuva, cota e vazão;
- paginação automática da API em blocos de até 366 dias;
- estatística descritiva anual;
- ano mais seco / mais chuvoso para precipitação;
- mínimos, máximos, média, desvio-padrão e CV;
- Mann-Kendall;
- inclinação de Sen (também por década);
- regressão linear descritiva e R²;
- exportação CSV.

## Proxy

O exemplo em `worker/ana-proxy.js` segue o manual oficial da ANA:

- autenticação em `/OAUth/v1`;
- headers `Identificador` e `Senha`;
- token enviado como `Authorization: Bearer ...`;
- renovação local antes de 60 minutos;
- inventário em `HidroInventarioEstacoes/v1`;
- séries `HidroSerieChuva/v1`, `HidroSerieCotas/v1` e `HidroSerieVazao/v1`;
- consultas históricas divididas em janelas de no máximo 366 dias.

Configure os secrets no ambiente do proxy:

- `ANA_IDENTIFICADOR`
- `ANA_SENHA`

Nunca grave esses valores no repositório.

## Contrato usado pelo front-end

- `GET /health`
- `GET /inventory?uf=MT`
- `GET /series?type=chuva&station=XXXXX&start=YYYY-MM-DD&end=YYYY-MM-DD`

O campo de consistência aparece na interface beta para evolução posterior. O endpoint novo de séries convencionais utilizado aqui segue a parametrização atual documentada pela ANA e não envia um parâmetro separado de consistência.

## Validação antes de integrar ao site principal

1. publicar o proxy;
2. configurar os dois secrets;
3. abrir `ana-beta/`;
4. informar a URL do proxy;
5. testar uma estação conhecida em período curto;
6. comparar valores com o HidroWeb;
7. só depois adicionar a entrada ANA ao menu principal.

