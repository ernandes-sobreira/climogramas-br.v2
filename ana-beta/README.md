# ANA Brasil / Climogramas BR

Módulo separado do INMET, para consultar o inventário oficial brasileiro por UF e séries de chuva, cota e vazão por estação. O cadastro nacional não garante dados em todos os períodos ou variáveis.

## Fonte pública ativa

- `https://telemetriaws1.ana.gov.br/ServiceANA.asmx/HidroInventario`
- `https://telemetriaws1.ana.gov.br/ServiceANA.asmx/HidroSerieHistorica`

GET oficial, XML e CORS, sem credenciais. É serviço legado/base secundária: pode apresentar defasagem, falhas ou descontinuidade. Não promete tempo real nem atualização automática persistente. As consultas são sob demanda. Temperatura e processamento INMET permanecem intactos.

Inventário: 27 UFs, carregamento por UF/tipo, cache em memória de 30 minutos, inclui estações inativas para pesquisa histórica. Código livre permite consulta sem depender do inventário. Variável/UF alterada limpa seleção antiga. Limite local de resposta de inventário:30MB.

Séries: janelas anuais, máximo60anos por consulta. Tipos1=cota,2=chuva,3=vazão; unidadescm,mm,m³/s. O retorno pode incluir dois níveis de consistência mesmo quando solicitado apenas um. O parser filtra o nível escolhido antes de deduplicar e nunca recorre automaticamente ao bruto.

## Qualidade

- Somente status diário1(real) usado em estatística e cobertura.
- Valores vazios/sentinelas não viram zero; zero legítimo é mantido.
- Dias inválidos e valores conflitantes são excluídos.
- Ranking/tendências apenas para anos anteriores com365/366dias válidos; anos parciais permanecem visíveis, identificados.
- Última observação real, cobertura e exclusões apresentados na interface.
- Falha de consulta preserva gráfico/tabela anteriores; não substitui dados por vazio.

## Evidências de validação em07/11/2026

XMLs oficiais: chuva1657003, cota/vazão66070004 emjan2000;31dias porvariável. Chuva176.7mm; cota284cm e vazão468.591m³/s no1ºdia. Outro exemplo brasileiro: chuva771001 noAcre,31dias e139.2mm. InventáriosAcre152(tipos1/2),SãoPaulo3458pluviométricas,MinasGerais2464pluviométricas, incluindo inativas. Esses testes não afirmam disponibilidade nacional de séries atuais.

2026Cáceres demonstra limitação: chuva/vazão apenasjan–jun brutos na consulta testada, cota semregistros. Dados consistidos ausentes não equivalem a zero nem ausência de bruto.

## API autenticada

Opção desativada na interface. Código antigo/proxy experimental não representa serviço funcional em produção. Nenhum segredo deve ser colocado no GitHubPages. Testes autenticados falharam sem token; integração pública não depende deles.
