# Parse XML uma vez por resposta

Alteração mínima: `tools/sync_ana.py` extrai `parse_series_rows(records,station,kind,year)` puro; wrapper `parse_series(xml,...)` continua compatível e conserva validação XML (`rows`). O pipeline mensal chama `rows(xml,'SerieHistorica')` uma vez e reaproveita lista para os anos. Não muda requisições, fila, cooldown, armazenamento, origem ou regras científicas.

Testes comfixtures existentes no repositório:chuva1657003/cota66070004/vazão66070004. Equivalência completa com snapshot do parser anterior. Sintéticos cobrem conflito, níveis, status, bissexto, inválidos, zero verdadeiro, sentinelas, XMLinseguro e parsingúnico dentrodo pipeline.

Benchmark sintético local60anos/720meses/21.915dias, XML1.284.949bytes: antes2,079s, depois0,078s (~26,6x no processamento desta amostra). Não é benchmark de rede nem promessa de acelerar APIANA26x. Resultados exatamenteiguais. Repetição de parsing cai60→1; seleção por ano permanece simples.

54testes:6parseonce+11parser/collectororiginais+14mensais+12codec+11prioridade. Nenhuma chamadaANA ou publicação. Arquivos em diretório separado; não sobrescreve jobregionalemcurso.
