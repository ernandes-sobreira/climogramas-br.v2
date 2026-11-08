# Preenchimento nacional INMET sem apagar o acervo

Base consultada: `5f59780f7d2daa9b58880379b85a59aa03f3f4fd`.

## Mudança proposta

O planejador lê os anos realmente presentes em `assets/data/*/*.json`. Anos sem nenhum arquivo vêm primeiro, em ordem decrescente; depois vêm anos já presentes mas ainda sem processamento nacional comprovado. A existência de arquivos nunca cria SHA nem marca conclusão. Escopo padrão: 2000 até o ano atual.

Com o acervo atual e 2025 já processado, a ordem de preenchimento é 2022, 2021, 2020, 2019; depois 2024, 2023 e os anos antigos não verificados. Cada execução mantém no máximo dois ZIPs: o ano atual e um pendente. No primeiro dia do mês ou com revisão explicitamente solicitada, revisa apenas atual e anterior. Falhas têm espera de sete dias por ano e não impedem tentar outra lacuna no dia seguinte. Não há promessa de conclusão em quatro dias: cada ZIP depende da origem, duração, validação e fila compartilhada.

## Preservação e limites existentes

O sincronizador ganhou somente retry limitado: duas tentativas totais, pausa de 10 segundos, apenas HTTP 429/502/503/504 ou timeout; 404, ZIP inválido e demais falhas não repetem. Baixa até 320.000.001 bytes e rejeita tamanho acima de 320 MB; timeout de socket 180 s. Workflow limita o job a 180 minutos. Não houve download integral nesta auditoria.

CSV individual acima de 35 MB é ignorado; não há limite global explícito de expansão ZIP nem de memória de linhas agrupadas. Isso merece endurecimento separado antes de ampliar concorrência. O job atual serializa os anos e não deve executar dezenas em paralelo.

Processamento ocorre em diretório temporário. Erros de parsing, desaparecimento de estação antes existente e regressão de cobertura horária acima do limiar preservam os dados anteriores. SHA só é aceito após validação. Revisão válida com SHA diferente pode atualizar valores, preservando procedência do pacote; o repositório mantém versões anteriores. Arquivos legados sem qualidade horária não possuem a mesma proteção quantitativa: não afirmar que toda revisão histórica foi validada. Nenhuma modificação de dados foi feita nesta proposta.

O SHA idêntico evita parsing e escrita, mas não evita o download completo atual. Solicitar Range na auditoria não equivale a validar ZIP inteiro. Acesso pequeno 2019 e 2020 foi confirmado pelo coordenador com HTTP 206 e assinatura PK, não por este script. HEAD 503 não deve ser interpretado como indisponibilidade definitiva.

## Publicação sugerida

Publicar `tools/plan_inmet_years.py`, `tests/test_plan_inmet_years.py`, `tools/sync_inmet.py` e `tests/test_sync_inmet.py`, junto desta documentação se desejado. No workflow, trocar o nome da etapa para “ano atual e um ano nacional pendente (2000 em diante)” e adicionar `ref: main` ao checkout, para jobs enfileirados sob a trava compartilhada lerem checkpoints recentes. Esta proposta não modifica o workflow automaticamente nem dispara coleta.

## Testes

23 testes locais passaram: 11 do planejador, 8 do sincronizador existente e 4 de retry limitado. Cobrem quatro lacunas antes dos arquivos legados, cooldown, retorno aos anos antigos, ausência de falsa conclusão por um único arquivo, limite de dois anos, SHA idêntico, falhas e regressões preservadas. Sem rede nos testes.
