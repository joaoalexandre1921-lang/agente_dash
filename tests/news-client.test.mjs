import http from 'node:http';
import { createReadStream } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const moduleRoot = process.env.CODEX_NODE_MODULES;
const require = createRequire(import.meta.url);
const { chromium } = moduleRoot ? require(join(moduleRoot, 'playwright')) : require('playwright');
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
await access(chrome);

const stamp = offset => new Date(Date.now() + offset).toISOString();
let payload = {
  updatedAt:stamp(0),
  items:[
    { title:'Notícia um', url:'https://example.com/1', source:'Fonte A', theme:'Economia', sectors:['Tecnologia e Telecom'], publishedAt:stamp(-60_000) },
    { title:'Notícia dois', url:'https://example.com/2', source:'Fonte B', theme:'Negócios', sectors:['Indústria'], publishedAt:stamp(-120_000) },
    { title:'Notícia três', url:'https://example.com/3', source:'Fonte C', theme:'Mercados', sectors:['Bancos e Finanças'], publishedAt:stamp(-180_000) },
    { title:'Notícia empresarial do RS', url:'https://example.com/rs', source:'Fonte RS', theme:'Economia do RS', region:'RS', sectors:['Agronegócio'], publishedAt:stamp(-30_000) }
  ]
};

const server = http.createServer((request, response) => {
  if(request.url === '/favicon.ico') { response.statusCode = 204; response.end(); return; }
  if(request.url?.startsWith('/news.json')) {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    response.end(JSON.stringify(payload));
    return;
  }
  if(request.url === '/' || request.url?.startsWith('/index.html') || /^\/\d{14}\/?(?:\?.*)?$/.test(request.url || '')) {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    createReadStream(join(root, 'dist/index.html')).pipe(response);
    return;
  }
  response.statusCode = 404; response.end('not found');
});
await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ headless:true, executablePath:chrome });
const page = await browser.newPage({ viewport:{ width:1440, height:1000 }, reducedMotion:'no-preference' });
const errors = [];
let dialogs = 0;
page.on('console', message => {
  if(message.type() === 'error') errors.push(`${message.text()} (${message.location().url || 'sem URL'})`);
});
page.on('pageerror', error => errors.push(error.message));
page.on('dialog', dialog => { dialogs += 1; dialog.dismiss(); });

try {
  await page.goto(url, { waitUntil:'domcontentloaded', timeout:60_000 });
  await page.locator('#news-title').waitFor({ state:'visible', timeout:60_000 });
  const first = await page.locator('#news-title').textContent();
  await page.waitForTimeout(7300);
  const second = await page.locator('#news-title').textContent();
  if(first === second) throw new Error('A manchete não girou automaticamente em ~7 s.');

  await page.locator('#news-panel').hover();
  const paused = await page.locator('#news-title').textContent();
  await page.waitForTimeout(7300);
  if(await page.locator('#news-title').textContent() !== paused) throw new Error('A rotação não pausou no hover.');
  await page.locator('#news-next').click();
  if(await page.locator('#news-title').textContent() === paused) throw new Error('A seta seguinte não alterou a notícia.');
  if(!/^\d de 3$/.test((await page.locator('#news-counter').textContent()) || '')) throw new Error('Contador incorreto.');

  await page.locator('#msel-estado-btn').click();
  await page.locator('#msel-estado-none').click();
  await page.locator('.msel-cb-estado[value="RS"]').check();
  if(await page.locator('#news-title').textContent() !== 'Notícia empresarial do RS') throw new Error('Notícia regional não foi priorizada ao selecionar RS.');
  if(await page.locator('#news-counter').textContent() !== '1 de 4') throw new Error('Radar regional não manteve notícias gerais como complemento.');
  if(!((await page.locator('#news-updated').textContent()) || '').startsWith('RS ·')) throw new Error('Identificação regional ausente.');

  await page.locator('#news-sector').selectOption({ label:'Tecnologia e Telecom' });
  if(!(await page.locator('#news-status').textContent())?.includes('Nenhuma notícia de Tecnologia e Telecom em RS')) throw new Error('Combinação sem resultados não foi informada.');
  await page.locator('#news-sector').selectOption({ label:'Agronegócio' });
  if(await page.locator('#news-title').textContent() !== 'Notícia empresarial do RS') throw new Error('Filtro combinado de setor e estado falhou.');
  if(await page.locator('#news-counter').textContent() !== '1 de 1') throw new Error('Filtro combinado trouxe notícias de outro setor ou região.');
  await page.locator('#news-sector').selectOption('');

  const heights = await page.evaluate(() => ({
    map:document.getElementById('map-panel').getBoundingClientRect().height,
    side:document.getElementById('side-stack').getBoundingClientRect().height
  }));
  if(Math.abs(heights.map - heights.side) > 2) throw new Error(`Alturas divergentes: ${JSON.stringify(heights)}`);
  await mkdir(resolve(root, '../../work'), { recursive:true });
  await page.screenshot({ path:resolve(root, '../../work/news-layout.png'), fullPage:true });

  const detailHref = await page.locator('a.details-btn').first().getAttribute('href');
  if(!/^\/\d{14}$/.test(detailHref || '')) throw new Error(`Link 360° inválido: ${detailHref}`);
  await page.locator('#column-picker summary').click();
  await page.locator('[data-column-toggle="signal"]').uncheck();
  if(await page.locator('th[data-column="signal"]').isVisible()) throw new Error('A coluna Principal sinal continuou visível.');
  await page.reload({ waitUntil:'domcontentloaded', timeout:60_000 });
  if(await page.locator('th[data-column="signal"]').isVisible()) throw new Error('A escolha de colunas não persistiu.');
  await page.locator('#column-picker summary').click();
  await page.locator('#columns-default').click();

  await page.goto(new URL(detailHref, url).href, { waitUntil:'domcontentloaded', timeout:60_000 });
  await page.locator('#company-page-title').waitFor({ state:'visible', timeout:60_000 });
  if(!((await page.locator('#company-page-title').textContent()) || '').includes('ATLAS INDÚSTRIA')) throw new Error('Página 360° abriu a empresa errada.');
  if(await page.locator('#dashboard-view').isVisible()) throw new Error('Dashboard permaneceu visível na página 360°.');
  if((await page.locator('#company-page-body').textContent())?.includes('Situação de crédito')) throw new Error('A seção removida de situação de crédito reapareceu.');
  await page.goto(url, { waitUntil:'domcontentloaded', timeout:60_000 });

  payload = { updatedAt:stamp(0), items:[
    { title:'<img src=x onerror=alert(1)>', url:'https://example.com/safe', source:'<b>Fonte</b>', theme:'Teste', sectors:[], publishedAt:stamp(0) },
    { title:'Link hostil', url:'javascript:alert(1)', source:'Ruim', theme:'Teste', publishedAt:stamp(0) }
  ]};
  await page.reload({ waitUntil:'domcontentloaded', timeout:60_000 });
  await page.locator('#news-title').waitFor({ state:'visible', timeout:60_000 });
  if(await page.locator('#news-title').textContent() !== '<img src=x onerror=alert(1)>') throw new Error('Título hostil não apareceu como texto literal.');
  if(await page.locator('#news-panel img').count()) throw new Error('HTML hostil criou elemento no DOM.');
  if(await page.locator('#news-counter').textContent() !== '1 de 1') throw new Error('URL javascript: não foi descartada.');
  if(dialogs) throw new Error('Conteúdo hostil disparou diálogo.');
  if(errors.length) throw new Error(`Console contém erros: ${errors.join(' | ')}`);
  process.stdout.write(`OK: rotação, hover, setas, contador, XSS e layout ${heights.map}px/${heights.side}px.\n`);
} finally {
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}
