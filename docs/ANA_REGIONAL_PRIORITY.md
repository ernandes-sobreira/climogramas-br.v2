# Prioridade Cáceres e Pantanal

Direção expressa do usuário: priorizar região de Cáceres e Pantanal sem abandonar Brasil. A fila não exclui estações nem muda os dados científicos.

1. Coordenadas oficiais de estação a até150km de (-16.076,-57.681), distância Haversine: prioridade regional1.
2. Municípios MT/MS do AnexoVII FCO2025 (14MT+9MS): prioridade regional2. Trata-se de TRIAGEM MUNICIPAL, não point-in-polygon de bioma; municípios podem incluir áreas externas ao Pantanal. Não apresentar todas essas estações como situadas dentro do bioma.
3. Demais estações: nacional. Coordenadas ausentes/inválidas usam apenas município reconhecido/UF correta; sem informação suficiente ficam nacionais, não são excluídas.

Há quatro slots regionais para cada nacional. Nos regionais, três slots do raio para um municipal, se ambas filas tiverem candidatos. Não havendo candidatos em um grupo, toda capacidade pode ser usada pelos outros. No loop efetivo, cada quinta requisição reserva nacional, quando disponível, mesmo que respostas compartilhadas de dois níveis eliminem tarefas sem nova consulta. Sem modificar orçamento total ou paralelismo.

Ordem relativa de atualização mensal/descoberta/revisão permanece dentro de cada grupo. Retry_after e cooldown herdado de janelas subdivididas são aplicados antes da prioridade. Os splits persistidos recebem a prioridade recalculada do catálogo atual.

Contagem nos catálogos lidos: MT1.393estações/MS778; raio121estações, triagem municipal adicional351(165MT+186MS), total472.25UFs/29.554estações geram93.628tarefas:396raio,1.186municipal,92.046nacional. Fila semcheckpoint: primeiros100slots60raio/20municipal/20nacional. Estado real apósjobemcurso pode alterar tarefas elegíveis e chamadas efetivas; isso não mede cobertura completa nem rapidez garantida.

Fonte consultada: https://goias.gov.br/retomada/wp-content/uploads/sites/22/files/cartas-e-documentos/programacao-fco/2025/Programa%C3%A7%C3%A3o%20FCO%202025%20-%204%C2%AA%20Edi%C3%A7%C3%A3o.pdf , AnexoVII. O coordenador confirmou visualmente lista equivalente no FCO2024p121SEMADESC, fonteIBGE/Embrapa.

Validação: python -m unittest discover -s tests/priority -v.11testes cobrem raio, município, inválidos, falta de candidatos, quota, skips por níveis compartilhados, cooldown e atualização mensal.

Correção de catálogo: nomes truncados da ANA só aceitos se prefixo normalizado possui pelo menos15caracteres e identifica exatamenteUM município da whitelist da mesmaUF. Reason `screening_truncated_name`; raio é verificado antes. Alias explícito SANTO ANTONIO DE→DO.37estaçõesMT e9MS adicionais entraram por prefixo; nenhum nome curto/ambíguo é inferido. Testes incluem ambiguidade e prioridade de coordenadas.
