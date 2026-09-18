(function(){
  'use strict';
  if(typeof DATA === 'undefined' || !Array.isArray(DATA)) return;

  const launcher = document.getElementById('assistant-launcher');
  const panel = document.getElementById('assistant-panel');
  const closeButton = document.getElementById('assistant-close');
  const messages = document.getElementById('assistant-messages');
  const form = document.getElementById('assistant-form');
  const input = document.getElementById('assistant-input');
  const sendButton = document.getElementById('assistant-send');
  const scopeBar = document.getElementById('assistant-scope');
  const scopeText = document.getElementById('assistant-scope-text');
  const scopeClear = document.getElementById('assistant-scope-clear');
  const assistantStatus = document.querySelector('.assistant-head-copy span');
  if(!launcher || !panel || !form) return;

  const CHAT_STORAGE_KEY = 'btg_commercial_assistant_v1';
  const cityMap = new Map();
  DATA.forEach(company => {
    if(!Number.isFinite(company.lat) || !Number.isFinite(company.lon)) return;
    const key = `${company.cidade}|${company.estado}`;
    if(!cityMap.has(key)) cityMap.set(key, { city:company.cidade, state:company.estado, lat:company.lat, lon:company.lon });
  });
  const cities = [...cityMap.values()].sort((a,b) => b.city.length - a.city.length);
  const cityIndex = cities.map(item => ({...item, normalized:normalize(item.city)}));
  const sectorIndex = SETORES.map(value => ({value, normalized:normalize(value)})).sort((a,b) => b.normalized.length-a.normalized.length);
  const officerIndex = OFFICERS.map(value => ({value, normalized:normalize(value)})).sort((a,b) => b.normalized.length-a.normalized.length);
  const sectorAliases = [
    ['industria','Indústrias da transformação'],['industrial','Indústrias da transformação'],['industriais','Indústrias da transformação'],
    ['tecnologia','Tecnologia'],['software','Tecnologia'],['telecom','Tecnologia'],
    ['agro','Agricultura'],['agricultura','Agricultura'],
    ['varejo','Comércio Varejista'],['atacado','Comércio Atacadista'],
    ['construcao','Construção'],['imobiliario','Imobiliário'],['logistica','Logística e Transporte'],['transporte','Logística e Transporte'],
    ['saude','Saúde'],['farmaceutico','Produtos farmacêuticos'],['farmaceutica','Produtos farmacêuticos'],
    ['banco','Bancário'],['financeiro','Bancário'],['cosmetico','Cosméticos'],['restaurante','Restaurantes'],['servicos','Serviços']
  ];
  let criteria = loadCriteria();
  let latestSearch = null;
  let busy = false;

  function apiEndpoint(){ return document.querySelector('meta[name="assistant-api-url"]')?.content || '/api/chat'; }
  function warmAssistant(){
    let healthUrl;
    try { const url=new URL(apiEndpoint(),location.href); url.pathname='/health'; url.search=''; healthUrl=url.href; }
    catch { return; }
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),70000);
    fetch(healthUrl,{signal:controller.signal}).then(response=>response.ok?response.json():null).then(payload=>{
      if(!payload||!assistantStatus) return;
      assistantStatus.textContent=payload.provider==='gemini'?'Gemini + análise local':payload.provider==='openai'?'IA generativa + análise local':'Análise local conectada à base';
    }).catch(()=>{}).finally(()=>clearTimeout(timer));
  }

  function normalize(value){
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  }
  function escapeHtml(value){
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
  }
  function defaultCriteria(){
    return {city:'',state:'',radiusKm:50,sizes:['Corporate','Large Corporate'],sectors:[],clientStatus:'non_clients',officerStatus:'all',officers:[],limit:10};
  }
  function loadCriteria(){
    try { return {...defaultCriteria(), ...JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || '{}')}; }
    catch { return defaultCriteria(); }
  }
  function saveCriteria(){
    try { localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(criteria)); } catch {}
  }
  function findCity(text){
    const normalized = normalize(text);
    const exact = cityIndex.find(item => new RegExp(`(^| )${item.normalized.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}( |$)`).test(normalized));
    if(exact) return exact;
    return null;
  }
  function findMentionedCities(text){
    const normalized = normalize(text);
    const found = [], spans = [];
    for(const item of cityIndex){
      const pattern = new RegExp(`(^| )${item.normalized.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?= |$)`,'g');
      let match;
      while((match = pattern.exec(normalized))){
        const start = match.index + (match[1] ? match[1].length : 0), end = start + item.normalized.length;
        if(!spans.some(span => start < span.end && end > span.start) && !found.some(city => city.city === item.city && city.state === item.state)){
          found.push(item); spans.push({start,end});
        }
      }
    }
    return found.sort((a,b)=>normalized.indexOf(a.normalized)-normalized.indexOf(b.normalized));
  }
  function resolveCity(city, state){
    const cityName = normalize(city);
    const stateName = normalize(state);
    return cityIndex.find(item => item.normalized === cityName && (!stateName || normalize(item.state) === stateName))
      || cityIndex.find(item => item.normalized === cityName)
      || null;
  }
  function parseLocal(message, prior){
    const text = normalize(message);
    const next = {...defaultCriteria(), ...prior};
    const foundCity = findCity(message);
    if(foundCity){ next.city = foundCity.city; next.state = foundCity.state; }
    const radius = text.match(/(?:raio (?:de )?|ate |em )?(\d{1,3})\s*(?:km|quilometro)/);
    if(radius) next.radiusKm = Math.max(1, Math.min(500, Number(radius[1])));
    const amount = text.match(/(?:mostre|liste|traga|quero|as|os)?\s*(\d{1,2})\s*(?:maiores|melhores|empresas|primeir)/);
    if(amount) next.limit = Math.max(1, Math.min(30, Number(amount[1])));
    if(/\blarge corporate\b/.test(text)) next.sizes = ['Large Corporate'];
    else if(/\bcorporate\b/.test(text)) next.sizes = ['Corporate','Large Corporate'];
    if(/\bmiddle\b/.test(text)) next.sizes = ['Middle'];
    if(/todos os (?:portes|tamanhos)|qualquer (?:porte|tamanho)/.test(text)) next.sizes = [];
    if(/inclua (?:os )?clientes|clientes e nao clientes|todos os clientes/.test(text)) next.clientStatus = 'all';
    if(/somente (?:os )?clientes|so (?:os )?clientes|apenas (?:os )?clientes/.test(text)) next.clientStatus = 'clients';
    if(/nao clientes|nao sejam clientes|sem relacionamento|novos clientes|prospect/.test(text)) next.clientStatus = 'non_clients';
    if(/sem officer|nao atribuid/.test(text)) { next.officerStatus = 'unassigned'; next.officers = []; }
    else if(/com officer|ja atribuid/.test(text)) next.officerStatus = 'assigned';
    if(/com ou sem officer|todos os officers|qualquer officer|retire o officer|sem filtro de officer/.test(text)) { next.officerStatus = 'all'; next.officers = []; }
    const matchedOfficers = officerIndex.filter(item => text.includes(item.normalized)).map(item => item.value);
    if(matchedOfficers.length){ next.officers = matchedOfficers; next.officerStatus = 'assigned'; }
    const directSectors = sectorIndex.filter(item => text.includes(item.normalized)).map(item => item.value);
    const aliasSectors = sectorAliases.filter(([alias]) => new RegExp(`(^| )${alias}(?:s)?( |$)`).test(text)).map(([,value]) => value);
    const matchedSectors = [...new Set([...directSectors,...aliasSectors])].filter(value => SETORES.includes(value));
    if(matchedSectors.length) next.sectors = matchedSectors;
    if(/todos os setores|qualquer setor|retire o setor|sem filtro de setor/.test(text)) next.sectors = [];
    if(/limpe|recomece|nova busca/.test(text)) return {...defaultCriteria(), ...(foundCity ? {city:foundCity.city,state:foundCity.state} : {})};
    return next;
  }
  function findNamedCompanySearch(message){
    const text=normalize(message);
    const marker=text.match(/\b(?:empresa|companhia)\s+(.+)/);
    if(!marker) return null;
    const stop=new Set(['a','o','as','os','de','da','do','das','dos','e','em','me','para','por','favor','analise','analisar','analisa','explique','explica','empresa','companhia','potencial','comercial','recomende','recomendar','abordagem','sobre','quero','diga','fale']);
    const queryTokens=marker[1].split(' ').filter(token=>token.length>=3&&!stop.has(token)).slice(0,8);
    if(!queryTokens.length) return null;
    const ranked=[];
    for(const company of DATA){
      const name=normalize(company.nome);
      const lead=normalize(String(company.nome||'').split('(')[0]).replace(/\b(?:s a|sa|ltda|eireli|me|holding|participacoes)\b/g,' ').replace(/\s+/g,' ').trim();
      const matched=queryTokens.filter(token=>new RegExp(`(^| )${token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}( |$)`).test(name));
      if(!matched.length||!matched.some(token=>token.length>=5)) continue;
      const exactPhrase=lead&&marker[1].includes(lead) || lead&&lead.includes(queryTokens.join(' '));
      const score=matched.length*20+matched.reduce((sum,token)=>sum+token.length,0)+(exactPhrase?100:0);
      ranked.push({company,score});
    }
    if(!ranked.length) return null;
    ranked.sort((a,b)=>b.score-a.score||a.company.nome.localeCompare(b.company.nome,'pt-BR'));
    const best=ranked[0].score;
    const matches=ranked.filter(item=>item.score>=best-12).slice(0,10).map(({company})=>({
      ...company,distance:0,isClient:clientSet.has(company.cnpj),officer:officerAssignments[company.cnpj]||''
    }));
    return {matches,visible:matches,center:null,focus:'company',target:marker[1],label:`Empresa pesquisada: ${marker[1]}`};
  }
  function sanitizeCriteria(raw, message){
    const merged = {...criteria, ...(raw && typeof raw === 'object' ? raw : {})};
    const foundFromMessage = findCity(message);
    const found = foundFromMessage || resolveCity(merged.city, merged.state);
    if(found){ merged.city = found.city; merged.state = found.state; }
    merged.radiusKm = Math.max(1, Math.min(500, Number(merged.radiusKm) || 50));
    merged.limit = Math.max(1, Math.min(30, Number(merged.limit) || 10));
    merged.sizes = [...new Set((Array.isArray(merged.sizes) ? merged.sizes : []).filter(value => TAMANHOS.includes(value)))];
    merged.sectors = [...new Set((Array.isArray(merged.sectors) ? merged.sectors : []).filter(value => SETORES.includes(value)))];
    merged.officers = [...new Set((Array.isArray(merged.officers) ? merged.officers : []).filter(value => OFFICERS.includes(value)))];
    if(!['all','clients','non_clients'].includes(merged.clientStatus)) merged.clientStatus = 'non_clients';
    if(!['all','assigned','unassigned'].includes(merged.officerStatus)) merged.officerStatus = 'all';
    return merged;
  }
  async function askParser(message){
    const endpoint = apiEndpoint();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(endpoint, {
        method:'POST', headers:{'Content-Type':'application/json'}, signal:controller.signal,
        body:JSON.stringify({message,context:criteria,options:{sectors:SETORES,officers:OFFICERS,sizes:TAMANHOS}})
      });
      const contentType = response.headers.get('content-type') || '';
      if(!response.ok || !contentType.includes('application/json')) throw new Error('assistant unavailable');
      const payload = await response.json();
      if(!payload.criteria) throw new Error('invalid response');
      return payload.criteria;
    } finally { clearTimeout(timer); }
  }
  function buildAnalysisFacts(search){
    const matches=search.matches||[];
    const rows=entries=>entries.slice(0,10).map(([label,count])=>({label,count}));
    return {
      focus:search.focus||'territory',target:search.target||'',
      total:matches.length,withoutOfficer:matches.filter(item=>!item.officer).length,
      clients:matches.filter(item=>item.isClient).length,risks:matches.filter(item=>item.rj==='Sim'||item.liq==='Sim').length,
      topCities:rows(countBy(matches,item=>`${item.cidade}/${item.estado}`)),topSectors:rows(countBy(matches,'setor')),
      sizes:rows(countBy(matches,'tamanho')),candidates:matches.slice(0,10).map(item=>({
        name:item.nome,city:item.cidade,state:item.estado,sector:item.setor,size:item.tamanho,
        employeeBand:item.porte,distanceKm:Number(item.distance.toFixed(1)),client:item.isClient,officer:item.officer,
        judicialRecovery:item.rj==='Sim',liquidation:item.liq==='Sim',risk:item.rj==='Sim'||item.liq==='Sim'
      }))
    };
  }
  async function askExplanation(message,search,current){
    const endpoint=apiEndpoint();
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),30000);
    try{
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
        body:JSON.stringify({mode:'explain',message,context:current,facts:buildAnalysisFacts(search)})});
      const contentType=response.headers.get('content-type')||'';
      if(!response.ok||!contentType.includes('application/json')) throw new Error('assistant unavailable');
      const payload=await response.json();
      if(!payload.answer) throw new Error('invalid response');
      return {answer:String(payload.answer).slice(0,4000),provider:payload.provider||'ai'};
    } finally { clearTimeout(timer); }
  }
  function haversine(lat1, lon1, lat2, lon2){
    const rad = Math.PI / 180, earth = 6371;
    const dLat = (lat2-lat1)*rad, dLon = (lon2-lon1)*rad;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dLon/2)**2;
    return earth * 2 * Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  }
  function searchCompanies(current){
    const center = resolveCity(current.city,current.state);
    if(!center) return {error:'city',matches:[],visible:[],center:null};
    const matches = [];
    for(const company of DATA){
      if(!Number.isFinite(company.lat) || !Number.isFinite(company.lon)) continue;
      if(current.sizes.length && !current.sizes.includes(company.tamanho)) continue;
      if(current.sectors.length && !current.sectors.includes(company.setor)) continue;
      const isClient = clientSet.has(company.cnpj);
      if(current.clientStatus === 'non_clients' && isClient) continue;
      if(current.clientStatus === 'clients' && !isClient) continue;
      const officer = officerAssignments[company.cnpj] || '';
      if(current.officerStatus === 'unassigned' && officer) continue;
      if(current.officerStatus === 'assigned' && !officer) continue;
      if(current.officers.length && !current.officers.includes(officer)) continue;
      const distance = haversine(center.lat,center.lon,company.lat,company.lon);
      if(distance > current.radiusKm) continue;
      matches.push({...company,distance,isClient,officer});
    }
    const sizeRank = {'Large Corporate':3,'Corporate':2,'Middle':1};
    matches.sort((a,b) => a.distance-b.distance || (sizeRank[b.tamanho]||0)-(sizeRank[a.tamanho]||0) || a.nome.localeCompare(b.nome,'pt-BR'));
    return {matches,visible:matches.slice(0,current.limit),center};
  }
  function criteriaLabel(current){
    const parts = [`${current.city}/${current.state}`,`raio de ${current.radiusKm} km`];
    if(current.sizes.length) parts.push(current.sizes.join(' + '));
    if(current.sectors.length) parts.push(current.sectors.join(', '));
    if(current.clientStatus === 'non_clients') parts.push('não clientes');
    if(current.clientStatus === 'clients') parts.push('clientes');
    if(current.officerStatus === 'unassigned') parts.push('sem officer');
    if(current.officers.length) parts.push(current.officers.join(', '));
    return parts.join(' · ');
  }
  function countBy(items, key){
    const counts = new Map();
    items.forEach(item => {
      const value = typeof key === 'function' ? key(item) : item[key];
      if(value) counts.set(value,(counts.get(value)||0)+1);
    });
    return [...counts.entries()].sort((a,b)=>b[1]-a[1] || String(a[0]).localeCompare(String(b[0]),'pt-BR'));
  }
  function topLabel(entries, limit=4){
    return entries.slice(0,limit).map(([label,count])=>`${escapeHtml(label)} (${count.toLocaleString('pt-BR')})`).join(', ');
  }
  function share(count,total){
    return total ? `${Math.round(count*100/total)}%` : '0%';
  }
  function isAnalysisRequest(message){
    return /\b(analise|analisa|racional|por que|porque|oportunidade|oportunidades|estrategia|prioriz|concentr|perfil|resumo|setores|cidades|distribuicao|diagnostico)\b/.test(normalize(message));
  }
  function isComparisonRequest(message){
    return /\b(compare|comparar|comparacao|versus|contra|melhor entre)\b/.test(normalize(message));
  }
  function analysisHtml(search,current,generated=null){
    const total = search.matches.length;
    const sectors = countBy(search.matches,'setor');
    const citiesRank = countBy(search.matches,item=>`${item.cidade}/${item.estado}`);
    const sizes = countBy(search.matches,'tamanho');
    const unassigned = search.matches.filter(item=>!item.officer).length;
    const risks = search.matches.filter(item=>item.rj === 'Sim' || item.liq === 'Sim').length;
    const leadSector = sectors[0] || ['Sem setor',0];
    const leadCity = citiesRank[0] || ['Sem cidade',0];
    const readiness = share(unassigned,total);
    const rationale = unassigned/Math.max(total,1) >= .5
      ? `Há espaço claro de cobertura: <strong>${readiness}</strong> das empresas do recorte ainda estão sem officer.`
      : `A cobertura comercial já é relevante; <strong>${readiness}</strong> das empresas do recorte ainda estão sem officer.`;
    const riskText = risks
      ? ` Separe <strong>${risks.toLocaleString('pt-BR')}</strong> ${risks===1?'empresa com sinal':'empresas com sinais'} de recuperação judicial ou liquidação antes da abordagem.`
      : ' Não há empresas com recuperação judicial ou liquidação neste recorte.';
    const generatedBlock=generated?.answer ? `<div class="assistant-generated"><span>Análise estratégica gerada por ${escapeHtml(generated.provider==='gemini'?'Gemini':generated.provider)}</span>${escapeHtml(generated.answer).replace(/\n/g,'<br>')}</div>` : '';
    const title=search.focus==='company'?'Análise da empresa':'Leitura comercial do recorte';
    const evidenceOpen=generated?.answer?'<details class="assistant-evidence"><summary>Ver evidências calculadas na base</summary>':'';
    const evidenceClose=generated?.answer?'</details>':'';
    const summaryLabel=search.label||criteriaLabel(current);
    return `<strong>${title}</strong>${generatedBlock}${evidenceOpen}
      <div class="assistant-insight-lead">A base contém <strong>${total.toLocaleString('pt-BR')}</strong> ${total===1?'empresa':'empresas'}. A maior concentração está em <strong>${escapeHtml(leadCity[0])}</strong> (${leadCity[1].toLocaleString('pt-BR')}) e o setor mais presente é <strong>${escapeHtml(leadSector[0])}</strong> (${leadSector[1].toLocaleString('pt-BR')}, ${share(leadSector[1],total)}).</div>
      <div class="assistant-insight-grid">
        <div><span>Cidades líderes</span><strong>${topLabel(citiesRank)}</strong></div>
        <div><span>Setores líderes</span><strong>${topLabel(sectors)}</strong></div>
        <div><span>Perfil de tamanho</span><strong>${topLabel(sizes,3)}</strong></div>
        <div><span>Sem officer</span><strong>${unassigned.toLocaleString('pt-BR')} · ${readiness}</strong></div>
      </div>
      <div class="assistant-insight-reason"><strong>Racional:</strong> ${rationale}${riskText} A priorização considera concentração cadastral, distância, porte, relacionamento e cobertura por officer; ela não presume faturamento ou propensão de crédito.</div>
      <div class="assistant-summary">${escapeHtml(summaryLabel)} · evidências calculadas localmente</div>${evidenceClose}
      <div class="assistant-actions"><button type="button" class="assistant-action primary" data-assistant-apply>Aplicar ${total.toLocaleString('pt-BR')} na base e no mapa</button><button type="button" class="assistant-action" data-assistant-prompt="Mostre as empresas sem officer neste mesmo recorte">Ver whitespace comercial</button></div>`;
  }
  function renderAnalysisResponse(search,generated=null){
    if(search.error === 'city' || !search.matches.length){ renderSearchResponse(search); return; }
    latestSearch = search;
    addMessage('bot',analysisHtml(search,criteria,generated),'analysis');
  }
  function renderComparisonResponse(mentionedCities,baseCriteria){
    const comparisons = mentionedCities.slice(0,3).map(city=>{
      const current = {...baseCriteria,city:city.city,state:city.state};
      const search = searchCompanies(current);
      const sectors = countBy(search.matches,'setor');
      const unassigned = search.matches.filter(item=>!item.officer).length;
      return {city,current,search,sectors,unassigned};
    });
    const ranked = [...comparisons].sort((a,b)=>b.search.matches.length-a.search.matches.length || b.unassigned-a.unassigned);
    const winner = ranked[0];
    criteria = winner.current; latestSearch = winner.search; saveCriteria();
    const rows = comparisons.map(item=>{
      const total = item.search.matches.length;
      const lead = item.sectors[0] || ['Sem setor',0];
      return `<div class="assistant-compare-row"><strong>${escapeHtml(item.city.city)}/${escapeHtml(item.city.state)}</strong><span>${total.toLocaleString('pt-BR')} empresas · ${item.unassigned.toLocaleString('pt-BR')} sem officer · líder: ${escapeHtml(lead[0])}</span></div>`;
    }).join('');
    const conclusion = winner.search.matches.length
      ? `<strong>${escapeHtml(winner.city.city)}/${escapeHtml(winner.city.state)}</strong> tem o maior universo no critério atual e foi selecionada para aplicação. Antes da abordagem, use a visão 360° para validar cada empresa.`
      : 'Nenhuma das cidades comparadas possui empresas no critério atual; amplie o raio ou os tamanhos.';
    addMessage('bot',`<strong>Comparação territorial</strong><div class="assistant-compare">${rows}</div><div class="assistant-insight-reason"><strong>Leitura:</strong> ${conclusion}</div><div class="assistant-summary">Raio de ${baseCriteria.radiusKm} km · ${escapeHtml(baseCriteria.sizes.join(' + ') || 'todos os tamanhos')} · cálculo local sobre a base</div>${winner.search.matches.length?`<div class="assistant-actions"><button type="button" class="assistant-action primary" data-assistant-apply>Aplicar ${winner.search.matches.length.toLocaleString('pt-BR')} de ${escapeHtml(winner.city.city)}</button></div>`:''}`,'analysis');
  }
  function resultHtml(company){
    const status = company.isClient ? `<span class="assistant-client">Cliente${company.officer ? ` · ${escapeHtml(company.officer)}` : ''}</span>` : '';
    const risk = company.liq === 'Sim' ? '<span class="assistant-risk">Em liquidação</span>' : company.rj === 'Sim' ? '<span class="assistant-risk">Rec. judicial</span>' : '';
    return `<a class="assistant-result" href="/${company.cnpj.replace(/\D/g,'')}">
      <strong>${escapeHtml(company.nome)}</strong>
      <div class="assistant-result-meta">${escapeHtml(company.cidade)}/${escapeHtml(company.estado)} · ${company.distance.toFixed(1).replace('.',',')} km · ${escapeHtml(company.cnpj)}</div>
      <div class="assistant-result-tags"><span>${escapeHtml(company.tamanho)}</span><span>${escapeHtml(company.setor)}</span>${status}${risk}</div>
    </a>`;
  }
  function addMessage(role, html, className=''){
    const wrapper = document.createElement('div');
    wrapper.className = `assistant-message ${role} ${className}`.trim();
    wrapper.innerHTML = `<div class="assistant-bubble">${html}</div>`;
    messages.appendChild(wrapper);
    messages.scrollTop = messages.scrollHeight;
    return wrapper;
  }
  function renderSearchResponse(search){
    if(search.error === 'city'){
      addMessage('bot','Não consegui identificar uma cidade existente na base. Informe a cidade e, se houver nomes iguais, também o estado. Exemplo: <strong>Carlos Barbosa, RS</strong>.');
      return;
    }
    latestSearch = search;
    const label = criteriaLabel(criteria);
    if(!search.matches.length){
      addMessage('bot',`Não encontrei empresas com esse recorte.<div class="assistant-summary">${escapeHtml(label)}</div><div class="assistant-actions"><button type="button" class="assistant-action" data-assistant-prompt="Aumente o raio para 100 km">Aumentar para 100 km</button><button type="button" class="assistant-action" data-assistant-prompt="Inclua clientes e todos os tamanhos">Ampliar filtros</button></div>`);
      return;
    }
    const count = search.matches.length;
    const visibleCount = search.visible.length;
    const intro = `Encontrei <strong>${count.toLocaleString('pt-BR')}</strong> ${count===1?'empresa':'empresas'} no recorte. ${visibleCount<count ? `Estas são as ${visibleCount} mais próximas:` : ''}`;
    addMessage('bot',`${intro}<div class="assistant-result-list">${search.visible.map(resultHtml).join('')}</div><div class="assistant-summary">${escapeHtml(label)} · distâncias em linha reta</div><div class="assistant-actions"><button type="button" class="assistant-action primary" data-assistant-apply>Aplicar ${count.toLocaleString('pt-BR')} na base e no mapa</button><button type="button" class="assistant-action" data-assistant-prompt="Mostre somente empresas sem officer">Somente sem officer</button></div>`);
  }
  function setBusy(value){
    busy = value; sendButton.disabled = value; input.disabled = value;
  }
  async function submitMessage(message){
    const clean = String(message || '').trim();
    if(!clean || busy) return;
    addMessage('user',escapeHtml(clean));
    input.value = ''; setBusy(true);
    const thinking = addMessage('bot','Pesquisando a base <span class="assistant-dots"><i></i><i></i><i></i></span>','thinking');
    const analysisRequest=isAnalysisRequest(clean);
    const namedSearch=analysisRequest?findNamedCompanySearch(clean):null;
    let parsed;
    try { parsed = analysisRequest ? parseLocal(clean,criteria) : await askParser(clean); }
    catch { parsed = parseLocal(clean,criteria); }
    criteria = sanitizeCriteria(parsed,clean); saveCriteria();
    const mentionedCities = findMentionedCities(clean);
    if(isComparisonRequest(clean) && mentionedCities.length >= 2){
      thinking.remove(); renderComparisonResponse(mentionedCities,criteria);
    } else if(analysisRequest){
      const search=namedSearch||searchCompanies(criteria); let generated=null;
      if(!search.error&&search.matches.length){ try { generated=await askExplanation(clean,search,criteria); } catch {} }
      thinking.remove(); renderAnalysisResponse(search,generated);
    } else { thinking.remove(); renderSearchResponse(searchCompanies(criteria)); }
    setBusy(false); input.focus();
  }
  function clearAssistantScope(shouldRender=true){
    window.assistantResultCnpjs = null;
    scopeBar.hidden = true;
    if(shouldRender && typeof renderAll === 'function') renderAll();
  }
  window.clearAssistantScope = clearAssistantScope;
  function applyLatestSearch(){
    if(!latestSearch || !latestSearch.matches.length) return;
    window.assistantResultCnpjs = new Set(latestSearch.matches.map(company => company.cnpj));
    scopeText.textContent = criteriaLabel(criteria);
    scopeBar.hidden = false;
    state.q = ''; state.cnpjQ = '';
    document.getElementById('f-q').value = ''; document.getElementById('f-cnpj').value = '';
    [estadoFilter,setorFilter,cidadeFilter,porteFilter,tamanhoFilter,rjFilter,liqFilter,clienteFilter,officerFilter,scoreFilter,productFilter,testFilter].forEach(filter => filter.reset());
    currentPage = 1; renderAll();
    panel.hidden = true; launcher.setAttribute('aria-expanded','false');
    document.querySelector('.table-heading')?.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function openPanel(){ panel.hidden=false; launcher.setAttribute('aria-expanded','true'); setTimeout(()=>input.focus(),0); }
  function closePanel(){ panel.hidden=true; launcher.setAttribute('aria-expanded','false'); launcher.focus(); }

  launcher.addEventListener('click',()=>panel.hidden ? openPanel() : closePanel());
  closeButton.addEventListener('click',closePanel);
  scopeClear.addEventListener('click',()=>clearAssistantScope());
  form.addEventListener('submit',event=>{ event.preventDefault(); submitMessage(input.value); });
  input.addEventListener('keydown',event=>{ if(event.key==='Enter' && !event.shiftKey){ event.preventDefault(); form.requestSubmit(); } });
  document.addEventListener('click',event=>{
    const promptButton = event.target.closest?.('[data-assistant-prompt]');
    if(promptButton){ openPanel(); submitMessage(promptButton.getAttribute('data-assistant-prompt')); }
    if(event.target.closest?.('[data-assistant-apply]')) applyLatestSearch();
  });
  document.addEventListener('keydown',event=>{ if(event.key==='Escape' && !panel.hidden) closePanel(); });
  warmAssistant();
})();
