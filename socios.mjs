const DEFAULT_BRASILAPI_URL = 'https://brasilapi.com.br/api/cnpj/v1/{cnpj}';
const DEFAULT_TIMEOUT_MS = 10000;
const USER_AGENT = 'btg-radar-prospeccao/1.0 (consulta QSA publico via BrasilAPI)';

function normalizeCnpj(value){
  return String(value || '').replace(/\D/g, '');
}

function normalizeSocios(payload){
  const qsa = Array.isArray(payload?.qsa) ? payload.qsa : [];
  return qsa.map(item => ({
    nome:String(item?.nome_socio || '').trim(),
    qualificacao:String(item?.qualificacao_socio || '').trim() || 'Sócio'
  })).filter(item => item.nome);
}

function createSociosService({fetchImpl=globalThis.fetch, apiUrl=DEFAULT_BRASILAPI_URL, timeoutMs=DEFAULT_TIMEOUT_MS}={}){
  const cache = new Map();
  const pending = new Map();

  async function fetchUpstream(cnpj){
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try{
      const response = await fetchImpl(apiUrl.replace('{cnpj}', cnpj), {
        headers:{'Accept':'application/json','User-Agent':USER_AGENT},
        signal:controller.signal
      });
      if(!response.ok) throw new Error(`brasilapi_${response.status}`);
      return normalizeSocios(await response.json());
    } finally {
      clearTimeout(timer);
    }
  }

  async function get(cnpjValue){
    const cnpj = normalizeCnpj(cnpjValue);
    if(cnpj.length !== 14) throw new Error('invalid_cnpj');
    if(cache.has(cnpj)) return {cnpj, socios:cache.get(cnpj), cached:true};
    if(pending.has(cnpj)){
      const socios = await pending.get(cnpj);
      return {cnpj, socios, cached:true};
    }
    const request = fetchUpstream(cnpj).then(socios => {
      cache.set(cnpj, socios);
      return socios;
    }).finally(() => pending.delete(cnpj));
    pending.set(cnpj, request);
    return {cnpj, socios:await request, cached:false};
  }

  return {get, cache, clear:() => cache.clear()};
}

const sociosService = createSociosService();

export { createSociosService, normalizeCnpj, normalizeSocios, sociosService };
