import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import {LocalKnowledge,parseCsv,extractSections,resolveInside} from '../src/kb-local.mjs';
import {normalizeTask,strategyFor,validateDraft,validateAudit,inputRisks} from '../src/rules.mjs';
import {exportMarkdown} from '../src/agent.mjs';
const kb=new LocalKnowledge();
function fixture() {
  const product=kb.catalog().find(p=>p.name==='HUAWEI MateBook D 14 2024');
  const context=kb.retrieve(product.id,'moments');
  const fact=context.facts.find(f=>f.title==='操作系统');
  const task={productId:product.id,audience:'大学新生',scene:'开学购机',platform:'moments',goal:'引导咨询'};
  const draft={strategy:{angle:'学习场景',priorities:['系统'],reason:'学生先确认软件适配'},article:{title:'开学选电脑，先看自己的课程',intro:'选电脑之前，不妨先列出课堂记录、查资料和完成作业这些日常任务。',sections:[{heading:'系统先确认',text:'这款产品提供 Windows 11 家庭版与 Linux V20 版。选购前，建议确认课程常用软件与具体销售版本的适配情况。',source_ids:[fact.id]}],cta:'欢迎到店了解具体配置。',tags:[]},claims:[{text:'提供 Windows 11 家庭版与 Linux V20 版',evidence:[{source_id:fact.id,quote:fact.content}]}],image_plan:[{image_id:context.images[0].id,position:'封面',after_section:0,caption:'官方产品外观',reason:'展示外观'}],limitations:[]};
  return {task,context,draft};
}
test('CSV handles quotes, commas, embedded newlines and BOM',()=>{
  const rows=parseCsv('\uFEFF名称,说明\r\n型号,"a,b"\r\n例子,"多行\n及""引号"""\r\n');
  assert.deepEqual(rows,[{名称:'型号',说明:'a,b'},{名称:'例子',说明:'多行\n及"引号"'}]);
});
test('ten explicit models resolve independently with only matching image assets',()=>{
  assert.equal(kb.error,'');assert.equal(kb.catalog().length,10);
  const ids=new Set();
  for(const p of kb.catalog()) {
    assert.ok(!ids.has(p.id));ids.add(p.id);
    const r=kb.retrieve(p.id,'xiaohongshu');assert.ok(r.facts.length);assert.ok(r.images.length);
    for(const image of r.images){assert.equal(image.model,p.name);assert.ok(image.available);}
  }
});
test('suspicious dimensions removed while retaining weight and limitations',()=>{
  const {facts,warnings}=extractSections('## 尺寸与重量\n长度\n\n13.5 mm\n\n厚度\n\n222 mm\n\n重量\n\n约 980 g\n\n*实际重量依配置而异。');
  assert.equal(warnings.length,1);assert.ok(facts[0].content.includes('约 980 g'));assert.ok(facts[0].content.includes('依配置'));assert.ok(!facts[0].content.includes('222 mm'));
});
test('incomplete tasks request specific fields',()=>{
  const {questions}=normalizeTask({audience:'学生'});assert.equal(questions.length,3);
  assert.throws(()=>normalizeTask({scene:{}}));
});
test('scene change produces a different strategy and priorities',()=>{
  const a=strategyFor({audience:'大学新生',scene:'开学购机',platform:'xiaohongshu'});
  const b=strategyFor({audience:'出差人士',scene:'移动办公',platform:'xiaohongshu'});
  assert.notEqual(a.angle,b.angle);assert.notDeepEqual(a.priorities,b.priorities);
});
test('valid grounded draft accepted; fabricated evidence is rejected',()=>{
  const {task,context,draft}=fixture();assert.deepEqual(validateDraft(draft,context,task),[]);
  draft.claims[0].evidence[0].quote='亲测续航100小时';
  assert.ok(validateDraft(draft,context,task).some(i=>i.code==='quote_mismatch'));
});
test('cross-model images, duplicate images, unsupported price and experience are rejected',()=>{
  const {task,context,draft}=fixture();draft.image_plan[0].image_id='OTHER_PRODUCT';draft.article.intro='亲测，全网第一，只要999元！';
  const codes=validateDraft(draft,context,task).map(i=>i.code);
  assert.ok(codes.includes('image_reference'));assert.ok(codes.includes('absolute'));assert.ok(codes.includes('dynamic'));assert.ok(codes.includes('fake_experience'));
});
test('review must cover all claims; no empty audit may be accepted',()=>{
  const {draft}=fixture();assert.throws(()=>validateAudit({claim_checks:[],issues:[]},draft));
  assert.deepEqual(validateAudit({claim_checks:[{index:1,status:'supported',reason:'与原文一致'}],issues:[]},draft),[]);
  assert.ok(validateAudit({claim_checks:[{index:1,status:'uncertain',reason:'缺少条件'}],issues:[]},draft).length);
});
test('path traversal outside the knowledge root is rejected',()=>{assert.throws(()=>resolveInside(kb.root,'../../../../package.json'));assert.throws(()=>resolveInside(kb.root,os.tmpdir()));});
test('unsafe dynamic request flagged; blocked result cannot be exported',()=>{
  assert.ok(inputRisks({requirements:'加入500元补贴，全网第一',goal:''}).length===2);
  assert.throws(()=>exportMarkdown({article:null}));
});

test('audit notes remain reminders, real unsupported facts block delivery',()=>{
  const {draft}=fixture();
  const checked={claim_checks:[{index:1,status:'supported',reason:'原文支持'}],issues:[{scope:'images',severity:'note',message:'发布前检查素材授权'}]};
  assert.deepEqual(validateAudit(checked,draft),[]);
  checked.issues.push({scope:'facts',severity:'error',message:'另一段虚构价格'});
  assert.equal(validateAudit(checked,draft).length,1);
});
test('platform image shortage permits available images without duplication',()=>{
  const {task,context,draft}=fixture();task.platform='xiaohongshu';context.images=context.images.slice(0,1);draft.article.tags=['#开学','#电脑','#选购'];
  draft.article.sections[0].text+='选购前可以列出每天需要完成的任务、常用软件以及携带需求，逐一核对自己的习惯。';
  assert.ok(!validateDraft(draft,context,task).some(i=>i.code==='image_count'));
  draft.image_plan.push({...draft.image_plan[0]});
  assert.ok(validateDraft(draft,context,task).some(i=>i.code==='image_reference'));
});

test('malformed model JSON is retried once; total usage includes both attempts',async()=>{
  const {completeJson,parseModelJson}=await import('../src/llm.mjs');
  const {config}=await import('../src/config.mjs');
  assert.deepEqual(parseModelJson('```json\n{"ok":true}\n```'),{ok:true});
  const previousFetch=global.fetch,previousKey=config.apiKey;
  config.apiKey='test-only-not-a-real-key';let calls=0;
  global.fetch=async()=>new Response(JSON.stringify({model:'test-model',status:'completed',output:[{type:'message',content:[{type:'output_text',text:++calls===1?'{bad JSON':'{"ok":true}'}]}],usage:{input_tokens:5,output_tokens:3,total_tokens:8}}),{status:200});
  try{const r=await completeJson([{role:'user',content:'test'}]);assert.deepEqual(r.value,{ok:true});assert.equal(r.requestCount,2);assert.equal(r.usage.total_tokens,16);}finally{global.fetch=previousFetch;config.apiKey=previousKey;}
});

test('evidence is attached from original files, and an unknown selection stays invalid',async()=>{
  const {attachOriginalEvidence}=await import('../src/agent.mjs');
  const {context,task,draft}=fixture();const id=context.facts[0].id;
  draft.claims=[{text:'系统选项',source_ids:[id]}];
  attachOriginalEvidence(draft,context);assert.equal(draft.claims[0].evidence[0].quote,context.facts[0].content);
  draft.claims=[{text:'虚构事实',source_ids:['FAKE']}];attachOriginalEvidence(draft,context);
  assert.ok(validateDraft(draft,context,task).some(i=>i.code==='quote_mismatch'));
});

test('Markdown images follow the same cover and paragraph positions as preview',()=>{
  const {task,context,draft}=fixture();
  const result={task,article:draft.article,product:context.product,strategy:draft.strategy,claims:draft.claims,evidence:{source:context.source},checks:[],warnings:[],platform:'门店朋友圈',createdAt:'2026-10-18',model:'test',imagePlan:[{...context.images[0],after_section:0,position:'封面',caption:'封面图片标记',reason:'展示外观'},{...context.images[1],after_section:1,position:'第一段后',caption:'段后图片标记',reason:'配合段落'}]};
  const markdown=exportMarkdown(result),article=markdown.split('## 三、图文软文')[1].split('## 四、')[0];
  assert.ok(article.indexOf('![封面图片标记]')<article.indexOf(draft.article.sections[0].text));
  assert.ok(article.indexOf('![段后图片标记]')>article.indexOf(draft.article.sections[0].text));
  assert.equal((article.match(/!\[/g)||[]).length,2);
  assert.ok(markdown.includes('\n\n## 一、场景判断'));
});
