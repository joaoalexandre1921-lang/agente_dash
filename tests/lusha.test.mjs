import test from 'node:test';
import assert from 'node:assert/strict';
import { createLushaService, normalizeCompanyName, extractLinkedinUrl, extractCompanyMatch } from '../lusha.mjs';

test('normaliza razao social removendo sufixos societarios e acentos', () => {
  assert.equal(normalizeCompanyName('MINERAÇÃO EXEMPLO S.A.'), 'MINERACAO EXEMPLO');
  assert.equal(normalizeCompanyName('Comércio e Indústria Fulano LTDA'), 'FULANO');
});

test('extrai URL de pagina de empresa do LinkedIn de qualquer lugar do JSON', () => {
  const payload = {data: [{firmographics: {name: 'Vale'}, social: {links: {linkedin: 'https://www.linkedin.com/company/vale/'}}}]};
  assert.equal(extractLinkedinUrl(payload), 'https://www.linkedin.com/company/vale/');
  assert.equal(extractLinkedinUrl({foo: 'bar'}), null);
});

test('usa dominio antes do nome e guarda em cache por CNPJ', async () => {
  let calls = 0;
  const queriesReceived = [];
  const service = createLushaService({
    apiKey: 'fake-key',
    fetchImpl: async (url, options) => {
      calls += 1;
      const body = JSON.parse(options.body);
      queriesReceived.push(body.companies[0]);
      assert.equal(options.headers.api_key, 'fake-key');
      return {
        ok: true,
        async json() {
          return {companies: [{linkedinUrl: 'https://www.linkedin.com/company/vale/'}]};
        },
      };
    },
  });

  const first = await service.findLinkedin({cnpj: '33.592.510/0001-54', nome: 'VALE S.A.', dominio: 'vale.com'});
  const second = await service.findLinkedin({cnpj: '33592510000154', nome: 'VALE S.A.', dominio: 'vale.com'});

  assert.equal(calls, 1);
  assert.deepEqual(queriesReceived[0], {domain: 'vale.com'});
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(first.linkedinUrl, 'https://www.linkedin.com/company/vale/');
});

test('cai para o nome normalizado quando nao ha dominio', async () => {
  const queriesReceived = [];
  const service = createLushaService({
    apiKey: 'fake-key',
    fetchImpl: async (url, options) => {
      queriesReceived.push(JSON.parse(options.body).companies[0]);
      return {ok: true, async json() { return {companies: [{linkedinUrl: null}]}; }};
    },
  });
  const result = await service.findLinkedin({cnpj: '33592510000154', nome: 'Fulano Mineração LTDA'});
  assert.deepEqual(queriesReceived[0], {name: 'FULANO MINERACAO'});
  assert.equal(result.linkedinUrl, null);
});

test('rejeita quando a chave nao esta configurada', async () => {
  const service = createLushaService({apiKey: '', fetchImpl: async () => { throw new Error('nao deveria chamar'); }});
  await assert.rejects(
    service.findLinkedin({cnpj: '33592510000154', nome: 'Vale'}),
    /lusha_not_configured/,
  );
});

test('rejeita CNPJ invalido antes de chamar a API', async () => {
  const service = createLushaService({apiKey: 'fake-key', fetchImpl: async () => { throw new Error('nao deveria chamar'); }});
  await assert.rejects(
    service.findLinkedin({cnpj: '123', nome: 'Vale'}),
    /invalid_cnpj/,
  );
});

// Formato real observado numa chamada de producao (endpoint nao documenta o
// schema completo -- ver comentario em lusha.mjs). O campo "pages" no corpo
// da requisicao NAO existe nesse endpoint (Lusha responde 400 "property
// pages should not exist"); o extrator abaixo cobre o formato real:
// results[].name + results[].socialLinks.linkedin.
test('extrai nome e URL do formato real de resposta (results[].socialLinks.linkedin)', () => {
  const payload = {
    requestId: 'abc',
    results: [{
      id: 'v1.x',
      name: 'ArcelorMittal Brasil',
      domain: 'brasil.arcelormittal.com',
      socialLinks: {linkedin: 'https://www.linkedin.com/company/arcelormittal-brasil', facebook: 'https://www.facebook.com/x'},
    }],
    billing: {creditsCharged: 2},
  };
  assert.deepEqual(extractCompanyMatch(payload), {
    name: 'ArcelorMittal Brasil',
    linkedinUrl: 'https://www.linkedin.com/company/arcelormittal-brasil',
  });
});

test('findLinkedin devolve o nome da empresa que o Lusha casou, para conferencia visual', async () => {
  const service = createLushaService({
    apiKey: 'fake-key',
    fetchImpl: async () => ({
      ok: true,
      async json() {
        // Simula um match "generico": buscamos uma subsidiaria e o Lusha
        // devolve uma empresa nao relacionada que so compartilha um termo
        // generico da razao social apos a normalizacao de sufixos.
        return {results: [{name: 'Compoarte Artefatos De Arame', socialLinks: {linkedin: 'https://www.linkedin.com/company/compoarte-artefatos-de-arame'}}]};
      },
    }),
  });
  const result = await service.findLinkedin({cnpj: '27498830000147', nome: 'ArcelorMittal Artefatos de Arame Ltda'});
  assert.equal(result.linkedinUrl, 'https://www.linkedin.com/company/compoarte-artefatos-de-arame');
  assert.equal(result.companyName, 'Compoarte Artefatos De Arame');
});
