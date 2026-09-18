# Pacote completo — Radar Nacional de Prospecção

Este pacote contém uma cópia completa e executável do dashboard em 17/09/2026. Ele pode ser compartilhado com uma equipe técnica para criar outro painel semelhante ou publicar esta versão em outro endereço.

## Conteúdo

- `index.html`: aplicação completa, interface, mapas, filtros, páginas Empresa 360°, seleção de colunas, officers e a base de 102.404 empresas incorporada no próprio arquivo.
- `public/news.json`: notícias disponíveis no momento da exportação, com veículo, região, data e classificação setorial.
- `scripts/feeds.json`: catálogo das fontes jornalísticas e suas regiões.
- `scripts/fetch-news.mjs`: coleta, curadoria e classificação automática das notícias.
- `.github/workflows/update-news.yml`: atualização automática das notícias a cada hora no GitHub.
- `render.yaml`: configuração pronta para publicação no Render.
- `public/assistant.js` e `public/assistant.css`: interface, busca geográfica, conversas encadeadas e aplicação dos resultados ao mapa e à tabela.
- `assistant-server.mjs`: serviço protegido que usa a OpenAI para interpretar pedidos em linguagem natural sem enviar a base de empresas ao modelo.
- `dist/`: cópia já preparada para hospedagem estática.
- `tests/`: verificações da coleta, segurança e funcionamento do painel no navegador.
- `README.md`: documentação técnica e instruções de publicação.
- `MANIFESTO-SHA256.txt`: impressão digital de cada arquivo, útil para conferir se a transferência foi concluída sem alterações.

## Como abrir

Para apenas consultar o código, abra `index.html` em um editor. Como o painel busca `news.json`, o funcionamento completo deve ser testado por um servidor local ou por uma hospedagem estática.

## Como publicar uma cópia

1. Crie um novo repositório e envie todo o conteúdo deste pacote, preservando as pastas.
2. No Render, crie um Blueprint a partir do arquivo `render.yaml`. Ele cria o site estático e o serviço do assistente.
3. Crie uma chave de autorização no Google AI Studio e preencha `GEMINI_API_KEY` como segredo no serviço `mapa-empresas-assistente`. A chave fica somente no servidor; nunca a inclua no HTML ou no GitHub.
4. Conceda ao workflow do GitHub permissão de escrita para que `public/news.json` seja atualizado automaticamente.
5. Troque nomes, identidade visual, links externos, setores, officers e fontes conforme o novo projeto.

## Onde estão os dados

A base principal de empresas está dentro de `index.html`, na constante `DATA`. As notícias ficam separadas em `public/news.json`. As marcações de Cliente BTG, atribuições de Officer, colunas visíveis e o último setor de notícias escolhido são preferências locais do navegador; elas não fazem parte do arquivo fonte nem são sincronizadas entre usuários.

## Requisitos para manutenção

- Navegador moderno para usar o painel.
- Node.js 20 ou superior para executar o coletor, o serviço do assistente e os testes.
- Conta no GitHub e uma hospedagem estática, como Render, para manter uma cópia online e atualizar notícias automaticamente.

Antes de compartilhar externamente, confirme que o destinatário está autorizado a receber a base de empresas e os dados cadastrais incluídos no pacote.
