import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { sociosService } from './socios.mjs';
import { lushaService } from './lusha.mjs';

const PORT = Number(process.env.PORT || 8787);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const AI_PROVIDER = String(process.env.AI_PROVIDER || 'auto').toLowerCase();
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || 'https://mapa-empresas-dashboard.onrender.com,http://localhost:8000,http://127.0.0.1:8000,http://localhost:8787').split(',').map(value => value.trim()).filter(Boolean));

function json(res,status,payload,origin=''){
  const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  if(origin && ALLOWED_ORIGINS.has(origin)){ headers['Access-Control-Allow-Origin']=origin; headers.Vary='Origin'; }
  res.writeHead(status,headers); res.end(JSON.stringify(payload));
}
function readBody(req){
  return new Promise((resolve,reject)=>{
    let raw='';
    req.on('data',chunk=>{ raw+=chunk; if(raw.length>100000){ reject(new Error('payload_too_large')); req.destroy(); } });
    req.on('end',()=>{ try{ resolve(JSON.parse(raw||'{}')); } catch{ reject(new Error('invalid_json')); } });
    req.on('error',reject);
  });
}
function safeList(value,max=120){ return Array.isArray(value) ? value.map(item=>String(item).slice(0,100)).slice(0,max) : []; }
function cleanContext(value){
  const source = value && typeof value === 'object' ? value : {};
  return {
    city:String(source.city||'').slice(0,80),state:String(source.state||'').slice(0,2),radiusKm:Number(source.radiusKm)||50,
    sizes:safeList(source.sizes,3),sectors:safeList(source.sectors,20),clientStatus:String(source.clientStatus||'non_clients'),
    officerStatus:String(source.officerStatus||'all'),officers:safeList(source.officers,20),limit:Number(source.limit)||10
  };
}
function safeText(value,max=160){ return String(value == null ? '' : value).slice(0,max); }
function cleanFacts(value){
  const source=value && typeof value==='object' ? value : {};
  const cleanRows=(rows,max=10)=>Array.isArray(rows) ? rows.slice(0,max).map(row=>({
    label:safeText(row?.label,120),count:Math.max(0,Number(row?.count)||0)
  })) : [];
  const candidates=Array.isArray(source.candidates) ? source.candidates.slice(0,10).map(item=>({
    name:safeText(item?.name,160),city:safeText(item?.city,80),state:safeText(item?.state,2),
    sector:safeText(item?.sector,100),size:safeText(item?.size,30),employeeBand:safeText(item?.employeeBand,60),
    distanceKm:Math.max(0,Number(item?.distanceKm)||0),client:Boolean(item?.client),officer:safeText(item?.officer,100),
    judicialRecovery:Boolean(item?.judicialRecovery),liquidation:Boolean(item?.liquidation),risk:Boolean(item?.risk)
  })) : [];
  return {
    focus:safeText(source.focus,30),target:safeText(source.target,160),
    total:Math.max(0,Number(source.total)||0),withoutOfficer:Math.max(0,Number(source.withoutOfficer)||0),
    clients:Math.max(0,Number(source.clients)||0),risks:Math.max(0,Number(source.risks)||0),
    topCities:cleanRows(source.topCities),topSectors:cleanRows(source.topSectors),sizes:cleanRows(source.sizes,5),candidates
  };
}
function interactionText(payload){
  return (payload?.steps||[])
    .filter(step=>step?.type==='model_output')
    .flatMap(step=>Array.isArray(step?.content)?step.content:[])
    .filter(part=>part?.type==='text')
    .map(part=>part?.text||'').join('').trim();
}
function geminiContentText(payload){
  return (payload?.candidates||[])
    .flatMap(candidate=>Array.isArray(candidate?.content?.parts)?candidate.content.parts:[])
    .map(part=>part?.text||'').join('').trim();
}
function selectedProvider(){
  if(AI_PROVIDER==='gemini') return GEMINI_API_KEY ? 'gemini' : '';
  if(AI_PROVIDER==='openai') return OPENAI_API_KEY ? 'openai' : '';
  if(GEMINI_API_KEY) return 'gemini';
  if(OPENAI_API_KEY) return 'openai';
  return '';
}
async function geminiGenerate(prompt,{schema=null,maxOutputTokens=900,thinkingLevel='LOW'}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),30000);
  const generationConfig={maxOutputTokens,thinkingConfig:{thinkingLevel}};
  if(schema){ generationConfig.responseMimeType='application/json'; generationConfig.responseSchema=schema; }
  const body={contents:[{role:'user',parts:[{text:prompt}]}],generationConfig};
  let response;
  try{
    response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,{
      method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':GEMINI_API_KEY},
      signal:controller.signal,body:JSON.stringify(body)
    });
  } finally { clearTimeout(timer); }
  const payload=await response.json();
  if(!response.ok) throw new Error(payload?.error?.message||'gemini_error');
  const text=geminiContentText(payload);
  if(!text) throw new Error('missing_gemini_text');
  return text;
}
function criteriaSchema(options){
  const sectors=safeList(options?.sectors,100), officers=safeList(options?.officers,120), sizes=safeList(options?.sizes,5);
  return {type:'object',required:['city','state','radiusKm','sizes','sectors','clientStatus','officerStatus','officers','limit'],properties:{
    city:{type:'string'},state:{type:'string'},radiusKm:{type:'number',minimum:1,maximum:500},
    sizes:{type:'array',items:{type:'string',enum:sizes.length?sizes:['Middle','Corporate','Large Corporate']}},
    sectors:{type:'array',items:{type:'string',enum:sectors}},clientStatus:{type:'string',enum:['all','clients','non_clients']},
    officerStatus:{type:'string',enum:['all','assigned','unassigned']},officers:{type:'array',items:{type:'string',enum:officers}},
    limit:{type:'integer',minimum:1,maximum:30}
  }};
}
async function parseWithGemini(message,context,options){
  const instructions=`Converta o pedido em filtros de busca de empresas brasileiras e responda somente com o JSON solicitado. Preserve os critérios atuais em pedidos de continuação. Corporate sem especificar Large significa Corporate e Large Corporate. Para prospecção, mantenha non_clients, salvo se o usuário pedir clientes. Redondezas significa o raio atual ou 50 km. Use somente setores, officers e tamanhos das listas permitidas. Não invente empresas nem fatos.\nCritérios atuais: ${JSON.stringify(context)}\nOpções permitidas: ${JSON.stringify({sectors:safeList(options?.sectors,100),officers:safeList(options?.officers,120),sizes:safeList(options?.sizes,5)})}\nPedido: ${safeText(message,1200)}`;
  return JSON.parse(await geminiGenerate(instructions,{schema:criteriaSchema(options)}));
}
async function explainWithGemini(message,context,facts){
  const prompt=`Você é um estrategista sênior de Corporate Banking. Responda em português do Brasil, em até 350 palavras, usando os fatos fornecidos como evidência, sem apenas repeti-los. Produza uma análise nova e útil para preparar uma abordagem comercial.

Separe claramente:
1. Diagnóstico: o que os dados sustentam.
2. Hipóteses comerciais: de 2 a 4 possibilidades plausíveis de necessidades bansárias, marcadas explicitamente como hipóteses a validar. Relacione setor, porte, localização e cobertura comercial. Não afirme que a empresa possui uma necessidade sem evidência.
3. Prioridade e abordagem: quem ou qual segmento abordar primeiro e por quê.
4. Perguntas de descoberta: três perguntas concretas para a conversa com o cliente.
5. Próximo passo recomendado.

Quando a pergunta citar uma empresa específica, concentre a resposta nela e use as demais somente como contexto comparável. Não invente faturamento, crédito, notícias, contatos, estrutura societária, importações, exportações ou causalidades. Se os dados não sustentarem uma conclusão, diga o que precisa ser validado. Evite reescrever os totais que já aparecem abaixo da resposta. Não use tabela.

Pergunta: ${safeText(message,1200)}
Critérios aplicados: ${JSON.stringify(context)}
Evidências calculadas pela aplicação: ${JSON.stringify(facts)}`;
  return geminiGenerate(prompt,{maxOutputTokens:1800,thinkingLevel:'MEDIUM'});
}
async function parseWithOpenAI(message,context,options){
  const sectors=safeList(options?.sectors,100), officers=safeList(options?.officers,120), sizes=safeList(options?.sizes,5);
  const schema={...criteriaSchema({sectors,officers,sizes}),additionalProperties:false};
  const instructions=`Você interpreta pedidos em português para um buscador de empresas brasileiro. Responda sempre chamando buscar_empresas. Preserve os critérios atuais em pedidos de continuação. Quando o usuário disser Corporate sem especificar Large, use Corporate e Large Corporate. Para prospecção, mantenha non_clients salvo se o usuário pedir clientes. Redondezas significa o raio atual ou 50 km. Use somente setores e officers das listas permitidas. Não invente informações sobre empresas.`;
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({
    model:OPENAI_MODEL,instructions,input:`Critérios atuais: ${JSON.stringify(context)}\nPedido do usuário: ${message}`,
    tools:[{type:'function',name:'buscar_empresas',description:'Converte o pedido em filtros de busca geográfica e comercial.',strict:true,parameters:schema}],
    tool_choice:{type:'function',name:'buscar_empresas'}
  })});
  const payload=await response.json();
  if(!response.ok) throw new Error(payload?.error?.message||'openai_error');
  const call=(payload.output||[]).find(item=>item.type==='function_call'&&item.name==='buscar_empresas');
  if(!call) throw new Error('missing_function_call');
  return JSON.parse(call.arguments);
}

const server=http.createServer(async(req,res)=>{
  const origin=req.headers.origin||'';
  const requestUrl=new URL(req.url||'/', 'http://localhost');
  const isSociosRoute=requestUrl.pathname.startsWith('/api/socios/');
  const isLinkedinRoute=requestUrl.pathname.startsWith('/api/linkedin/');
  if(req.method==='OPTIONS'&&(requestUrl.pathname==='/api/chat'||isSociosRoute||isLinkedinRoute)){
    if(origin&&!ALLOWED_ORIGINS.has(origin)) return json(res,403,{error:'origin_not_allowed'});
    res.writeHead(204,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'86400','Vary':'Origin'}); return res.end();
  }
  if(req.method==='GET'&&requestUrl.pathname==='/health'){
    if(origin&&!ALLOWED_ORIGINS.has(origin)) return json(res,403,{error:'origin_not_allowed'});
    return json(res,200,{ok:true,aiConfigured:Boolean(selectedProvider()),provider:selectedProvider()||'local',linkedinConfigured:Boolean(process.env.LUSHA_API_KEY)},origin);
  }
  if(req.method==='GET'&&isSociosRoute){
    if(origin&&!ALLOWED_ORIGINS.has(origin)) return json(res,403,{error:'origin_not_allowed'});
    const cnpj=decodeURIComponent(requestUrl.pathname.slice('/api/socios/'.length));
    try{
      const result=await sociosService.get(cnpj);
      return json(res,200,result,origin);
    }catch(error){
      const message=String(error?.message||'');
      if(message==='invalid_cnpj') return json(res,400,{error:'invalid_cnpj'},origin);
      console.error('socios_error',message||error);
      return json(res,502,{error:'socios_unavailable'},origin);
    }
  }
  if(req.method==='GET'&&isLinkedinRoute){
    if(origin&&!ALLOWED_ORIGINS.has(origin)) return json(res,403,{error:'origin_not_allowed'});
    if(!process.env.LUSHA_API_KEY) return json(res,503,{error:'lusha_not_configured'},origin);
    const cnpj=decodeURIComponent(requestUrl.pathname.slice('/api/linkedin/'.length));
    const nome=requestUrl.searchParams.get('nome')||'';
    const dominio=requestUrl.searchParams.get('dominio')||'';
    try{
      const result=await lushaService.findLinkedin({cnpj,nome,dominio});
      return json(res,200,result,origin);
    }catch(error){
      const message=String(error?.message||'');
      if(message==='invalid_cnpj') return json(res,400,{error:'invalid_cnpj'},origin);
      if(message==='missing_query') return json(res,400,{error:'missing_query'},origin);
      if(message==='lusha_not_configured') return json(res,503,{error:'lusha_not_configured'},origin);
      console.error('lusha_error',message||error);
      return json(res,502,{error:'lusha_unavailable'},origin);
    }
  }
  if(req.method!=='POST'||requestUrl.pathname!=='/api/chat') return json(res,404,{error:'not_found'});
  if(origin&&!ALLOWED_ORIGINS.has(origin)) return json(res,403,{error:'origin_not_allowed'});
  const provider=selectedProvider();
  if(!provider) return json(res,503,{error:'ai_not_configured'},origin);
  try{
    const body=await readBody(req); const message=String(body.message||'').trim();
    if(!message||message.length>1200) return json(res,400,{error:'invalid_message'},origin);
    const context=cleanContext(body.context);
    if(body.mode==='explain'){
      const facts=cleanFacts(body.facts);
      const answer=provider==='gemini'
        ? await explainWithGemini(message,context,facts)
        : '';
      if(!answer) return json(res,503,{error:'generative_explanation_not_configured'},origin);
      return json(res,200,{answer,provider},origin);
    }
    const criteria=provider==='gemini'
      ? await parseWithGemini(message,context,body.options||{})
      : await parseWithOpenAI(message,context,body.options||{});
    return json(res,200,{criteria,provider},origin);
  }catch(error){
    console.error('assistant_error',error?.message||error);
    return json(res,502,{error:'assistant_unavailable'},origin);
  }
});
export { cleanContext, cleanFacts, geminiContentText, interactionText, safeList, selectedProvider, server };

if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href){
  server.listen(PORT,'0.0.0.0',()=>console.log(`Commercial assistant listening on ${PORT}`));
}
