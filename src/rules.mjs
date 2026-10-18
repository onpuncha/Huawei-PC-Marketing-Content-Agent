export const PLATFORMS = {
  xiaohongshu:{label:'小红书',minImages:3,maxImages:6,minChars:240,maxChars:700,structure:'场景型标题、短导语、3—5个短段落、选购建议、评论互动引导、3—6个话题；不用虚构第一人称体验。',tone:'口语、具体、轻松，适当使用少量emoji',cta:'邀请读者留言具体需求或到店体验，不编造联系方式'},
  wechat:{label:'公众号',minImages:2,maxImages:4,minChars:550,maxChars:1400,structure:'标题、导语、3—5个有小标题的论述段、选购边界、结尾行动引导；保持完整叙事。',tone:'清楚、有条理、可信，不堆参数',cta:'引导了解具体销售配置或预约门店体验'},
  moments:{label:'门店朋友圈',minImages:1,maxImages:3,minChars:60,maxChars:220,structure:'简短标题或首句、一个核心卖点、一段具体场景、简短咨询或到店引导；正文最多2段。',tone:'自然、简洁、像门店导购在沟通',cta:'邀请私信说明需求或到店试用，不虚构地址、电话、活动'},
  poster:{label:'门店海报',minImages:1,maxImages:1,minChars:30,maxChars:150,structure:'主标题、副标题、3个以内短卖点、明确行动引导。没有经核验活动信息时不写促销。',tone:'短句、醒目、易读',cta:'到店体验或咨询配置'},
};
const SCENES = [
  {pattern:/开学|新生|学生|学习|校园/,angle:'从一天的学习动线出发：课堂记录、图书馆查资料和宿舍整理作业',priorities:['便携与携带条件','学习文档与屏幕阅读','系统和课程软件适配'],questions:['课程必需软件能否在所选系统运行？','每天需要携带多长时间？']},
  {pattern:/出差|移动|商务|职场|办公|会议/,angle:'从差旅与会议衔接出发：路上整理资料、会议展示、回到工位继续协作',priorities:['便携和连接方式','屏幕与文档处理','会议、系统与跨设备条件'],questions:['常用会议和办公软件是什么？','需要连接哪些显示器或外设？']},
  {pattern:/摄影|创作|视频|设计|剪辑/,angle:'从素材到交付的创作流程出发，明确软件与配置适用边界',priorities:['屏幕与色彩条件','处理器和内存配置','接口与素材流转'],questions:['具体使用哪款创作软件？','素材规格与项目规模是什么？']},
  {pattern:/企业|采购|团队/,angle:'围绕团队工作任务和部署适配，提供可验证的选型依据',priorities:['系统与软件适配','配置及接口一致性','服务政策需人工确认'],questions:['团队使用哪些业务系统？','部署和售后要求是什么？']},
  {pattern:/家庭|换新|父母/,angle:'从家庭日常使用与旧机换新出发，关注易用性和数据迁移的确认事项',priorities:['常用任务与系统','屏幕与输入体验','迁移与使用条件'],questions:['原电脑使用什么系统？','需要迁移哪些资料与软件？']},
];
export function strategyFor(task) {
  const scene=SCENES.find(s=>s.pattern.test(task.scene+' '+task.audience));
  return {audience:task.audience,scene:task.scene,goal:task.goal || '帮助了解产品并引导咨询',purchaseStage:task.purchaseStage || '了解与比较',angle:scene?.angle || '围绕用户实际任务组织产品信息，突出一个具体问题',priorities:scene?.priorities || ['任务适配','有依据的产品特点','选购前需确认的条件'],questions:scene?.questions || ['当前最想解决的使用问题是什么？'],platform:PLATFORMS[task.platform].label};
}
export function normalizeTask(input) {
  const fields={productId:100,audience:200,scene:200,platform:30,goal:300,purchaseStage:100,requirements:1800};
  const task={};
  for(const [key,max] of Object.entries(fields)) {
    if(input[key]!==undefined && typeof input[key]!=='string')throw Object.assign(new Error('任务字段必须为文本'),{status:400});
    task[key]=(input[key] || '').trim().slice(0,max);
  }
  const questions=[];
  if(!task.productId) questions.push('请选择明确的产品型号，避免把相近型号混在一起。');
  if(!task.audience) questions.push('这篇内容面向谁？例如大学新生、经常出差的职场人士。');
  if(!task.scene) questions.push('要解决什么场景的问题？例如开学购机、移动办公。');
  if(!PLATFORMS[task.platform]) questions.push('请选择发布渠道：小红书、公众号、朋友圈或海报。');
  return {task,questions};
}
export function inputRisks(task) {
  const text=(task.requirements+' '+task.goal).replace(/(?:不写|不要写|不提供|不包含|不涉及|不编造|不虚构)(?:具体)?(?:价格|补贴|优惠|库存|赠品)/g,'');
  const risks=[];
  if(/价格|补贴|优惠|库存|赠品|[¥￥]|\d+元|折扣/.test(text)) risks.push('本地资料属于历史快照；价格、补贴、库存和赠品不进入当前成稿，改为咨询实际销售信息。');
  if(/全网第一|绝对|永不|百分之百|100%不卡|最强|碾压|吊打|终身免费/.test(text)) risks.push('附加要求包含绝对化或无依据承诺，生成时需删除或改写。');
  return risks;
}
export const SYSTEM_PROMPT_FILE='prompts/system.md';
export function articleText(draft) {
  return [draft?.article?.title,draft?.article?.intro,...(draft?.article?.sections || []).flatMap(s=>[s.heading,s.text]),draft?.article?.cta,...(draft?.article?.tags || [])].filter(Boolean).join('\n\n');
}
const normalize=text=>String(text).replace(/\s+/g,'').replace(/\u200b/g,'');
const issue=(code,message,scope='content')=>({code,message,scope});
export function validateDraft(draft,context,task) {
  const issues=[];
  if(!draft || typeof draft!=='object' || Array.isArray(draft)) return [issue('schema','模型未返回内容对象')];
  const a=draft.article;
  if(!a || typeof a.title!=='string' || !a.title.trim() || typeof a.intro!=='string' || typeof a.cta!=='string' || !a.cta.trim()
    || !Array.isArray(a.sections) || !a.sections.length || a.sections.some(s=>!s || typeof s.heading!=='string' || typeof s.text!=='string' || !s.text.trim() || !Array.isArray(s.source_ids))
    || !Array.isArray(a.tags) || a.tags.some(s=>typeof s!=='string')) return [issue('schema','标题、导语、段落、来源标记、行动引导或标签格式不完整')];
  if(!draft.strategy || ['angle','reason'].some(k=>typeof draft.strategy[k]!=='string' || !draft.strategy[k].trim()) || !Array.isArray(draft.strategy.priorities) || draft.strategy.priorities.some(x=>typeof x!=='string')) issues.push(issue('schema','缺少内容切入点和可解释策略'));
  if(!Array.isArray(draft.claims) || !draft.claims.length) issues.push(issue('claims','缺少可逐项核对的产品事实清单','facts'));
  const sources=new Map(context.facts.map(f=>[f.id,f]));
  for(const [idx,claim] of (Array.isArray(draft.claims)?draft.claims:[]).entries()) {
    if(!claim || typeof claim.text!=='string' || !claim.text || !Array.isArray(claim.evidence) || !claim.evidence.length) {issues.push(issue('claim_evidence','事实 '+(idx+1)+' 缺少原文证据','facts'));continue;}
    for(const ev of claim.evidence) {
      const fact=sources.get(ev?.source_id);
      if(!fact || typeof ev.quote!=='string' || normalize(ev.quote).length<6 || !normalize(fact.content).includes(normalize(ev.quote))) issues.push(issue('quote_mismatch','事实 '+(idx+1)+' 的引用片段无法在对应资料中逐字定位','facts'));
    }
  }
  for(const section of a.sections) {
    if(!section.source_ids.length || section.source_ids.some(id=>!sources.has(id))) issues.push(issue('section_source','段落“'+section.heading+'”缺少有效事实来源','facts'));
  }
  const text=articleText(draft);
  if(/全网第一|绝对不卡|永不卡顿|永不掉线|保证不卡|最强|碾压|吊打|行业第一|全球第一|百分之百|终身免费|销量冠军|销量第一/.test(text)) issues.push(issue('absolute','内容包含绝对化表述或无依据排名','compliance'));
  if(/(?:[￥¥]\s*\d|\d[\d,.]*\s*元|补贴\s*\d|立减\s*\d|[1-9](?:\.\d)?折|仅剩\s*\d|限量\s*\d|赠送|免费送)/.test(text)) issues.push(issue('dynamic','包含未经实时确认的价格、优惠或库存承诺','compliance'));
  if(/亲测|我用了|我用过|用了一个月|用了半年|实测续航|用户一致好评|大家都说/.test(text)) issues.push(issue('fake_experience','不得伪造亲身使用、测试或用户评价','compliance'));
  const catalogNames=context.catalogNames || [];
  if(catalogNames.some(n=>n!==context.product.name && n.length>8 && text.includes(n))) issues.push(issue('mixed_model','正文混入了其他型号完整名称','facts'));
  if(/\b\d{2,}(?:\.\d+)?\s*mm\b/i.test(text) && context.warnings.some(w=>w.includes('尺寸字段'))) issues.push(issue('suspect_dimension','使用了已隔离的可疑尺寸参数','facts'));
  const imageMap=new Map(context.images.map(im=>[im.id,im]));
  if(!Array.isArray(draft.image_plan)) issues.push(issue('image_schema','缺少配图方案','images'));
  else {
    const seen=new Set();
    for(const im of draft.image_plan) {
      if(!im || !imageMap.has(im.image_id) || seen.has(im.image_id) || typeof im.position!=='string' || !im.position || typeof im.caption!=='string' || !im.caption || typeof im.reason!=='string' || !Number.isInteger(im.after_section) || im.after_section<0 || im.after_section>a.sections.length) issues.push(issue('image_reference','配图必须来自当前型号索引、不可重复，且需图注、用途和位置','images'));
      seen.add(im?.image_id);
    }
    if(context.images.some(im=>im.sourceKind==='vmall') && !draft.image_plan.some(im=>imageMap.get(im?.image_id)?.sourceKind==='vmall'))issues.push(issue('mall_source','当前型号有商城图片，请至少使用一张并保留来源。','images'));
    const groups=draft.image_plan.map(im=>imageMap.get(im?.image_id)?.artworkGroup).filter(Boolean);
    if(new Set(groups).size!==groups.length)issues.push(issue('duplicate_artwork','不允许用同组素材的不同裁切重复配图。','images'));
    const p=PLATFORMS[task.platform];
    const min=Math.min(p.minImages,context.images.length), max=Math.min(p.maxImages,context.images.length);
    if(draft.image_plan.length<min || draft.image_plan.length>max) issues.push(issue('image_count','配图数量不符合平台要求及实际可用图片数量','images'));
  }
  const platform=PLATFORMS[task.platform];
  const mainText=[a.intro,...a.sections.map(s=>s.text),a.cta].join('');
  if(mainText.length>platform.maxChars*1.3 || mainText.length<platform.minChars*0.65) issues.push(issue('platform_length','正文长度不符合'+platform.label+'的篇幅要求','platform'));
  if(task.platform==='moments' && a.sections.length>2) issues.push(issue('platform_structure','朋友圈应围绕一个卖点，正文最多2段','platform'));
  if(task.platform==='poster' && a.sections.length>3) issues.push(issue('platform_structure','海报最多3个卖点','platform'));
  if(task.platform==='xiaohongshu' && (a.tags.length<3 || a.tags.length>6)) issues.push(issue('platform_tags','小红书需3—6个相关话题','platform'));
  if(task.platform!=='xiaohongshu' && a.tags.length) issues.push(issue('platform_tags','当前平台不需要小红书式话题标签','platform'));
  return issues;
}
export function validateAudit(audit,draft) {
  if(!audit || !Array.isArray(audit.claim_checks) || !Array.isArray(audit.issues)) throw new Error('核验模型返回的检查格式不完整');
  const expected=draft.claims.map((_,i)=>i+1);
  const seen=new Set();
  for(const item of audit.claim_checks) {
    if(!expected.includes(item.index) || seen.has(item.index) || !['supported','unsupported','uncertain'].includes(item.status) || typeof item.reason!=='string')throw new Error('事实核验记录无效');
    seen.add(item.index);
  }
  if(seen.size!==expected.length) throw new Error('事实核验未覆盖全部事实');
  const issues=[];
  for(const item of audit.issues) {
    if(!item || typeof item.message!=='string' || !['facts','compliance','platform','images'].includes(item.scope) || !['error','note'].includes(item.severity))throw new Error('核验问题格式无效');
    if(item.severity==='error')issues.push(issue('model_review',item.message,item.scope));
  }
  for(const item of audit.claim_checks) if(item.status!=='supported') issues.push(issue('claim_review','事实 '+item.index+'：'+item.reason,'facts'));
  return issues;
}
