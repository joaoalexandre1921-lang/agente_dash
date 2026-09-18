/**
 * Este coletor guarda somente título isolado, URL, veículo e data. Não copie
 * resumo, corpo ou imagem. A Lei 9.610/98, art. 8º, VI, exclui nomes e títulos
 * isolados da proteção autoral, enquanto fotografias aparecem entre as obras
 * protegidas no art. 7º, VII. Isso é uma cautela de produto, não um parecer
 * jurídico: manchete curta com link para a origem é a opção deliberadamente
 * conservadora e thumbnails não devem ser adicionadas sem nova revisão.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FEEDS = resolve(ROOT, 'scripts/feeds.json');
const DEFAULT_OUTPUT = resolve(ROOT, 'public/news.json');
const GENERAL_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const REGIONAL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ITEMS_PER_REGION = 40;
const USER_AGENT = 'BTG-Radar-News-Aggregator/1.0 (+https://mapa-empresas-dashboard.onrender.com/)';

// O radar apoia prospecção de Corporate Banking. Categorias editoriais amplas
// só entram quando o título contém um sinal econômico ou empresarial claro.
const BLOCKED_PATH = /\/(?:esporte|esportes|pop|entretenimento|celebridades|cinema|musica|televisao|tv|loterias?|horoscopo)(?:\/|$)/i;
const BLOCKED_TITLE = /\b(?:futebol|brasileirao|campeonato|copa do mundo|partida|jogador(?:a|es)?|onde assistir|nfl|nba|ufc|formula 1|flamengo|fluminense|maracana|torcida|ingressos?|rock in rio|festival|show(?:s)?|cantor(?:a|es)?|luan santana|atriz|ator(?:es)?|novela|serie|filme|reality show|big brother|bbb|teatro|concerto|espetaculo|se apresenta|novo carro|ganha motor|cambio automatico|suv|sedan|hatch|picape|haval|creta|onix|argo|iphone|smartphone|horoscopo|mega sena|loteria|games?|concurso|greve|poupanca|cesta basica|minha casa minha vida|gas do povo|taxa das blusinhas|aposentadoria|beneficio social|salario minimo|incendio|furt(?:o|ado)|trafico de drogas|homicidio|assassinato|corpo carbonizado|vitima|pris(?:ao|oes)|policial|candidato(?:a|s)?|campanha eleitoral|promete|propoe|apartamentos? a venda)\b/i;
const TRUSTED_PATH = /\/(?:economia|mercados|negocios|agro|agronegocio|tecnologia|investimentos?|future-of-money)(?:\/|$)/i;
const BROAD_BUSINESS_PATH = /\/(?:business|brasil|mundo|global)(?:\/|$)/i;
const BUSINESS_SIGNAL = /\b(?:empresa(?:s|rial|riais)?|companhia(?:s)?|industria(?:s|l)?|setor(?:es)?|mercado(?:s)?|ibovespa|b3|investimento(?:s)?|financiamento(?:s)?|credito|banco(?:s|ario|arios)?|juros|inflacao|pib|faturamento|lucro(?:s)?|receita federal|venda(?:s)?|producao|exportacao|importacao|comercio|varejo|atacado|servico(?:s)?|construcao|infraestrutura|energia|petroleo|gas|mineracao|agro|tecnologia|startup(?:s)?|fintech(?:s)?|fusao|aquisicao|divida(?:s)?|debenture(?:s)?|capital|cambio|dolar|tributo(?:s)?|imposto(?:s)?|fiscal|fgts|cni|emprego(?:s)?|salario(?:s)?|concessao|licitacao|logistica|transporte|telecom|saneamento|cash management|trade finance|funding)\b/i;

// Uma notícia pode pertencer a mais de um setor. Os rótulos ficam gravados no
// news.json durante a coleta, deixando o filtro do painel rápido e estável.
export const NEWS_SECTORS = [
  'Agronegócio',
  'Alimentos e Bebidas',
  'Bancos e Finanças',
  'Comércio e Varejo',
  'Construção e Imobiliário',
  'Energia e Mineração',
  'Indústria',
  'Infraestrutura e Logística',
  'Saúde e Farmacêutico',
  'Serviços',
  'Tecnologia e Telecom',
];

const SECTOR_RULES = [
  ['Agronegócio', /\b(?:agro(?:negocio|pecuaria)?|agricultur|produtor rural|plano safra|safra|soja|milho|cafe|algodao|cana(?: de acucar)?|fertilizante|defensivo|cooperativa agricola|pecuaria|gado|graos?)\b/],
  ['Alimentos e Bebidas', /\b(?:alimento|bebida|cerveja|frigorifico|carne|laticinio|leite|acucar|restaurante|supermercado|industria alimenticia|food service)\b/],
  ['Bancos e Finanças', /\b(?:banco|bancario|credito|financiamento|juros|selic|ibovespa|bolsa|b3|acao|acoes|investimento|investidor|fintech|seguradora|seguro|previdencia|cartao|pagamento|cambio|dolar|debenture|divida|capital|mercado financeiro|fundo de investimento|funding)\b/],
  ['Comércio e Varejo', /\b(?:varejo|varejista|atacado|atacadista|comercio|loja|shopping|e-commerce|comercio eletronico|marketplace|supermercado|vendas no varejo)\b/],
  ['Construção e Imobiliário', /\b(?:construcao|construtora|imobiliari|imovel|habitacao|incorporadora|cimento|engenharia civil|mercado imobiliario)\b/],
  ['Energia e Mineração', /\b(?:energia|eletric|petroleo|gas natural|combustivel|etanol|biodiesel|solar|eolica|hidreletrica|mineracao|minerio|mineral|siderurgia|aco|transicao energetica)\b/],
  ['Indústria', /\b(?:industria|industrial|fabrica|manufatura|producao|metalurg|automotiv|montadora|maquina|equipamento|textil|papel e celulose|quimica)\b/],
  ['Infraestrutura e Logística', /\b(?:infraestrutura|logistica|transporte|rodovia|ferrovia|porto|aeroporto|mobilidade|saneamento|concessao|armazenagem|frete|carga)\b/],
  ['Saúde e Farmacêutico', /\b(?:saude|hospital|farmaceutic|medicamento|remedio|laboratorio|clinica|biotecnologia|plano de saude)\b/],
  ['Serviços', /\b(?:servico|turismo|hotel|hotelaria|educacao|ensino|consultoria|advocacia|contabilidade|terceirizacao)\b/],
  ['Tecnologia e Telecom', /\b(?:tecnologia|inteligencia artificial|\bia\b|software|startup|computacao|nuvem|cloud|data center|dados|chip|semicondutor|telecom|internet|conectividade|ciberseguranca|digital)\b/],
];

export function classifySectors(item = {}) {
  const text = normalizeTitle(`${item.title || ''} ${item.theme || ''}`);
  return SECTOR_RULES.filter(([, rule]) => rule.test(text)).map(([sector]) => sector);
}

export function decodeEntities(value = '') {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value).replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, code) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? all;
    const hex = code[1].toLowerCase() === 'x';
    const number = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
    try { return Number.isFinite(number) ? String.fromCodePoint(number) : all; }
    catch { return all; }
  });
}

export function cleanText(value = '') {
  let text = String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1');
  text = decodeEntities(text);
  text = text.replace(/<[^>]*>/g, ' ');
  return decodeEntities(text).replace(/\s+/g, ' ').trim();
}

function tagValue(block, tag) {
  const safe = tag.replace(':', '(?::|\\:)');
  const match = block.match(new RegExp(`<${safe}\\b[^>]*>([\\s\\S]*?)<\\/${safe}>`, 'i'));
  return match ? cleanText(match[1]) : '';
}

function validHttpUrl(value) {
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : ''; }
  catch { return ''; }
}

function itemLink(block, atom) {
  if (atom) {
    const links = [...block.matchAll(/<link\b([^>]*)\/?\s*>/gi)];
    const alternate = links.find(match => /\brel\s*=\s*["']alternate["']/i.test(match[1]));
    const candidate = alternate || links.find(match => !/\brel\s*=/i.test(match[1])) || links[0];
    const href = candidate?.[1].match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    return validHttpUrl(decodeEntities(href));
  }
  const link = tagValue(block, 'link');
  if (validHttpUrl(link)) return validHttpUrl(link);
  const guid = block.match(/<guid\b([^>]*)>([\s\S]*?)<\/guid>/i);
  if (guid && /\bisPermaLink\s*=\s*["']true["']/i.test(guid[1])) return validHttpUrl(cleanText(guid[2]));
  return '';
}

export function parseFeed(xml, feed) {
  const atom = /<feed\b/i.test(xml) || /<entry\b/i.test(xml);
  const regex = atom ? /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi : /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  const items = [];
  for (const match of xml.matchAll(regex)) {
    const block = match[1];
    const title = tagValue(block, 'title');
    const url = itemLink(block, atom);
    const dateText = tagValue(block, 'pubDate') || tagValue(block, 'published') || tagValue(block, 'updated') || tagValue(block, 'dc:date');
    const timestamp = Date.parse(dateText);
    if (!title || !url || !Number.isFinite(timestamp)) continue;
    items.push({
      title,
      url,
      source: feed.source,
      theme: feed.theme,
      region: feed.region || 'BR',
      trusted: Boolean(feed.trusted),
      publishedAt: new Date(timestamp).toISOString(),
    });
  }
  return items;
}

function regionalHtmlItem(feed, title, href, dateText) {
  const [day, month, year] = dateText.split('/').map(Number);
  const timestamp = Date.UTC(year, month - 1, day, 12);
  let url = '';
  try { url = new URL(decodeEntities(href), feed.url).href; } catch { return null; }
  if (!title || !validHttpUrl(url) || !Number.isFinite(timestamp)) return null;
  return {
    title: cleanText(title), url, source: feed.source, theme: feed.theme,
    region: feed.region || 'BR', trusted: Boolean(feed.trusted),
    publishedAt: new Date(timestamp).toISOString(),
  };
}

export function parseHtmlFeed(html, feed) {
  const items = [];
  const seen = new Set();
  const add = (title, href, dateText) => {
    const item = regionalHtmlItem(feed, title, href, dateText);
    if (item && !seen.has(item.url)) { seen.add(item.url); items.push(item); }
  };
  for (const match of html.matchAll(/<h4\b[^>]*class=["'][^"']*news-card__title[^"']*["'][^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h4>[\s\S]{0,800}?<span\b[^>]*class=["'][^"']*news-card__date[^"']*["'][^>]*>\s*(\d{2}\/\d{2}\/\d{4})/gi)) {
    add(match[2], match[1], match[3]);
  }
  for (const match of html.matchAll(/<span\b[^>]*class=["']date["'][^>]*>[\s\S]*?(\d{2}\/\d{2}\/\d{4})<\/span>[\s\S]{0,800}?<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)) {
    add(match[3], match[2], match[1]);
  }
  for (const match of html.matchAll(/<div\b[^>]*class=["'][^"']*info-data[^"']*["'][^>]*>\s*(\d{2}\/\d{2}\/\d{4})\s*<\/div>[\s\S]{0,500}?<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*<h4\b[^>]*>([\s\S]*?)<\/h4>/gi)) {
    add(match[3], match[2], match[1]);
  }
  return items;
}

export function normalizeTitle(title) {
  return title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function isRelevantItem(item) {
  const title = normalizeTitle(item.title || '');
  let path = '';
  try { path = new URL(item.url).pathname.toLowerCase(); } catch { return false; }
  if (BLOCKED_PATH.test(path) || BLOCKED_TITLE.test(title)) return false;
  if (item.trusted) return true;
  if (TRUSTED_PATH.test(path)) return true;
  const hasBusinessSignal = BUSINESS_SIGNAL.test(title);
  if (BROAD_BUSINESS_PATH.test(path)) return hasBusinessSignal;
  return hasBusinessSignal;
}

export function selectItems(items, now = Date.now()) {
  const fresh = items.filter(item => {
    const time = Date.parse(item.publishedAt);
    const maxAge = item.region && item.region !== 'BR' ? REGIONAL_MAX_AGE_MS : GENERAL_MAX_AGE_MS;
    return Number.isFinite(time) && time <= now + 5 * 60 * 1000 && now - time <= maxAge && validHttpUrl(item.url) && isRelevantItem(item);
  }).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const titles = new Set();
  const urls = new Set();
  const perSource = new Map();
  const perRegion = new Map();
  const selected = [];
  for (const item of fresh) {
    const titleKey = normalizeTitle(item.title);
    const urlKey = new URL(item.url).href;
    if (!titleKey || titles.has(titleKey) || urls.has(urlKey)) continue;
    const region = item.region || 'BR';
    const count = perSource.get(item.source) || 0;
    const sourceLimit = region === 'BR' ? 8 : 3;
    if (count >= sourceLimit) continue;
    const regionCount = perRegion.get(region) || 0;
    if (regionCount >= MAX_ITEMS_PER_REGION) continue;
    titles.add(titleKey); urls.add(urlKey); perSource.set(item.source, count + 1);
    perRegion.set(region, regionCount + 1);
    selected.push({ ...item, sectors: classifySectors(item) });
  }
  return selected;
}

export async function fetchOne(feed, fetchImpl = fetch) {
  const response = await fetchImpl(feed.url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.text();
  if (feed.format === 'html') return parseHtmlFeed(body, feed);
  if (!/<(?:rss|feed)\b/i.test(body)) throw new Error('resposta não é RSS/Atom');
  return parseFeed(body, feed);
}

export async function collect({ feeds, fetchImpl = fetch, now = Date.now(), log = console } = {}) {
  const settled = new Array(feeds.length);
  let nextFeed = 0;
  const workers = Array.from({ length: Math.min(8, feeds.length) }, async () => {
    while (nextFeed < feeds.length) {
      const index = nextFeed++;
      try {
        settled[index] = { status: 'fulfilled', value: await fetchOne(feeds[index], fetchImpl) };
      } catch (reason) {
        settled[index] = { status: 'rejected', reason };
      }
    }
  });
  await Promise.all(workers);
  const all = [];
  let successes = 0;
  settled.forEach((result, index) => {
    const feed = feeds[index];
    if (result.status === 'fulfilled') {
      successes += 1; all.push(...result.value);
      log.log(`[ok] ${feed.source}: ${result.value.length} item(ns) — ${feed.url}`);
    } else {
      log.error(`[falha] ${feed.source}: ${result.reason?.message || result.reason} — ${feed.url}`);
    }
  });
  if (!successes) throw new Error('Todos os feeds falharam; o news.json existente foi preservado.');
  return selectItems(all, now);
}

export async function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry');
  const feedsArg = argv.find(arg => arg.startsWith('--feeds='));
  const outputArg = argv.find(arg => arg.startsWith('--output='));
  const feedsPath = resolve(feedsArg ? feedsArg.slice(8) : DEFAULT_FEEDS);
  const outputPath = resolve(outputArg ? outputArg.slice(9) : DEFAULT_OUTPUT);
  const feeds = JSON.parse(await readFile(feedsPath, 'utf8'));
  const items = await collect({ feeds });
  const publicItems = items.map(({ trusted, ...item }) => item);
  const payload = { updatedAt: new Date().toISOString(), items: publicItems };
  if (dryRun) { console.log(JSON.stringify(payload, null, 2)); return; }

  let previous;
  try { previous = JSON.parse(await readFile(outputPath, 'utf8')); } catch { previous = null; }
  if (JSON.stringify(previous?.items || []) === JSON.stringify(publicItems)) {
    console.log('Nenhuma alteração nas manchetes; arquivo mantido.');
    return;
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Atualizado: ${outputPath} (${publicItems.length} item(ns)).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => { console.error(error.message || error); process.exitCode = 1; });
}
