// Consulta a API OFICIAL do Lusha (endpoint "Search & Enrich Companies") para
// encontrar a pagina do LinkedIn de uma empresa, usando a chave do plano ja
// contratado. Nao acessa o LinkedIn nem o dashboard do Lusha diretamente --
// so a API HTTP documentada em https://docs.lusha.com/apis/openapi/company-search-and-enrich
//
// A chave fica somente neste servico (variavel de ambiente LUSHA_API_KEY),
// no mesmo padrao ja usado para GEMINI_API_KEY/OPENAI_API_KEY em
// assistant-server.mjs -- nunca e enviada ao navegador.

const LUSHA_BASE_URL = 'https://api.lusha.com';
const SEARCH_AND_ENRICH_PATH = '/v3/companies/search-and-enrich';
const DEFAULT_TIMEOUT_MS = 15000;

// A documentacao publica do Lusha nao expoe o JSON de exemplo completo da
// resposta (a pagina "try it" e renderizada via JS). Em vez de depender de um
// nome de campo fixo que ainda nao foi confirmado com uma chamada real, o
// extrator varre a resposta inteira atras de qualquer URL que bata com o
// padrao de pagina de empresa do LinkedIn.
const LINKEDIN_URL_RE = /https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/(?:company|showcase)\/[a-zA-Z0-9\-_%.]+\/?/i;

// Sufixos societarios comuns em razao social BR, removidos para aproximar do
// nome "comercial" que o Lusha costuma indexar.
const SUFFIXES = [
  /\bS\/?A\b/gi, /\bLTDA\.?\b/gi, /\bME\b/gi, /\bEPP\b/gi, /\bEIRELI\b/gi,
  /\bHOLDING\b/gi, /\bGRUPO\b/gi, /\bIND[UÚ]STRIA\b/gi, /\bCOM[EÉ]RCIO\b/gi,
  // Conjuncao/preposicoes soltas que sobram de nomes como "Comercio e Industria X"
  /\bE\b/g, /\bDE\b/g, /\bDO\b/g, /\bDA\b/g,
];

function normalizeCompanyName(name) {
  let n = String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    // Remove pontos antes de casar sufixos: "S.A." e "LTDA." viram "SA"/"LTDA"
    // para que os padroes abaixo (sem exigir ponto) capturem os dois formatos.
    .replace(/\./g, '');
  for (const pattern of SUFFIXES) n = n.replace(pattern, ' ');
  n = n.replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  return n;
}

function extractLinkedinUrl(payload) {
  if (typeof payload === 'string') {
    const match = payload.match(LINKEDIN_URL_RE);
    return match ? match[0] : null;
  }
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = extractLinkedinUrl(item);
      if (found) return found;
    }
    return null;
  }
  if (payload && typeof payload === 'object') {
    for (const value of Object.values(payload)) {
      const found = extractLinkedinUrl(value);
      if (found) return found;
    }
  }
  return null;
}

function createLushaService({
  fetchImpl = globalThis.fetch,
  apiKey = process.env.LUSHA_API_KEY || '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const cache = new Map();
  const pending = new Map();

  async function callSearchAndEnrich(query) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${LUSHA_BASE_URL}${SEARCH_AND_ENRICH_PATH}`, {
        method: 'POST',
        headers: { api_key: apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ companies: [query], pages: { page: 0, size: 1 } }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`lusha_http_${response.status}`);
      // LUSHA_DEBUG=1 no ambiente imprime a resposta crua nos logs do Render
      // (nunca vai para o navegador) -- use uma vez para confirmar o nome
      // exato do campo de LinkedIn e depois desligue a variavel.
      if (process.env.LUSHA_DEBUG === '1') {
        console.log('lusha_raw_response', JSON.stringify(payload));
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  // Estrategia em cascata, da mais precisa a mais ampla: dominio do site (se
  // disponivel) -> nome normalizado. CNPJ nao e usado na consulta ao Lusha
  // (a API deles nao busca por documento brasileiro) -- serve so como chave
  // de cache e de retorno.
  async function findLinkedin({ cnpj, nome, dominio }) {
    if (!apiKey) throw new Error('lusha_not_configured');
    const digits = String(cnpj || '').replace(/\D/g, '');
    if (digits.length !== 14) throw new Error('invalid_cnpj');

    if (cache.has(digits)) return { cnpj: digits, linkedinUrl: cache.get(digits), cached: true };
    if (pending.has(digits)) {
      const linkedinUrl = await pending.get(digits);
      return { cnpj: digits, linkedinUrl, cached: true };
    }

    const attempts = [];
    if (dominio) attempts.push({ domain: String(dominio).trim() });
    const normalized = normalizeCompanyName(nome);
    if (normalized) attempts.push({ name: normalized });
    if (!attempts.length) throw new Error('missing_query');

    const request = (async () => {
      for (const query of attempts) {
        try {
          const payload = await callSearchAndEnrich(query);
          const linkedinUrl = extractLinkedinUrl(payload);
          if (linkedinUrl) return linkedinUrl;
        } catch (error) {
          console.error('lusha_attempt_error', error?.message || error);
        }
      }
      return null;
    })();
    pending.set(digits, request);

    try {
      const linkedinUrl = await request;
      cache.set(digits, linkedinUrl);
      return { cnpj: digits, linkedinUrl, cached: false };
    } finally {
      pending.delete(digits);
    }
  }

  return { findLinkedin, cache, clear: () => cache.clear() };
}

const lushaService = createLushaService();

export { createLushaService, normalizeCompanyName, extractLinkedinUrl, lushaService };
