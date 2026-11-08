# Resumos ANA compactos sem serviço novo

Transporte: `assets/ana/compact/{variable}/{station}/nivel{consistency}.json.gz`, gzip determinístico. Schema2 `month_rows` contém `[yyyymm,sum,valid_days,last_day]`, sem arredondamento. `annual_values` preserva valores anuais originais para evitar pequenas diferenças IEEE754 ao reagrupar somas entre Python e JavaScript. Meses sem dados são omitidos e recompostos como nulos, nunca zeros. Consulta só usa resumo quando checked_ranges cobre todo intervalo. Fonte, unidade, consistência e cobertura permanecem separados. JSONs antigos são preservados como fallback.

Amostra real:39 resumos,2.302 meses úteis (29 chuva,7 cotas,3 vazão),2017–2026.466.636bytes JSON viraram35.034bytes gzip compacto:92,49% menores. Testes Python e JavaScript confirmam valores mensais e anuais iguais. Isso não garante taxa de compressão em séries centenárias.

Capacidade: árvore pública atual tinha37.340.344bytes de arquivos; o1,64GiB informado pelo repositório incluía histórico Git. Limite oficial Pages:1GB de site,100GB/mês de banda suave. Projeção aproximada do catálogo25UF29554 estações:20,15milhões slots mensais; aplicação da taxa amostral sugere centenas de MiB de resumos, não prova de cabimento. Coletores param antes de350MiB de summaries+compact e750MiB de assets totais. Nenhuma cobrança/serviço novo foi ativado. Git continua crescendo com versões: resposta cientificamente idêntica preserva gzip, apenas checkpoint de verificação muda.

Coleta: janelas60anos com metadados e subdivisão10anos após timeout/tamanho na execução seguinte. Início desconhecido gera sondagem recente2anos sinalizada, não busca cega1850. Aproveita níveis adicionais somente quando realmente retornados. Catálogo atual638.774 tarefas vira93.628 antes de falhas/splits/revisões: a100/dia ainda não é carga nacional rápida. Não declarar completo. Orçamento100 requisições/25min e driver diário mantidos; dados recentes elegíveis mensalmente. Arquivo bruto diário nacional não é armazenado por este formato: CSV do site continua sendo resumo mensal/anual.

Fontes de limites: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits . Alternativa pesquisada não ativada: Cloudflare R2 oferece10GB-mês Standard grátis,1M gravações/10M leituras, mas há cobrança excedente e ativação de serviço; não tratado como custo zero garantido: https://developers.cloudflare.com/r2/pricing/ .

Testes: `python -m unittest discover -s tests/monthly -v`; `python -m unittest discover -s tests/compressed -v`; `node tests/frontend/test-compact.cjs`.
