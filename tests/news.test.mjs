import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { classifySectors, isRelevantItem, NEWS_SECTORS, parseFeed, parseHtmlFeed, selectItems } from '../scripts/fetch-news.mjs';

const root = resolve(import.meta.dirname, '..');
const collector = join(root, 'scripts/fetch-news.mjs');
const fakeServer = join(root, 'tests/fake-feed-server.mjs');
const feed = { source:'Fonte', theme:'Tema' };

test('parser RSS trata CDATA, entidades, HTML, guid e URLs inseguras', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title><![CDATA[Negócios <b>crescem</b> &#38; avançam]]></title><link>https://example.test/1</link><pubDate>Wed, 10 Sep 2025 12:00:00 GMT</pubDate></item>
    <item><title>Usa guid</title><guid isPermaLink="true">https://example.test/2</guid><pubDate>Wed, 10 Sep 2025 11:00:00 GMT</pubDate></item>
    <item><title>Sem link</title><pubDate>Wed, 10 Sep 2025 10:00:00 GMT</pubDate></item>
    <item><title>Link ruim</title><link>javascript:alert(1)</link><pubDate>Wed, 10 Sep 2025 09:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const items = parseFeed(xml, feed);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Negócios crescem & avançam');
  assert.equal(items[1].url, 'https://example.test/2');
  assert.deepEqual(parseFeed('', feed), []);
  assert.deepEqual(parseFeed('<rss><channel></channel></rss>', feed), []);
});

test('parser Atom usa link alternate e ignora o link não HTTP', () => {
  const xml = `<?xml version="1.0"?><feed><entry><title>Resultado &#x26; perspectivas</title>
    <link rel="self" href="javascript:alert(1)"/><link rel="alternate" href="https://example.test/atom"/>
    <updated>2025-09-10T12:00:00Z</updated></entry></feed>`;
  const items = parseFeed(xml, feed);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Resultado & perspectivas');
  assert.equal(items[0].url, 'https://example.test/atom');
});

test('parser HTML regional trata cartões do Sulpetro e do Sistema Ocergs', () => {
  const regionalFeed = { url:'https://regional.test/noticias/', source:'Regional', theme:'RS', region:'RS', trusted:true };
  const html = `
    <h4 class="news-card__title"><a href="/noticia/combustiveis">Mercado de combustíveis &#38; postos</a></h4>
    <span class="news-card__date">04/09/2026</span>
    <span class="date"> 24/08/2026</span><a href="/noticias/cooperativas"><h3>Cooperativas ampliam vendas</h3></a>
    <div class="info-data">17/08/2026</div><a href="/noticias-negocios/varejo"><h4>Cooperativas chegam ao varejo</h4></a>`;
  const items = parseHtmlFeed(html, regionalFeed);
  assert.equal(items.length, 3);
  assert.equal(items[0].title, 'Mercado de combustíveis & postos');
  assert.equal(items[0].url, 'https://regional.test/noticia/combustiveis');
  assert.equal(items[1].publishedAt, '2026-08-24T12:00:00.000Z');
  assert.equal(items[2].title, 'Cooperativas chegam ao varejo');
});

test('curadoria exclui esporte e entretenimento e mantém temas corporativos', () => {
  const publishedAt = new Date().toISOString();
  const make = (title, url) => ({ title, url, source:'Fonte', theme:'Tema', publishedAt });
  const relevant = [
    make('Faturamento da indústria cai 2% em julho, segundo CNI', 'https://exemplo.test/economia/industria'),
    make('Banco amplia crédito para empresas de infraestrutura', 'https://exemplo.test/brasil/credito'),
    make('Companhia anuncia aquisição e investimento de R$ 2 bilhões', 'https://exemplo.test/business/aquisicao')
  ];
  const irrelevant = [
    make('Vasco vence partida pelo Campeonato Brasileiro', 'https://exemplo.test/esportes/vasco'),
    make('Quem estreia no Rock in Rio neste fim de semana', 'https://exemplo.test/pop/rock-in-rio'),
    make('Onde assistir Flamengo x Independiente del Valle', 'https://exemplo.test/esportes/onde-assistir'),
    make('Nova temporada da série estreia hoje', 'https://exemplo.test/pop/serie'),
    make('Ação policial resulta em prisões na capital', 'https://exemplo.test/noticias/cidade'),
    make('Candidato promete investimentos contra o crime', 'https://exemplo.test/politica/eleicoes'),
    make('Corpo carbonizado é encontrado no banco do motorista', 'https://exemplo.test/noticias/policia'),
    make('Cesta básica fica mais barata nas capitais', 'https://exemplo.test/economia/cesta-basica'),
    make('Concurso público prorroga inscrições', 'https://exemplo.test/economia/concurso')
  ];
  relevant.forEach(item => assert.equal(isRelevantItem(item), true, item.title));
  irrelevant.forEach(item => assert.equal(isRelevantItem(item), false, item.title));
  assert.deepEqual(selectItems([...irrelevant, ...relevant]).map(item => item.title), relevant.map(item => item.title));
});

test('curadoria regional preserva fontes confiáveis e aceita janela maior', () => {
  const now = Date.now();
  const regional = {
    title:'Sistema Ocergs participa de encontro no interior',
    url:'https://somoscooperativismo-rs.coop.br/noticia/encontro',
    source:'Ocergs', theme:'Cooperativismo gaúcho', region:'RS', trusted:true,
    publishedAt:new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
  };
  const generalOld = { ...regional, source:'Fonte nacional', region:'BR', trusted:false,
    title:'Empresa participa de encontro no interior' };
  const ceara = { ...regional, source:'Fonte do Ceará', region:'CE', trusted:false,
    title:'Indústria do Ceará anuncia novo investimento',
    url:'https://regional.test/economia/industria-ceara',
    publishedAt:new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString() };
  assert.equal(isRelevantItem(regional), true);
  assert.deepEqual(selectItems([regional, ceara, generalOld], now).map(item => item.source), ['Fonte do Ceará', 'Ocergs']);
});

test('classificação setorial aceita múltiplos setores e usa rótulos conhecidos', () => {
  assert.deepEqual(
    classifySectors({ title:'Banco financia data center e infraestrutura de telecom' }),
    ['Bancos e Finanças', 'Infraestrutura e Logística', 'Tecnologia e Telecom']
  );
  assert.deepEqual(
    classifySectors({ title:'Produtor rural amplia safra de soja com novo fertilizante' }),
    ['Agronegócio']
  );
  assert.deepEqual(classifySectors({ title:'Empresa divulga novo conselho' }), []);
  assert.equal(new Set(NEWS_SECTORS).size, NEWS_SECTORS.length);
});

test('catálogo mantém cobertura jornalística dos estados adicionados', async () => {
  const feeds = JSON.parse(await readFile(join(root, 'scripts/feeds.json'), 'utf8'));
  const expected = { SP:10, RJ:10, ES:10, DF:2, GO:2, MT:3, MS:3, SC:10, PR:10 };
  for (const [region, minimum] of Object.entries(expected)) {
    assert.ok(feeds.filter(feed => feed.region === region).length >= minimum, `${region} sem cobertura mínima`);
  }
  assert.ok(feeds.some(feed => feed.source === 'RIC' && /site%3Aric\.com\.br/i.test(feed.url)));
  assert.ok(feeds.some(feed => feed.source === 'Midiamax' && /site%3Amidiamax\.com\.br/i.test(feed.url)));
  assert.ok(feeds.some(feed => feed.source === 'O Fluminense' && /site%3Aofluminense\.com\.br/i.test(feed.url)));
  assert.equal(feeds.some(feed => /ricmais\.com\.br|midiamax\.uol\.com\.br|www\.ofluminense\.com\.br/i.test(feed.url)), false);
});

function waitForPort(child){
  return new Promise((resolvePort, reject) => {
    let buffer = '';
    child.stdout.on('data', chunk => {
      buffer += chunk;
      const line = buffer.split(/\r?\n/)[0];
      if(/^\d+$/.test(line)) resolvePort(Number(line));
    });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Servidor encerrou antes de iniciar (${code})`)));
  });
}

function run(args){
  return new Promise(resolveRun => {
    const child = spawn(process.execPath, [collector, ...args], { cwd:root });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolveRun({ code, stdout, stderr }));
  });
}

test('fluxo completo tolera 500, filtra, deduplica, ordena, limita e preserva última coleta', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'news-test-'));
  const server = spawn(process.execPath, [fakeServer], { stdio:['ignore', 'pipe', 'pipe'] });
  t.after(async () => { server.kill('SIGTERM'); await rm(temp, { recursive:true, force:true }); });
  const port = await waitForPort(server);
  const feedsPath = join(temp, 'feeds.json');
  const outputPath = join(temp, 'news.json');
  const base = `http://127.0.0.1:${port}`;
  await writeFile(feedsPath, JSON.stringify([
    { url:`${base}/rss.xml`, source:'Fonte A', theme:'Economia' },
    { url:`${base}/atom.xml`, source:'Fonte B', theme:'Mercados' },
    { url:`${base}/broken.xml`, source:'Fonte C', theme:'Empresas' }
  ]));
  await writeFile(outputPath, '{"sentinel":true}\n');

  const result = await run([`--feeds=${feedsPath}`, `--output=${outputPath}`]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /\[ok\] Fonte A/);
  assert.match(result.stderr, /\[falha\] Fonte C.*broken\.xml/);
  const payload = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(payload.items.filter(item => item.source === 'Fonte A').length, 8);
  assert.equal(payload.items.filter(item => item.title === 'Empresa 0 & mercado').length, 1);
  assert.equal(payload.items.some(item => item.title === 'Antiga demais'), false);
  for(let i = 1; i < payload.items.length; i++) {
    assert.ok(Date.parse(payload.items[i - 1].publishedAt) >= Date.parse(payload.items[i].publishedAt));
  }

  const allFailPath = join(temp, 'all-fail.json');
  await writeFile(allFailPath, JSON.stringify([{ url:`${base}/broken.xml`, source:'Fonte C', theme:'Empresas' }]));
  const snapshot = await readFile(outputPath, 'utf8');
  const failed = await run([`--feeds=${allFailPath}`, `--output=${outputPath}`]);
  assert.notEqual(failed.code, 0);
  assert.equal(await readFile(outputPath, 'utf8'), snapshot);
});
