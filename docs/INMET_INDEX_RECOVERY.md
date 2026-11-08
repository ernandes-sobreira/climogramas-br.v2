# Recuperação dos índices INMET 2023/2024

Base auditada: 91ea9816882c2e2542ba9e85bfca49a19ea4f69e. Foram conferidos os hashes Git de todos os 1.095 arquivos anuais de 2023/2024. Nenhum arquivo de medições foi alterado.

O catálogo tinha 702 estações e ocultava 1.093 pares estação/ano existentes em 553 delas. B807 tinha mais dois arquivos fora do catálogo. Seus metadados foram recuperados do catálogo público da primeira versão (`ernandes-sobreira/climogramas-br`): Porto Alegre–Belém Novo, RS. O índice agora tem 703 estações e permite acessar os 1.095 pares recuperados. Todos os metadados das 702 estações anteriores foram preservados.

O catálogo global volta a incluir 2023 e 2024. Não foram inventados arquivos para A941: seus anos existentes continuam 2012–2018. Os anos 2019–2022 não constavam no acervo auditado e continuam dependendo da carga nacional.

Todos os packs possuem schema compatível. Há 230 packs com meses parciais e 280 com indicador anual de cobertura inferior a 90%. A interface avisa que resumos legados não têm auditoria mensal por variável; valores antigos não foram recalculados nem apresentados como novos dados completos. Ausências continuam nulas, não zero.

A fonte dos ZIPs anuais é INMET, rede automática: https://portal.inmet.gov.br/uploads/dadoshistoricos/{ano}.zip. Isso não equivale ao catálogo ANA de chuva/cota/vazão, nem a uma exportação BDMEP de estações convencionais. O e-mail de uma extração BDMEP não comprova que ela originou esses arquivos.

A rotina INMET existente permanece: checagem diária do ano atual e um ano pendente por execução, com preservação de dados em falhas. Não foi alterada nem disparada por este reparo de índices. A disponibilidade da fonte e a execução efetiva do GitHub continuam necessárias.
