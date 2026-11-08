# Histórico HidroWeb complementar

Esta camada acrescenta apenas meses históricos de chuva da estação 1657000, em níveis separados. O arquivo oficial foi baixado pela interface HidroWeb; a coleta automática do portal NÃO foi implementada.

Baseline API da reconciliação: `3faf1b321f8fc6a2306d221d3627fa4765066e84`. ZIP SHA256: `9f00c580092f23af4853aac10438e2c2e5ee1c3310a421fd6120c1bbe8b89a3f`.

Acréscimo sobre esse baseline: 516 meses/15.441 registros diários válidos brutos e 517 meses/15.457 registros consistidos. Os níveis são contados separadamente, não são datas físicas únicas. Nenhuma estação nova é criada. A estação 1657003 foi validada, mas não é publicada nesta camada porque não acrescenta dados.

A API continua prioritária, inclusive para meses consultados sem dados. A camada importada não altera arquivos da API, não estende `checked_ranges`, não transforma lacunas em zeros e não presume continuidade entre as datas mínima e máxima. A consulta local só é atendida quando todos os meses solicitados estão comprovados por cobertura da API ou por meses explícitos do arquivo; caso contrário, mantém o caminho normal de consulta à API.

A interface identifica o histórico importado. Data de download e timestamps ZIP não comprovam atualidade das observações. A rotina existente de coleta API continua independente; o download ZIP não ganhou agendamento.

Validação: 43.224 registros da estação 1657000 comparados integralmente com XML oficial, sem diferenças por data, nível, valor ou status. O lote real de duas estações foi comparado com o importador em 64.471 registros, sem diferenças. Não se afirma comparação integral da API para 1657003. Importação e reconciliação possuem 30 testes offline de integridade, segurança e precedência; frontend tem testes próprios.
