# Atualização persistente do Climogramas BR

## Rotinas

- INMET: diariamente às 07:25 de Mato Grosso (11:25 UTC). Ano atual; revisão do anterior no primeiro dia do mês. Um ZIP idêntico não é reprocessado. Regressão de cobertura fica em quarentena, preservando o resultado anterior.
- ANA convencional: a cada 3 horas, minuto 17 UTC. Bootstrap dos 27 catálogos estaduais, limitado a 30 minutos. Depois até três UFs por execução e até 100 consultas de séries, com rotação persistente por UF, estação, variável, ano e consistência.
- ANA telemétrica: camada separada, até 20 estações por execução e 300 segundos. Catálogo nacional próprio; nível e vazão somente. Não soma chuva telemétrica nem substitui a climatologia convencional.

Esses limites não equivalem à atualização diária de todas as estações brasileiras. A descoberta nacional inicial tem mínimo teórico aproximado de32dias com o catálogo atual, maior quando intercala atualização de séries úteis; não representa atualização diária nacional. os arquivos de status mostram a fila, progresso, erros e estimativa mínima de execuções. GitHub pode atrasar tarefas agendadas. Não há contratação de serviço pago nem credencial ANA no site.

## Dados e qualidade

Snapshots ficam em `assets/ana/`; verificação INMET em `assets/inmet-update-status.json`. O site prefere snapshots e consulta a fonte pública quando não há snapshot. Verifica mudanças publicadas a cada cinco minutos enquanto aberto. Uma consulta bem-sucedida não garante medições recentes: a data da medição é exibida separadamente.

ANA convencional mantém consistências separadas, aceita apenas dias com status observado, preserva zero, exclui sentinelas e conflitos e não preenche lacunas. Falhas não apagam séries anteriores. Limite compartilhado de cache ANA: 350 MiB; telemetria: 150 MiB. Ao atingir o teto, expansão é bloqueada e atualizações de arquivos existentes que cabem continuam, com estado explícito. Pequenos metadados podem exceder o teto; não é quota física rígida.

Telemetria preserva o horário original da fonte, cujo fuso universal não foi comprovado. Valores são preliminares, sem controle de qualidade próprio; nível não é profundidade. Catálogo ativo não garante leitura disponível. Códigos convencionais e telemétricos não são associados por proximidade.

## Publicação e falhas

Workflows compartilham uma fila exclusiva, gravam apenas dados autorizados e solicitam explicitamente um build do GitHub Pages com o token nativo da execução. O script verifica o SHA publicado. Falha de publicação torna a execução vermelha, mesmo se o snapshot foi salvo no Git. Falha de uma camada ANA não impede salvar resultados válidos da outra.

Fontes oficiais públicas: `https://telemetriaws1.ana.gov.br/ServiceANA.asmx` e arquivos anuais INMET. O serviço legado ANA é secundário e pode apresentar defasagem ou indisponibilidade; não representa garantia de continuidade.

Testes offline: `python -m unittest discover -s tests/ana`, `python -m unittest discover -s tests/recent`, `python -m unittest discover -s tests -p test_sync_inmet.py`, `node tests/recent/test_ana_recent.cjs`.

## Correção de uso e prioridade

Histórico interativo aceita intervalos amplos divididos por ano, mostra progresso e permite cancelar. Não substitui postos homônimos. A fila automática prioriza séries úteis; descobertas consultam primeiro ano atual, preservando níveis separados, com backoff para vazios/erros. INMET consulta ano atual e no máximo um ano nacional pendente2019–2025 por execução. Datas inexistentes não são criadas.
