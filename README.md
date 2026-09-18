# Dashboard — publicação no Render

O dashboard original está em `index.html`, preservado integralmente.

## Primeira publicação

1. Crie um repositório privado no GitHub e envie o conteúdo desta pasta, com `render.yaml` na raiz.
2. No Render, conecte sua conta do GitHub e escolha **New > Blueprint**.
3. Selecione o repositório e a branch que receberá as atualizações, revise e publique.
4. Guarde a URL `onrender.com` fornecida pelo serviço. Ela continua a mesma nas próximas publicações.

Alternativa: crie um **Static Site**, com build command `mkdir -p dist && cp index.html dist/index.html`, publish directory `dist` e Auto-Deploy configurado para cada commit.

## Atualizações de código e layout

Edite `index.html` e envie a alteração à branch conectada. O Render publicará a nova versão automaticamente. Salvar no OneDrive não envia mudanças ao GitHub. Não é necessário criar outro serviço ou mudar o link.

Depois da publicação, recarregue a página para carregar a nova versão. O cabeçalho Cache-Control solicita revalidação no servidor; páginas já abertas não se atualizam sozinhas.

## Páginas Empresa 360°

Cada empresa pode ser aberta em uma URL própria formada pelo domínio e pelo CNPJ sem pontuação, por exemplo `/99999991000199`. A regra de rewrite em `render.yaml` mantém esses links acessíveis ao abrir, compartilhar ou recarregar a página diretamente.

Na Base de Dados, o menu **Escolher colunas** permite ocultar ou mostrar os campos da tabela. A preferência fica salva no navegador do usuário.

A coluna **Officer** permite atribuir cada empresa a um dos officers cadastrados. Ao selecionar um nome, a empresa também é marcada automaticamente como Cliente BTG. O filtro Officer aceita um ou mais nomes para mostrar somente as respectivas carteiras, e a exportação de clientes inclui o officer responsável.

## Decisores

A coluna **Decisores** consulta, somente quando o usuário clica, o QSA público da Receita Federal pela BrasilAPI. O painel lateral mostra os sócios e administradores reais e cria links de busca no Google com `site:linkedin.com`; o dashboard não acessa nem automatiza o LinkedIn.

O resultado fica salvo no navegador e também na memória do serviço Node. Um segundo clique no mesmo CNPJ usa o cache local e não repete a chamada à BrasilAPI. Falhas de rede não são armazenadas, permitindo tentar novamente. A rota do serviço é `/api/socios/{cnpj}` e o módulo independente está em `socios.mjs`.

## LinkedIn da empresa

Ao abrir o painel de Decisores, o dashboard consulta automaticamente a API oficial do Lusha (`POST /v3/companies/search-and-enrich`, do plano já contratado) para encontrar a página do LinkedIn da própria empresa — não dos sócios individuais. A chave fica somente no serviço Node (`LUSHA_API_KEY`, nunca no HTML) e a consulta tenta primeiro o domínio do site (quando disponível) e depois o nome da empresa normalizado (sem "S.A.", "LTDA" e afins). O dashboard não acessa nem automatiza o LinkedIn diretamente; ele só chama a API do Lusha, exatamente como o usuário faria manualmente no dashboard deles.

Se a chave não estiver configurada no Render, ou a empresa não for encontrada, o painel cai para uma busca no Google escopada a `site:linkedin.com/company` — o mesmo padrão de fallback já usado para os sócios.

O resultado fica em cache no navegador por CNPJ (`btg_company_linkedin_cache_v1`) e no serviço Node em memória, para não repetir — e não cobrar de novo — a mesma consulta ao Lusha. A rota do serviço é `/api/linkedin/{cnpj}?nome=...` e o módulo independente está em `lusha.mjs`. Para habilitar, crie uma chave de API em https://dashboard.lusha.com (Configurações > API) e preencha `LUSHA_API_KEY` como segredo no serviço `mapa-empresas-assistente` no Render.

## Radar de notícias

O workflow `update-news.yml` roda de hora em hora e também pode ser executado manualmente na aba **Actions** do GitHub. Ele lê as fontes configuradas em `scripts/feeds.json`, mantém título, link, veículo, região, data e classificação setorial, e atualiza `public/news.json` quando as manchetes mudam. O Render publica esse arquivo como `dist/news.json` no mesmo endereço do dashboard.

Na visão nacional, o radar mostra notícias gerais e setoriais. Quando somente um estado é selecionado, as notícias dos portais daquele estado aparecem primeiro e as nacionais completam a rotação. O catálogo regional inclui veículos de SP, RJ, ES, DF, GO, MT, MS, SC, PR e dos demais estados já cobertos. Fontes sem manchetes empresariais recentes permanecem cadastradas e voltam a aparecer automaticamente quando publicarem conteúdo aderente à curadoria.

O seletor **Setor** filtra as manchetes por atividade econômica. Sem uma seleção geográfica, ele pesquisa notícias classificadas naquele setor em toda a base coletada. Quando um ou mais estados também estão selecionados, a combinação é estrita e mostra somente notícias do setor nos estados escolhidos, sem completar a lista com matérias de outra localidade ou atividade. Se não houver resultado na atualização atual, o radar informa a ausência em vez de misturar temas.

Para validar o parser e o fluxo completo com feeds falsos, execute `npm test`. Para uma coleta real sem alterar o arquivo, execute `npm run news:dry`.

## Assistente comercial com IA

O botão **Assistente comercial** abre uma conversa sobre a base de empresas. O usuário pode informar uma cidade, um raio em quilômetros, tamanho, setor, situação de cliente e Officer. A busca calcula a distância em linha reta a partir das coordenadas da base e permite aplicar o recorte resultante ao mapa e à tabela.

Exemplos:

- `Vou para Carlos Barbosa. Mostre empresas Corporate em um raio de 50 km.`
- `Agora deixe somente indústrias sem Officer.`
- `Aumente o raio para 100 km e mostre as 20 mais próximas.`

O navegador nunca envia a base completa ao provedor de IA. A pesquisa, as distâncias e os totais são calculados no próprio dashboard. Para uma análise generativa, o serviço recebe a pergunta, os filtros, totais agregados e no máximo as 10 empresas candidatas já exibidas; ele não recebe os 102 mil registros.

O Blueprint cria um segundo serviço chamado `mapa-empresas-assistente`. Para usar a cota gratuita do Gemini, crie uma chave de autorização no Google AI Studio e preencha `GEMINI_API_KEY` como segredo no Render. O modelo pode ser alterado pela variável `GEMINI_MODEL`; o padrão é `gemini-3.5-flash-lite`. `AI_PROVIDER=auto` prioriza Gemini e ainda aceita OpenAI quando somente `OPENAI_API_KEY` estiver configurada. Se nenhuma IA estiver configurada, houver limite de cota ou indisponibilidade, o dashboard mantém a interpretação e as análises locais.

Para testar o serviço localmente, defina `GEMINI_API_KEY` no ambiente e execute `npm run assistant:start`. A rota de saúde é `/health` e informa o provedor ativo; a rota usada pelo dashboard é `/api/chat`. No nível gratuito do Gemini, o conteúdo enviado pode ser usado pelo Google para melhorar produtos, conforme a página oficial de preços.

## Dados e marcações

O HTML contém os dados do dashboard: visitantes do site público poderão acessá-los. O repositório privado não restringe o site publicado.

As marcações de Cliente BTG e as atribuições de Officer usam localStorage: ficam no navegador de cada pessoa e não são sincronizadas entre usuários. As marcações do arquivo local não migram automaticamente para o endereço hospedado. Atualizar código no mesmo endereço preserva o armazenamento local, desde que a lógica e a chave sejam mantidas.

## Referências

- https://render.com/docs/static-sites
- https://render.com/docs/blueprint-spec
- https://ai.google.dev/gemini-api/docs/api-key
- https://ai.google.dev/gemini-api/docs/pricing
