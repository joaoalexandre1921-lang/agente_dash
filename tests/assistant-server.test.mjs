import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanContext, cleanFacts, geminiContentText, interactionText, safeList } from '../assistant-server.mjs';

test('assistant context accepts only the bounded structured search state', () => {
  const context=cleanContext({
    city:'Carlos Barbosa',state:'RS',radiusKm:'80',sizes:['Corporate','Large Corporate','Middle','extra'],
    sectors:Array.from({length:30},(_,i)=>`Setor ${i}`),clientStatus:'non_clients',officerStatus:'unassigned',
    officers:['Officer A'],limit:'20',ignored:'must not pass'
  });
  assert.deepEqual(context,{
    city:'Carlos Barbosa',state:'RS',radiusKm:80,sizes:['Corporate','Large Corporate','Middle'],
    sectors:Array.from({length:20},(_,i)=>`Setor ${i}`),clientStatus:'non_clients',officerStatus:'unassigned',
    officers:['Officer A'],limit:20
  });
  assert.equal('ignored' in context,false);
});

test('assistant option lists are length and value bounded', () => {
  assert.deepEqual(safeList(['a',42,null],2),['a','42']);
  assert.equal(safeList(['x'.repeat(150)])[0].length,100);
  assert.deepEqual(safeList('not an array'),[]);
});

test('generative analysis receives only bounded calculated facts', () => {
  const facts=cleanFacts({
    total:'128',withoutOfficer:120,clients:8,risks:3,
    topCities:Array.from({length:20},(_,i)=>({label:`Cidade ${i}`,count:i+1,ignored:'x'})),
    topSectors:[{label:'Indústria',count:50}],sizes:[{label:'Corporate',count:100}],
    candidates:Array.from({length:15},(_,i)=>({name:`Empresa ${i}`,city:'Carlos Barbosa',state:'RS',sector:'Indústria',size:'Corporate',distanceKm:i,risk:i===0,secret:'remove'})),
    rawCompanies:'must not pass'
  });
  assert.equal(facts.total,128);
  assert.equal(facts.topCities.length,10);
  assert.equal(facts.candidates.length,10);
  assert.equal(facts.candidates[0].risk,true);
  assert.equal('secret' in facts.candidates[0],false);
  assert.equal('rawCompanies' in facts,false);
});

test('reads only textual model output from Gemini Interactions responses', () => {
  const text=interactionText({steps:[
    {type:'thought',content:[{type:'text',text:'internal'}]},
    {type:'model_output',content:[{type:'text',text:'Primeira parte. '},{type:'image',data:'ignored'},{type:'text',text:'Segunda parte.'}]}
  ]});
  assert.equal(text,'Primeira parte. Segunda parte.');
});

test('reads textual output from Gemini GenerateContent responses', () => {
  assert.equal(geminiContentText({candidates:[{content:{parts:[{text:'Resposta '},{text:'Gemini'}]}}]}),'Resposta Gemini');
  assert.equal(geminiContentText({candidates:[]}), '');
});
