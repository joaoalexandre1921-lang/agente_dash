import http from 'node:http';

const now = Date.now();
const iso = offset => new Date(now + offset).toUTCString();
const atomDate = offset => new Date(now + offset).toISOString();
const rssItems = Array.from({ length: 10 }, (_, index) => `
  <item><title><![CDATA[Empresa ${index} &amp; mercado]]></title><link>https://example.test/a-${index}</link><pubDate>${iso(-index * 60_000)}</pubDate></item>`).join('');

const rss = `<?xml version="1.0"?><rss version="2.0"><channel>${rssItems}
  <item><title>Antiga demais</title><link>https://example.test/stale</link><pubDate>${iso(-49 * 60 * 60_000)}</pubDate></item>
</channel></rss>`;
const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
  <entry><title>Empresa 0 &amp; mercado</title><link rel="alternate" href="https://other.test/duplicate"/><updated>${atomDate(-30_000)}</updated></entry>
  <entry><title>Notícia mais nova</title><link rel="alternate" href="https://other.test/new"/><updated>${atomDate(30_000)}</updated></entry>
</feed>`;

const server = http.createServer((request, response) => {
  if(request.url === '/rss.xml') response.end(rss);
  else if(request.url === '/atom.xml') response.end(atom);
  else { response.statusCode = 500; response.end('falha simulada'); }
});
server.listen(0, '127.0.0.1', () => process.stdout.write(`${server.address().port}\n`));
for(const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
