'use strict';
const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const state={products:[],platform:'xiaohongshu',health:null,result:null,busy:false,tab:'preview',selectedEvidence:null,evidenceVersion:0};
const labels={xiaohongshu:'小红书',wechat:'公众号',douyin:'抖音脚本',weibo:'微博图文',moments:'门店朋友圈',poster:'门店海报'};
const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function safeLink(value) {try {const u=new URL(value);return u.protocol==='https:' && ['consumer.huawei.com','www.vmall.com','vmall.com','res.vmallres.com'].includes(u.hostname)?e(u.href):'#';}catch{return '#';}}
async function api(url,options={}) {
  const res=await fetch(url,{...options,headers:{'Content-Type':'application/json',...options.headers}});
  let value;try{value=await res.json();}catch{throw new Error('服务器返回格式异常，请确认服务仍在运行。');}
  if(!res.ok)throw Object.assign(new Error(value.error || '请求失败'),{questions:value.questions});
  return value;
}
function notify(message){$('#toast').textContent=message;$('#toast').classList.remove('hidden');clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('#toast').classList.add('hidden'),3500);}
function showError(message){$('#global-alert').textContent=message;$('#global-alert').classList.remove('hidden');}
function switchView(view) {
  $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  for(const key of ['workspace','library','history','research','learning'])$('#'+key+'-view').classList.toggle('hidden',key!==view);
  if(view==='research')window.loadResearch?.();
  if(view==='learning')window.loadLearning?.();
  if(view==='history')loadHistory();
  if(view==='library')renderLibrary();
}
function switchTab(tab) {
  state.tab=tab;
  $$('.editor-tab').forEach(button=>{button.classList.toggle('active',button.dataset.tab===tab);button.setAttribute('aria-selected',String(button.dataset.tab===tab));});
  for(const key of ['preview','strategy','checks'])$('#'+key+'-tab').classList.toggle('hidden',!state.result || key!==tab);
}
function selectPlatform(platform) {
  state.platform=platform;
  $$('.platform-option').forEach(button=>{button.classList.toggle('selected',button.dataset.platform===platform);button.setAttribute('aria-pressed',String(button.dataset.platform===platform));});
  if($('#product').value)loadEvidence($('#product').value);
  persistDraft();
}
function openDetail(title,html,footnote='') {
  $('#detail-title').textContent=title;
  $('#connection-details').innerHTML=html;
  $('#detail-footnote').textContent=footnote;
  $('#detail-footnote').classList.toggle('hidden',!footnote);
  $('#connection-dialog').showModal();
}
function warningSummary(warnings,compact=false) {
  if(!warnings?.length)return '';
  return '<details class="warning-summary'+(compact?' compact':'')+'"><summary>'+warnings.length+' 项资料或使用提醒 <span>展开查看</span></summary><ul>'+warnings.map(w=>'<li>'+e(w)+'</li>').join('')+'</ul>'+(compact?'':'<button type="button" class="text-button" data-show-checks>查看完整核验报告 ↗</button>')+'</details>';
}
function showImage(id,scope) {
  const context=scope==='result'?state.result:state.activeEvidence;
  const images=scope==='result'?context?.imagePlan:context?.images;
  const image=images?.find(im=>im.id===id);
  if(!image)return;
  const product=context.product;
  openDetail('图片与来源','<img class="image-detail" src="'+e(image.url)+'" alt="'+e(image.caption || image.description)+'"><dl class="image-metadata"><dt>对应型号</dt><dd>'+e(image.model || product.name)+'</dd><dt>图片文件</dt><dd>'+e(image.name)+'</dd><dt>索引说明</dt><dd>'+e(image.description)+'</dd><dt>本次用途</dt><dd>'+e(image.reason || image.usage || '尚未选入文案')+'</dd><dt>来源</dt><dd>'+e(image.sourceName || '本地知识库图片索引')+(image.width?' · '+e(image.width)+' × '+e(image.height)+' px':'')+'</dd></dl><div class="image-source-links"><a href="'+safeLink(image.pageUrl)+'" target="_blank" rel="noopener noreferrer">打开官方来源页 ↗</a><a href="'+safeLink(image.originalUrl)+'" target="_blank" rel="noopener noreferrer">查看原始图片地址 ↗</a></div>','来源依本地索引记录；画面内容与发布使用授权仍需人工确认。');
}
function renderEvidence(context) {
  state.activeEvidence=context;
  const source=context.source;
  const claims=state.result?.product.id===context.product.id?state.result.claims:[];
  const factMarkup=claims?.length?claims.slice(0,10).map(c=>'<div class="fact-item"><h4>事实 '+e(c.index)+'</h4><p>'+e(c.text)+'</p><details><summary>查看引用原文</summary>'+c.evidence.map(ev=>'<p>['+e(ev.source_id)+'] '+e(ev.quote)+'</p>').join('')+'</details></div>').join(''):context.facts.slice(0,5).map(f=>'<div class="fact-item"><h4>'+e(f.id)+' · '+e(f.title)+'</h4><details><summary>查看资料片段</summary><p>'+e(f.content)+'</p></details></div>').join('');
  $('#evidence-content').innerHTML='<div><div class="source-badge inline-badge">本地资料 + 商城</div><h3 class="evidence-source-title">'+e(context.product.name)+'</h3><div class="micro">资料快照 '+e(source.snapshotDate)+'<br>参数未实时联网更新</div><div class="source-links"><a href="/api/sources/'+e(context.product.id)+'" target="_blank" rel="noopener noreferrer">本地原文 ↗</a>'+(source.urls[1]?'<a href="'+safeLink(source.urls[1])+'" target="_blank" rel="noopener noreferrer">官方规格 ↗</a>':'')+'</div></div><hr class="evidence-divider"><div><h3 class="evidence-label">'+(claims?.length?'本次采用的产品事实':'可用产品事实 · '+context.facts.length+' 类')+'</h3>'+factMarkup+'</div><hr class="evidence-divider"><div><h3 class="evidence-label">同型号图片 · '+context.images.length+' 张 <span class="micro">点击查看来源</span></h3><div class="mini-image-grid">'+context.images.slice(0,10).map(im=>'<button type="button" class="mini-image-button" data-image="'+e(im.id)+'" data-image-scope="evidence" aria-label="查看图片 '+e(im.id)+' 与来源"><img src="'+e(im.url)+'" alt="'+e(im.description)+'" loading="lazy"><span>'+e(im.id)+' · '+e(im.sourceName || '本地')+' ↗</span></button>').join('')+'</div></div>'+(context.mall?.matched?'<div class="small-warning">华为商城已匹配：'+e(context.mall.productName)+'<br>读取时间：'+e(new Date(context.mall.fetchedAt).toLocaleString('zh-CN'))+'</div>':'')+warningSummary(context.warnings,true);
}
async function loadEvidence(id) {
  const version=++state.evidenceVersion;
  if(!id){$('#evidence-content').innerHTML='<div class="source-placeholder"><span>▤</span><p>选择明确型号，查看资料依据。</p></div>';return;}
  try {
    const context=await api('/api/evidence/'+encodeURIComponent(id)+'?platform='+state.platform);
    if(version!==state.evidenceVersion)return;
    state.selectedEvidence=context;
    const product=state.products.find(p=>p.id===id);
    $('#product-hint').textContent=product?.system || '已匹配本地产品事实';
    renderEvidence(context);
    persistDraft();
  }catch(err){if(version===state.evidenceVersion)showError(err.message);}
}
function figure(im){return '<figure class="article-figure"><button class="image-zoom" type="button" data-image="'+e(im.id)+'" data-image-scope="result" aria-label="查看配图与来源：'+e(im.caption)+'"><img src="'+e(im.url)+'" alt="'+e(im.caption)+'" loading="lazy"><span>查看大图与来源 ↗</span></button><figcaption>'+e(im.caption)+'<br>'+e(im.position)+' · '+e(im.sourceName || '本地知识库图片')+'</figcaption></figure>';}
function renderPreview(r) {
  if(!r.article){$('#preview-tab').innerHTML='<div class="blocked-box"><h3>这份内容还需要确认</h3><p>系统修正后仍有问题，正文已暂缓交付。请查看核验报告，调整任务后重新生成。</p><ul class="plain-list">'+r.issues.map(i=>'<li>'+e(i.message)+'</li>').join('')+'</ul></div>';return;}
  const a=r.article;
  let content='<div class="article-meta"><span class="status-dot"></span>'+e(r.platform)+' · '+e(r.task.audience)+'<span> / </span>依据本地资料生成</div><h2 class="article-title">'+e(a.title)+'</h2><div class="article-intro">'+e(a.intro)+'</div>';
  const images=r.imagePlan;
  content+=images.filter(im=>im.after_section===0).map(figure).join('');
  a.sections.forEach((section,index)=>{
    content+='<section class="article-section"><h3>'+e(section.heading)+'</h3><p>'+e(section.text)+'</p><div class="source-refs">'+section.source_ids.map(id=>'<button class="source-ref" data-fact="'+e(id)+'">'+e(id)+' 原文依据</button>').join('')+'</div></section>';
    content+=images.filter(im=>im.after_section===index+1).map(figure).join('');
  });
  content+='<div class="article-cta">'+e(a.cta)+'</div><div class="article-tags">'+a.tags.map(t=>e(t.startsWith('#')?t:'#'+t)).join(' ')+'</div>';
  content+=warningSummary(r.warnings);
  content+='<div class="telemetry">'+e(r.model)+' · '+e(r.telemetry.durationSeconds)+' 秒 · '+e(r.telemetry.modelCalls)+' 次模型请求'+(r.revisionOf?' · 修改版本':'')+'</div>';
  $('#preview-tab').innerHTML=content;
  $$('#preview-tab [data-fact]').forEach(button=>button.addEventListener('click',()=>{
    const fact=r.evidence.facts.find(f=>f.id===button.dataset.fact);if(!fact)return;
    openDetail('产品事实与原文','<h3>'+e(fact.id)+' · '+e(fact.title)+'</h3><p class="micro">来自当前型号：'+e(r.product.name)+'</p><p class="fact-modal">'+e(fact.content)+'</p>','所示为本地资料快照，涉及具体销售版本时请核对原文限制。');
  }));
}
function renderStrategy(r) {
  const t=r.task,s=r.strategy;
  $('#strategy-tab').innerHTML='<h3 class="report-heading">一、场景判断</h3><dl class="strategy-grid">'+[['目标人群',t.audience],['使用场景',t.scene],['购买阶段',t.purchaseStage],['发布平台',r.platform],['内容目标',t.goal],['产品型号',r.product.name]].map(([k,v])=>'<div><dt>'+e(k)+'</dt><dd>'+e(v)+'</dd></div>').join('')+'</dl><div class="strategy-card"><h3>内容切入点</h3><p>'+e(s.angle)+'</p></div><h3 class="evidence-label">卖点优先级</h3><div class="priority-list">'+(s.priorities || []).map((p,i)=>'<span>'+e(i+1)+'. '+e(p)+'</span>').join('')+'</div><div class="strategy-card"><h3>为什么这样写</h3><p>'+e(s.reason || r.initialStrategy.angle)+'</p></div><h3 class="evidence-label">选购前还可以确认</h3><ul class="plain-list">'+r.initialStrategy.questions.map(q=>'<li>'+e(q)+'</li>').join('')+'</ul>';
}
function renderResearchReferences(r) {
  if(!r.researchReferences?.length)return;
  $('#strategy-tab').innerHTML+='<h3 class="evidence-label">本次表达研究参考</h3>'+r.researchReferences.map(reference=>'<div class="strategy-card"><h3>案例研究 · '+e(new Date(reference.createdAt).toLocaleString('zh-CN'))+'</h3><p>'+e(reference.report.summary)+'</p><p class="micro">报告 ID：'+e(reference.id)+'。仅借鉴表达方法，产品事实仍按产品原文核验。</p></div>').join('');
}
function renderChecks(r) {
  $('#check-count').textContent=r.warnings.length || r.checks.filter(c=>c.status==='pending').length || '✓';
  $('#checks-tab').innerHTML='<h3 class="report-heading">四、核验结果</h3>'+r.checks.map(c=>'<div class="check-row"><span class="check-icon '+(c.status==='passed'?'':'pending')+'">'+(c.status==='passed'?'✓':'!')+'</span><div><h4>'+e(c.name)+' · '+(c.status==='passed'?'已检查':'待确认')+'</h4><p>'+e(c.detail)+'</p></div></div>').join('')+(r.issues.length?'<h3 class="evidence-label">待解决问题</h3><ul class="plain-list">'+r.issues.map(i=>'<li>'+e(i.message)+'</li>').join('')+'</ul>':'')+(r.repairs.length?'<h3 class="evidence-label">本次修正记录</h3><ul class="plain-list">'+r.repairs.map(i=>'<li>'+e(i)+'</li>').join('')+'</ul>':'')+(r.warnings.length?'<h3 class="evidence-label">待确认信息与使用边界</h3><ul class="plain-list">'+r.warnings.map(w=>'<li>'+e(w)+'</li>').join('')+'</ul>':'')+'<p class="micro">审核基于本地快照与模型判断，不代表已实时核实官方页面，也不代替人工发布审核。</p><div class="telemetry">'+e(new Date(r.createdAt).toLocaleString('zh-CN'))+' · 输入 '+e(r.telemetry.promptTokens)+' tokens / 输出 '+e(r.telemetry.completionTokens)+' tokens</div>';
}
function showResult(r) {
  state.result=r;
  $('#product').value=r.task.productId;$('#audience').value=r.task.audience;$('#scene').value=r.task.scene;
  $('#goal').value=r.task.goal;$('#purchase-stage').value=r.task.purchaseStage || '了解与比较';$('#requirements').value=r.task.requirements;
  state.platform=r.task.platform;
  $$('.platform-option').forEach(button=>{button.classList.toggle('selected',button.dataset.platform===state.platform);button.setAttribute('aria-pressed',String(button.dataset.platform===state.platform));});
  $('#empty-state').classList.add('hidden');$('#form-errors').classList.add('hidden');
  $('#result-platform').textContent=r.platform+(r.status==='blocked'?' · 未通过核验':r.checks.some(c=>c.status==='pending')?' · 有待确认项':r.warnings.length?' · '+r.warnings.length+'项提醒':' · 核验通过');
  renderPreview(r);renderStrategy(r);renderResearchReferences(r);renderChecks(r);
  renderEvidence({product:r.product,...r.evidence,warnings:r.warnings});
  $('#result-actions').classList.toggle('hidden',!r.article);
  for(const format of ['md','txt','json'])$('#export-'+format).href='/api/export/'+r.id+'?format='+format;
  switchTab(state.tab);
  persistDraft();
}
function setBusy(busy) {
  state.busy=busy;
  $('#generate-button').disabled=busy || !state.health?.knowledgeReady || !state.health?.modelConfigured;
  $('#revise-button').disabled=busy;
  $('#example-button').disabled=busy;
  $('#result-actions').classList.toggle('hidden',busy || !state.result?.article);
  $('#task-form').querySelectorAll('input,select,textarea,.platform-option').forEach(el=>el.disabled=busy);
  $('#generate-button').innerHTML=busy?'正在生成与核验…':'<span>✦</span> 生成图文内容 <span class="button-arrow">↗</span>';
}
async function submitJob(body) {
  if(state.busy)return;
  $('#global-alert').classList.add('hidden');$('#form-errors').classList.add('hidden');
  setBusy(true);
  const start=Date.now();let interval;
  try {
    const {id}=await api('/api/jobs',{method:'POST',body:JSON.stringify(body)});
    $('#job-progress').classList.remove('hidden');$('#progress-label').textContent='正在准备任务';$('#progress-bar').style.width='3%';$('#progress-steps').textContent='';
    interval=setInterval(()=>$('#progress-time').textContent=Math.floor((Date.now()-start)/1000)+'s',1000);
    while(true) {
      const job=await api('/api/jobs/'+id);
      const event=job.events?.at(-1);
      if(event){$('#progress-label').textContent=event.label;$('#progress-bar').style.width=event.percent+'%';$('#progress-steps').textContent=[...new Set(job.events.map(ev=>ev.label))].join(' → ');}
      if(job.state==='failed')throw new Error(job.error);
      if(job.state==='done'){
        showResult(job.result);$('#revision').value='';$('#revision-platform').value='';
        notify(job.result.article?'内容已生成，来源与核验记录已保存':'仍有问题需要确认，请查看核验报告');break;
      }
      await new Promise(resolve=>setTimeout(resolve,1200));
    }
  }catch(err){
    if(err.questions){$('#form-errors').innerHTML=err.questions.map(e).join('<br>');$('#form-errors').classList.remove('hidden');}
    else showError(err.message);
  }finally{clearInterval(interval);setBusy(false);$('#job-progress').classList.add('hidden');}
}
function collectTask(){return {productId:$('#product').value,audience:$('#audience').value,scene:$('#scene').value,platform:state.platform,goal:$('#goal').value,purchaseStage:$('#purchase-stage').value,requirements:$('#requirements').value};}
function loadExample() {
  const p=state.products.find(p=>p.name==='HUAWEI MateBook D 14 2024') || state.products[0];if(!p)return;
  $('#product').value=p.id;$('#audience').value='大学新生';$('#scene').value='开学购机：课堂记录、图书馆学习与宿舍整理作业';$('#requirements').value='语气自然，帮助学生确认需求；不写价格和未证实的软件兼容性。';selectPlatform('xiaohongshu');notify('示例已填入，点击“生成图文内容”开始');
}
async function loadHistory() {
  try{
    const {history}=await api('/api/history');
    $('#history-list').innerHTML=history.length?history.map(r=>'<div class="history-row"><div><h3>'+e(r.title)+'</h3><p>'+e(r.product)+' · '+e(r.platform)+' · '+e(new Date(r.createdAt).toLocaleString('zh-CN'))+' · '+(r.status==='blocked'?'待确认':'已完成')+'</p></div><button class="secondary-button" data-record="'+e(r.id)+'">查看 ↗</button></div>').join(''):'<div class="card history-empty">还没有运行记录。完成一次生成后，会保存在这里。</div>';
    $$('[data-record]').forEach(button=>button.addEventListener('click',async()=>{try{if(state.busy)return notify('请等待当前任务完成');const job=await api('/api/jobs/'+button.dataset.record);state.tab='preview';showResult(job.result);switchView('workspace');}catch(err){showError(err.message);}}));
  }catch(err){showError(err.message);}
}
function renderLibrary(){
  $('#library-grid').innerHTML=state.products.map(p=>'<article class="card library-card"><div class="eyebrow">PRODUCT FACTS & ASSETS</div><h3>'+e(p.name)+'</h3><p>'+e(p.system)+'</p><div class="micro">产品事实 / 官方来源 / 同型号图片索引</div><button class="secondary-button" data-product="'+e(p.id)+'">选用此型号 ↗</button></article>').join('');
  $$('[data-product]').forEach(button=>button.addEventListener('click',()=>{if(state.busy)return notify('请等待当前任务完成');$('#product').value=button.dataset.product;loadEvidence(button.dataset.product);switchView('workspace');$('#audience').focus();}));
}
function showConnections(){
  const h=state.health;
  const html=[['运行模式','GPT + 本地知识库 + 商城'],['知识库',h?.knowledgeReady?h.productCount+' 个型号可用':'未连接'],['大模型',h?.model || '未知'],['GPT 凭证',h?.modelConfigured?'已配置（未展示）':'未配置'],['ima 凭证','本地版不需要'],['商城补充',h?.mall?.ready?h.mall.productCount+' 项商品快照':'未读取']].map(([k,v])=>'<div class="connection-line"><span>'+e(k)+'</span><span>'+e(v)+'</span></div>').join('');
  openDetail('连接状态',html+'<button type="button" class="secondary-button" id="refresh-mall">刷新华为商城来源</button>','本地版无需 ima 凭证。页面不展示密钥。“已配置”不代表已实时测试。');
}
const DRAFT_KEY='zhixu-gpt-task-v1';
function persistDraft() {
  try {localStorage.setItem(DRAFT_KEY,JSON.stringify(collectTask()));}catch{}
}
function restoreDraft() {
  try {
    const saved=JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if(!saved || typeof saved!=='object' || Array.isArray(saved))return;
    if(state.products.some(p=>p.id===saved.productId))$('#product').value=saved.productId;
    for(const [key,id] of [['audience','audience'],['scene','scene'],['requirements','requirements']])if(typeof saved[key]==='string')$('#'+id).value=saved[key].slice(0,1800);
    for(const [key,id] of [['goal','goal'],['purchaseStage','purchase-stage']])if(typeof saved[key]==='string' && [...$('#'+id).options].some(o=>o.value===saved[key]))$('#'+id).value=saved[key];
    selectPlatform(labels[saved.platform]?saved.platform:'xiaohongshu');
  }catch{}
}
async function initialize() {
  $$('.nav-item').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
  $$('.editor-tab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
  $$('.platform-option').forEach(b=>b.addEventListener('click',()=>selectPlatform(b.dataset.platform)));
  $('#product').addEventListener('change',()=>loadEvidence($('#product').value));
  $('#example-button').addEventListener('click',loadExample);
  $('#task-form').addEventListener('input',persistDraft);
  $('#task-form').addEventListener('change',persistDraft);
  document.addEventListener('click',event=>{
    const direction=event.target.closest('[data-direction]');
    if(direction){
      if(state.busy)return;
      const notes={checklist:'采用选购清单结构：围绕当前一个型号，列出2—4个有证据的选购关注点，每项写清适用场景与到店确认建议。标题不使用最值得买、销量排名或最低价，未核实的价格留空。',scene:'采用场景演示结构：从目标人群的一项具体任务切入，每段围绕一个有证据的产品特点，附可执行的拍摄建议，不虚构实拍、亲测或使用效果。',concern:'采用顾虑解答结构：提出选购前需要确认的问题，再结合当前产品事实逐项说明。只有已确认的业务反馈才可作为需求参考，不捏造客户评价；资料未覆盖的问题明确建议到店核实。'};
      const note=notes[direction.dataset.direction];if(!note)return;
      const field=$('#requirements');if(!field.value.includes(note))field.value=(field.value.trim()+'\n'+note).trim().slice(0,1800);
      persistDraft();notify('已加入创作要求，可继续编辑');
    }
    if(event.target.closest('#refresh-mall')){const b=event.target.closest('#refresh-mall');b.disabled=true;b.textContent='正在刷新…';api('/api/mall/refresh',{method:'POST',body:'{}'}).then(m=>{state.health.mall=m;$('#connection-dialog').close();if($('#product').value)loadEvidence($('#product').value);notify('商城来源已刷新');}).catch(err=>{showError(err.message);b.disabled=false;b.textContent='重试刷新商城';});}
    const image=event.target.closest('[data-image]');
    if(image)showImage(image.dataset.image,image.dataset.imageScope);
    if(event.target.closest('[data-show-checks]')){switchTab('checks');$('#checks-tab').scrollIntoView({block:'start',behavior:'smooth'});}
  });
  $('#task-form').addEventListener('submit',event=>{event.preventDefault();submitJob({task:collectTask()});});
  $('#revise-button').addEventListener('click',()=>{if(!$('#revision').value.trim() && !$('#revision-platform').value)return notify('请填写修改要求或选择新平台');submitJob({parentId:state.result.id,instruction:$('#revision').value.trim() || '按新平台重新组织结构、语气、图片和行动引导',platform:$('#revision-platform').value || state.result.task.platform});});
  $('#copy-button').addEventListener('click',async()=>{
    const a=state.result?.article;if(!a)return;
    const text=[a.title,a.intro,...a.sections.flatMap(s=>[s.heading,s.text]),a.cta,a.tags.join(' ')].filter(Boolean).join('\n\n');
    try{await navigator.clipboard.writeText(text);notify('正文已复制');}catch{notify('浏览器未允许复制，请使用 TXT 导出');}
  });
  $('#connection-button').addEventListener('click',showConnections);
  $('#close-dialog').addEventListener('click',()=>$('#connection-dialog').close());
  $('#connection-dialog').addEventListener('click',event=>{if(event.target===$('#connection-dialog'))$('#connection-dialog').close();});
  try {
    const [health,{products}]=await Promise.all([api('/api/health'),api('/api/products')]);
    state.health=health;state.products=products;
    $('#kb-status').textContent=health.knowledgeReady?'本地知识库 · '+health.productCount+' 个型号':'知识库未连接';
    $('#kb-dot').className='status-dot'+(health.knowledgeReady?'':' error');$('#model-status').textContent=health.model+(health.modelConfigured?' · 凭证已配置':' · 缺少凭证');
    $('#product').innerHTML='<option value="">请选择具体产品</option>'+products.map(p=>'<option value="'+e(p.id)+'">'+e(p.name)+'</option>').join('');
    if(!health.knowledgeReady)showError(health.knowledgeMessage);
    if(!health.modelConfigured)showError('未配置 GPT_API_KEY / LLM_API_KEY。可先浏览资料，配置 GPT 凭证并重新启动后生成。');
    restoreDraft();
    setBusy(false);
  }catch(err){showError(err.message);$('#generate-button').disabled=true;}
}
$('#record-revision-button').addEventListener('click',()=>{if(state.result?.article)window.beginRevision?.(state.result.id);});
initialize();
