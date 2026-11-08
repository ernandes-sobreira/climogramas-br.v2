# ANA: acervo por etapas e resumos mensais

`tools/sync_ana_monthly.py` reutiliza exclusivamente o parser seguro de `tools/sync_ana.py`, sem alterar o coletor existente. Catálogos existentes são lidos, não modificados. Estações inativas entram. Não usa senha nem serviços pagos novos.

Saída: `assets/ana/summaries/{chuva|cotas|vazao}/{station}/nivel{1|2}.json`. Fonte, unidades e nível ficam separados. `checked_ranges` usa datas ISO inclusivas, representando períodos consultados, NÃO existência de medições. O consumidor só usa resumo se todo intervalo solicitado está coberto. `months` tem o contrato ANAMain, mais soma, último dia e cobertura; `years` usa média ponderada por dias para cotas/vazão e soma para chuva. Meses parciais não entram em climatologia. `lastDate` é observação, `collected_utc` é coleta.

Carga inicial: tarefas de até dez anos/variável/nível, distribuídas entre UFs e com checkpoints por consulta. Meses confirmados sem dados têm `valor=null`, nunca zero. Respostas com redução de dias válidos preservam o resumo anterior e registram `retained_after_regression` e `stale=true` para revisão humana (o alerta é conservador e permanece até auditoria). Erros preservam arquivo anterior; retry mínimo24h. Todos os JSONs são escritos atomicamente. Saídas antigas de dados diários não são modificadas.

O driver executa diariamente, limitado a100 consultas/25min por execução. Durante o bootstrap ele avança automaticamente no histórico; após isso, só consulta tarefas elegíveis para atualização mensal recente ou revisão histórica anual. A fila reserva rodadas para atualização recente, descoberta e revisão antiga, evitando que a carga inicial bloqueie atualizações. O primeiro run NÃO conclui o Brasil. O status mantém `national_series_complete=false`. Anos recentes são revistos mensalmente; histórico mais antigo entra em revisão anual gradual. Catálogos faltantes permanecem faltantes e não são considerados cobertos.

Limites:150MiB de resumos, resposta8MiB/60s, no máximo100 consultas por execução, sem paralelismo sobre ANA. Ao atingir limite preserva acervo e informa status. Não armazena XML bruto, logo este produto não substitui arquivo de dados diários para exportações diárias/auditoria de cada medição; o arquivo diário atual permanece separado. Nenhuma estimativa de prazo ou completude nacional deve ser baseada apenas no sucesso do workflow.

Teste: `python -m unittest discover -s tests/monthly -v`.
