import {styleReferences,learningReferences} from './research/database.mjs';
import {ensureMall} from './vmall.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {config,ROOT} from './config.mjs';
import {completeJson} from './llm.mjs';
import {PLATFORMS,strategyFor,inputRisks,validateDraft,validateAudit,articleText} from './rules.mjs';
const systemPrompt=fs.readFileSync(path.join(ROOT,'prompts/system.md'),'utf8');
const outputSchema={
  blocked:false,block_reason:'',
  strategy:{angle:'具体内容切入点',priorities:['卖点优先级'],reason:'为什么适合该人群、场景和平台'},
  article:{title:'标题',intro:'导语或海报副标题',sections:[{heading:'小标题或短卖点',text:'自然正文，不在文中显示内部来源ID',source_ids:['F01']}],cta:'符合平台的行动引导',tags:['仅小红书使用话题，其余平台空数组']},
  claims:[{text:'正文中实际出现的可核对产品断言',source_ids:['F01']}],
  image_plan:[{image_id:'I01',position:'封面 / 第N段后',after_section:0,caption:'只描述可见内容',reason:'在此处的作用'}],
  limitations:['待确认事项与内容使用条件'],
};
export function attachOriginalEvidence(draft,context) {
  if(!Array.isArray(draft?.claims))return draft;
  const facts=new Map(context.facts.map(f=>[f.id,f]));
  for(const claim of draft.claims) {
    if(!claim || typeof claim!=='object')continue;
    const ids=Array.isArray(claim.source_ids)?claim.source_ids:Array.isArray(claim.evidence)?claim.evidence.map(e=>e.source_id):[];
    claim.evidence=[...new Set(ids)].map(id=>({source_id:id,quote:facts.get(id)?.content || ''}));
  }
  return draft;
}
function contextForModel(context) {
  return {product:context.product,facts:context.facts,sources:context.sources,mall:context.mall,images:context.images.map(({id,name,model,description,usage,sourceKind,artworkGroup})=>({id,name,model,description,usage,sourceKind,artworkGroup})),customerNeeds:context.customerNeeds || {concerns:[],revisionHints:[]},researchReferences:context.researchReferences || [],recentImageNames:context.recentImageNames || [],sourceDate:context.source.snapshotDate,warnings:context.warnings,guide:context.guide.slice(0,6000)};
}
const auditPrompt=`你是证据审核员。根据提供的facts审核draft全部产品断言：标题、导语、正文、CTA、图注都要检查，不能只看claims。
1. 每条claims是否被对应原文支持？数值、型号、系统版本和重要限制必须对应。无依据的功能、续航、软件兼容性和性能承诺记为unsupported；无法判断记uncertain。
2. 正文是否还有claims未列出的无依据断言？是否包含虚构价格、优惠、销量、用户评价、亲测或绝对化承诺？只有确实存在的错误才列入issues。
3. 内部审核备注的措辞问题可记note，不是事实错误。不要因为有提醒而将有依据的事实判成unsupported。不审核文采、段数、图片数量、字数或标签，这些由程序检查。用户的需求或“选购前请确认适配”的建议，不等于产品已经具备该功能。不要将建议当成承诺，也不要为原文未涉及的使用条件自行增设限制。
4. issues只写需要改正的真实问题。通过的项目不写入issues，不写审核过程、矛盾判断或先否定后肯定。issues可以为空。发布前素材授权等提醒可作为severity=note。
返回合法JSON：{"claim_checks":[{"index":1,"status":"supported","reason":"简短说明原文支持或不支持之处"}],"issues":[{"scope":"facts","severity":"error","message":"具体错误原句和缺少的依据"}]}。
claim_checks覆盖所有claims，各index只出现一次。status只能supported、unsupported、uncertain；scope只能facts、compliance、images；severity只能error或note。不能在reason说无法确认，却标记supported。`;
export async function runAgent(kb,task,{id,progress,revision=null}) {
  const started=Date.now();
  const events=[],usage=[];
  const emit=(phase,label,percent)=>{const ev={phase,label,percent,at:new Date().toISOString()};events.push(ev);progress(ev);};
  emit('understand','解析人群、场景与平台策略',8);
  const strategy=strategyFor(task);
  const risks=inputRisks(task);
  emit('retrieve','检索本地产品事实与同型号图片',18);
  await ensureMall().catch(()=>null);
  const context=kb.retrieve(task.productId,task.platform);
  context.catalogNames=kb.catalog().map(p=>p.name);
  context.researchReferences=styleReferences(task.platform);
  context.customerNeeds=learningReferences(task);
  const recentNames=new Set();
  if(fs.existsSync(config.cacheDir))for(const file of fs.readdirSync(config.cacheDir).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).slice(-8)){
    try{const previous=JSON.parse(fs.readFileSync(path.join(config.cacheDir,file),'utf8'));if(previous.product?.id===task.productId)for(const image of previous.imagePlan || [])recentNames.add(image.name);}catch{}
  }
  context.images.sort((a,b)=>Number(recentNames.has(a.name))-Number(recentNames.has(b.name)));
  context.recentImageNames=[...recentNames];
  if(!context.facts.length) throw Object.assign(new Error('当前型号没有可用产品事实，已停止生成。'),{status:422});
  const target=PLATFORMS[task.platform];
  const gap=Math.max(0,target.minImages-context.images.length);
  if(gap) context.warnings.push(target.label+'建议至少'+target.minImages+'张图，当前同型号仅'+context.images.length+'张，仍缺'+gap+'张；不会重复或跨型号补图。');
  const payload={task,initialStrategy:strategy,platformRules:target,context:contextForModel(context),inputRiskNotes:risks,outputSchema,
    instructions:'输出一份可用的营销图文。正文篇幅 '+target.minChars+'—'+target.maxChars+' 字，图数 '+Math.min(context.images.length,target.minImages)+'—'+Math.min(context.images.length,target.maxImages)+'。source_ids只能引用当前 facts；claims只需选择对应source_ids，后端会附加未经改写的原文证据。正文集中2—4个核心卖点，claims最多8项，避免参数堆叠。sections每段必须包含有依据的产品事实及对应source_ids；纯提问或任务建议放intro/cta，不能硬挂无关来源。内部审核备注只写limitations，不写进正文。',
    revision:revision?{instruction:revision.instruction,previous:revision.previous.article}:null};
  let draft=null, audit=null, finalIssues=[],repairNotes=[],model=config.model, calls=0;
  for(let attempt=0;attempt<2;attempt++) {
    emit(attempt?'repair':'generate',attempt?'根据核验问题修正文案':'编排图文并生成文案',attempt?66:34);
    const messages=[{role:'system',content:systemPrompt},{role:'user',content:JSON.stringify(payload)}];
    if(attempt) messages.push({role:'assistant',content:JSON.stringify(draft)},{role:'user',content:JSON.stringify({correctionRequired:finalIssues,instruction:'修复所有问题后返回完整JSON。删去无依据断言并保留可用事实，不得伪造证据。'})});
    const generated=await completeJson(messages,{maxTokens:task.platform==='wechat'?5800:4500});
    calls+=generated.requestCount;usage.push(generated.usage);model=generated.model;draft=attachOriginalEvidence(generated.value,context);
    if(task.platform!=='xiaohongshu' && draft?.article && Array.isArray(draft.article.tags) && draft.article.tags.length) {draft.article.tags=[];repairNotes.push('根据目标平台规则移除话题标签。');}
    if(draft.blocked===true) {finalIssues=[{scope:'facts',code:'source_conflict',message:typeof draft.block_reason==='string'?draft.block_reason:'产品信息存在无法确认的冲突'}];break;}
    let deterministic=validateDraft(draft,context,task);
    if(deterministic.some(i=>i.code==='schema')) {
      finalIssues=deterministic;repairNotes.push(...deterministic.map(i=>i.message));continue;
    }
    emit('verify',attempt?'复核修正后的事实、图片与合规':'独立核对事实、图片和营销合规',attempt?85:52);
    const checked=await completeJson([{role:'system',content:auditPrompt},{role:'user',content:JSON.stringify({facts:context.facts,images:contextForModel(context).images,product:context.product,draft:{...draft,claims:draft.claims.map(({text,source_ids,evidence})=>({text,source_ids:source_ids || evidence.map(e=>e.source_id)}))}})}],{maxTokens:3500});
    calls+=checked.requestCount;usage.push(checked.usage);audit=checked.value;
    let reviewed;
    try {reviewed=validateAudit(audit,draft);}catch{reviewed=[{scope:'facts',code:'audit_incomplete',message:'独立事实核验未完整返回，不能标记通过。'}];}
    finalIssues=[...deterministic,...reviewed];
    if(!finalIssues.length)break;
    repairNotes.push(...finalIssues.map(i=>i.message));
  }
  const blocked=finalIssues.length>0;
  const warnings=[...new Set([...context.warnings,...risks,...(Array.isArray(audit?.issues)?audit.issues:[]).filter(i=>i.severity==='note').map(i=>i.message),...(Array.isArray(draft?.limitations)?draft.limitations.filter(s=>typeof s==='string'):[])])];
  emit(blocked?'blocked':'complete',blocked?'仍有待确认问题，已阻止交付正文':'核验完成，内容可预览与导出',100);
  const checks=[
    {name:'产品事实',status:blocked?'pending':'passed',detail:blocked?'稿件尚未完成全部检查，不能作为已核验内容使用。':draft.claims.length+'项产品事实已定位原文，并由模型复核；依据为本地快照。'},
    {name:'图片型号',status:context.images.length?'passed':'pending',detail:'按本地索引核对型号与文件存在性；未进行视觉识别或授权审查。'},
    {name:'配图完整度',status:gap?'pending':context.images.length?'passed':'pending',detail:gap?'缺'+gap+'张符合平台数量要求的同型号图片。':'可用图片数量满足平台要求。'},
    {name:'营销合规',status:blocked?'pending':'passed',detail:blocked?'稿件存在待处理问题。':'已执行关键词规则与模型审核，发布前仍需人工复核。'},
  ];
  const result={id,createdAt:new Date().toISOString(),mode:'gpt-vmall',model,task,product:context.product,platform:target.label,status:blocked?'blocked':warnings.length?'ready_with_notes':'ready',
    strategy:blocked?{...strategy,reason:'稿件尚未通过全部核验，显示初步内容策略。'}:draft.strategy,initialStrategy:strategy,article:blocked?null:draft.article,
    claims:blocked?[]:draft.claims.map((claim,i)=>({...claim,index:i+1,review:audit?.claim_checks?.find(c=>c.index===i+1)})),
    imagePlan:blocked?[]:draft.image_plan.map(item=>({...context.images.find(im=>im.id===item.image_id),image_id:item.image_id,position:item.position,after_section:item.after_section,caption:item.caption,reason:item.reason})),
    customerNeeds:context.customerNeeds,researchReferences:context.researchReferences,evidence:{source:context.source,facts:context.facts,images:context.images,sources:context.sources,mall:context.mall},checks,warnings,issues:finalIssues,repairs:[...new Set(repairNotes)],events,
    telemetry:{durationSeconds:Math.round((Date.now()-started)/100)/10,modelCalls:calls,promptTokens:usage.reduce((a,b)=>a+(b.prompt_tokens||0),0),completionTokens:usage.reduce((a,b)=>a+(b.completion_tokens||0),0)},revisionOf:revision?.parentId || null};
  fs.mkdirSync(config.cacheDir,{recursive:true});
  fs.writeFileSync(path.join(config.cacheDir,id+'.json'),JSON.stringify(result,null,2),'utf8');
  return result;
}
export function exportMarkdown(result) {
  if(!result.article)throw Object.assign(new Error('未通过检查的正文不能导出。'),{status:409});
  const a=result.article;
  const renderImages=after=>result.imagePlan.filter(im=>im.after_section===after).map(im=>'!['+im.caption+']('+im.originalUrl+')\n\n*'+im.caption+' · '+im.position+'*').join('\n\n');
  const content=[
    '### '+a.title,a.intro,renderImages(0),
    ...a.sections.flatMap((s,i)=>['### '+s.heading,s.text,renderImages(i+1)]),
    a.cta,a.tags.join(' '),
  ].filter(Boolean).join('\n\n');
  const researchSources=result.researchReferences?.length?'\n\n## 五、表达研究参考\n\n'+result.researchReferences.map(r=>'- 报告 '+r.id+'（'+r.createdAt+'）：'+r.report.summary+'\n'+(r.sources||[]).map(source=>'  - '+source.title+'：'+source.url).join('\n')).join('\n')+'\n\n以上为创作假设，不是产品事实或流量效果证明。\n':'';
  const imageSources=result.imagePlan.map(im=>'- **'+im.name+'**（'+im.position+'）\n  - 来源：'+(im.sourceName || '本地知识库图片索引')+'\n  - 原始页面：'+im.pageUrl+'\n  - 用途：'+im.reason).join('\n');
  return '# '+a.title+'\n\n## 一、场景判断\n\n- 人群：'+result.task.audience+'\n- 场景：'+result.task.scene+'\n- 用户问题与目标：'+result.task.goal+'\n- 购买阶段：'+result.task.purchaseStage+'\n- 平台：'+result.platform+'\n- 切入点：'+result.strategy.angle+'\n\n## 二、知识库依据\n\n- 型号：'+result.product.name+'\n- 资料：'+result.evidence.source.path+'\n- 快照日期：'+result.evidence.source.snapshotDate+'\n- 原文 SHA256：'+result.evidence.source.sha256+'\n\n'+result.claims.map(c=>'- '+c.text+'\n'+c.evidence.map(e=>'  - ['+e.source_id+'] '+e.quote).join('\n')).join('\n')+'\n\n## 三、图文软文\n\n'+content+'\n\n### 配图来源索引\n\n'+imageSources+'\n\n## 四、核验结果与待确认项\n\n'+result.checks.map(c=>'- '+c.name+'：'+(c.status==='passed'?'已检查':'待确认')+'；'+c.detail).join('\n')+'\n\n'+result.warnings.map(w=>'- '+w).join('\n')+'\n\n核验记录：'+result.createdAt+'；模型：'+result.model+'。本地资料未实时联网更新，发布前须人工复核。\n'+researchSources;
}
export {articleText};
