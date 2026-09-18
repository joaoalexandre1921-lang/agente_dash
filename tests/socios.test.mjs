import test from 'node:test';
import assert from 'node:assert/strict';
import { createSociosService, normalizeCnpj } from '../socios.mjs';

test('normaliza CNPJ e guarda uma consulta bem-sucedida em cache', async () => {
  let calls = 0;
  const service = createSociosService({
    fetchImpl:async url => {
      calls += 1;
      assert.match(url, /00623904000173$/);
      return {
        ok:true,
        async json(){
          return {qsa:[{nome_socio:'APPLE COMPUTER BRASIL LTDA', qualificacao_socio:'Sócio-Administrador'}]};
        }
      };
    }
  });

  const first = await service.get('00.623.904/0001-73');
  const second = await service.get('00623904000173');

  assert.equal(normalizeCnpj('00.623.904/0001-73'), '00623904000173');
  assert.equal(calls, 1);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.deepEqual(second.socios, [{nome:'APPLE COMPUTER BRASIL LTDA', qualificacao:'Sócio-Administrador'}]);
});

test('não grava erros de rede no cache', async () => {
  let calls = 0;
  const service = createSociosService({
    fetchImpl:async () => { calls += 1; throw new Error('offline'); }
  });
  await assert.rejects(service.get('00623904000173'));
  await assert.rejects(service.get('00623904000173'));
  assert.equal(calls, 2);
});
