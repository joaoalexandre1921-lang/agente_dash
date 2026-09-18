import test from 'node:test';
import assert from 'node:assert/strict';
import { createLushaService, normalizeCompanyName, extractLinkedinUrl } from '../lusha.mjs';

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
