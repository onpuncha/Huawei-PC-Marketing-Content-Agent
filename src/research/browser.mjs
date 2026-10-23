import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import dns from 'node:dns/promises';
import crypto from 'node:crypto';
import {sourceUrl,cleanText,error} from './platforms.mjs';
import {robotsAllowed,isPublic,extractPage} from './crawler.mjs';
let chromiumModule,browserPromise,active=false;
const allowedAssets=['douyin.com','douyinstatic.com','douyincdn.com','douyinpic.com','byteimg.com','bytecdntp.com','bytegoofy.com','bytescm.com','bytetos.com','zijieapi.com','bytednsdoc.com','volccdn.com','bytedance.com','amemv.com','xiaohongshu.com','xhscdn.com','weibo.com','weibo.cn','sinaimg.cn','sinajs.cn','weixin.qq.com','qpic.cn','wxqcloud.qq.com'];
const hostCache=new Map();
async function chromium(){
 if(chromiumModule)return chromiumModule;
 const options=['playwright-core','playwright'];
 const provided=process.env.RESEARCH_PLAYWRIGHT_MODULE;
 if(provided)options.unshift(pathToFileURL(path.resolve(provided)).href);
 if(process.platform==='win32')options.push(pathToFileURL(path.join(process.env.USERPROFILE||'','.cache','codex-runtimes','codex-primary-runtime','dependencies','node','node_modules','playwright-core','index.mjs')).href);
 for(const module of options)try{const loaded=await import(module);if(loaded.chromium)return chromiumModule=loaded.chromium;}catch{}
 throw error('浏览器采集组件未安装；可继续用公开HTML采集或补充正文',503);
}
export function browserStatus(){return {mode:process.env.RESEARCH_BROWSER_ENABLED==='0'?'disabled':'on-demand',active,anonymous:true,note:'使用独立匿名浏览器正常渲染；遇到登录或验证页面会停止。抖音读取发布文案，不自动转写视频。'};}
async function browser(){
 if(browserPromise){const existing=await browserPromise;if(existing.isConnected())return existing;browserPromise=null;}
 const engine=await chromium();
 browserPromise=engine.launch({headless:true,...(process.env.RESEARCH_BROWSER_EXECUTABLE?{executablePath:process.env.RESEARCH_BROWSER_EXECUTABLE}:process.platform==='win32'?{channel:'msedge'}:fs.existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{})});
 try{return await browserPromise;}catch{browserPromise=null;throw error('无法启动浏览器组件，请检查浏览器安装路径',503);}
}
async function publicAsset(url){
 let u;try{u=new URL(url);}catch{return false;}
 if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||!allowedAssets.some(host=>u.hostname===host||u.hostname.endsWith('.'+host)))return false;
 let result=hostCache.get(u.hostname);if(!result||Date.now()-result.at>60000){const addresses=await dns.lookup(u.hostname,{all:true}).catch(()=>[]);result={at:Date.now(),allowed:Boolean(addresses.length)&&addresses.every(a=>isPublic(a.address))};hostCache.set(u.hostname,result);}
 return result.allowed;
}
export async function renderPage(url){
 if(process.env.RESEARCH_BROWSER_ENABLED==='0')throw error('浏览器采集已关闭',503);
 if(active)throw error('已有浏览器采集进行中，请稍后重试',429);
 const canonical=sourceUrl(url);active=true;
 let context;
 try{
  await robotsAllowed(new URL(canonical.url));
  const instance=await browser();context=await instance.newContext({locale:'zh-CN',serviceWorkers:'block',acceptDownloads:false,viewport:{width:1365,height:960}});
  let requestCount=0,networkCount=0,navBlocked=false;const blockedRequests=[];
  await context.route('**/*',async route=>{
   const request=route.request();requestCount++;
   try{
    if(['image','media','font'].includes(request.resourceType())||!await publicAsset(request.url())||++networkCount>240){if(blockedRequests.length<25)blockedRequests.push({host:new URL(request.url()).hostname,type:request.resourceType()});return route.abort();}
    if(request.isNavigationRequest()){
     if(request.frame()!==request.frame().page().mainFrame())return route.abort();
     try{sourceUrl(request.url());await robotsAllowed(new URL(request.url()));}catch{navBlocked=true;return route.abort();}
    }
    if(['xhr','fetch'].includes(request.resourceType())&&new URL(request.url()).hostname===new URL(canonical.url).hostname)await robotsAllowed(new URL(request.url()));
    return route.continue();
   }catch{return route.abort();}
  });
  const page=await context.newPage();page.setDefaultTimeout(10000);
  const targetId=new URL(canonical.url).pathname.match(/\/(?:video|note)\/(\d+)/)?.[1];let videoPayload=null;const publicQuestions=[];
  page.on('response',async response=>{try{
   const u=new URL(response.url());if(!targetId||u.hostname!==new URL(canonical.url).hostname||!response.ok())return;
   const detail=u.pathname.includes('/aweme/detail'),comments=u.pathname.includes('/comment/list')&&u.searchParams.get('aweme_id')===targetId;
   if(!detail&&!comments)return;
   const length=Number(response.headers()['content-length']||0);if(length>1800000)return;
   const data=await response.json();
   if(comments){for(const c of (Array.isArray(data.comments)?data.comments:[]).slice(0,30)){const text=cleanText(c.text,500);if(text.length>=5&&/[?？]|怎么|如何|能不能|可不可以|支持吗|可以吗|为什么/.test(text)&&publicQuestions.length<12&&!publicQuestions.some(q=>q.text===text))publicQuestions.push({text,id:cleanText(c.cid,80),publishedTime:Number.isInteger(c.create_time)?c.create_time:null});}return;}
   const record=data.aweme_detail||data.awemeDetail;
   if(String(record?.aweme_id||record?.awemeId)===targetId)videoPayload=record;
  }catch{}});
  const nav=await page.goto(canonical.url,{waitUntil:'domcontentloaded',timeout:25000}).catch(()=>null);
  await page.waitForTimeout(2500);
  await page.locator('[data-e2e="video-desc"],#detail-desc,#js_content,[class*="detail_wbtext"]').first().waitFor({state:'attached',timeout:6000}).catch(()=>{});
  if(canonical.platform==='douyin'){const trigger=page.locator('[data-e2e="video-player-comment"]').first();if(await trigger.count())try{await trigger.click({timeout:1500});await page.waitForTimeout(1800);}catch{}}
  const data=await page.evaluate(platform=>{
   const first=selectors=>{for(const selector of selectors){const el=document.querySelector(selector);const text=el?.innerText?.trim();if(text)return text;}return '';};
   const selectors={
    douyin:{body:['[data-e2e="video-desc"]','[data-e2e="detail-video-desc"]'],author:['[data-e2e="user-info"] a','[data-e2e="user-name"]','[data-e2e="video-author"]'],date:['[data-e2e="video-create-time"]','time'],likes:['[data-e2e="video-player-digg"]'],comments:['[data-e2e="video-player-comment"]'],favorites:['[data-e2e="video-player-collect"]'],shares:['[data-e2e="video-player-share"]']},
    xiaohongshu:{body:['#detail-desc','.note-content .desc','.note-content .note-text'],author:['.author .name','.author-container .username'],date:['.bottom-container .date','.note-content .date'],likes:['.engage-bar .like-wrapper .count','.interactions .like-wrapper .count'],comments:['.engage-bar .chat-wrapper .count'],favorites:['.engage-bar .collect-wrapper .count']},
    weibo:{body:['[class*="detail_wbtext"]','.WB_text','.weibo-text'],author:['[class*="head_name"]','.WB_info a'],date:['[class*="head_info"] time','time'],likes:['[data-testid="like-count"]'],comments:[],shares:[]},
    wechat:{body:['#js_content'],author:['#js_name','.rich_media_meta_nickname'],date:['#publish_time','time'],likes:[],comments:[],shares:[]},
   }[platform]||{body:['article','main']};
   const title=document.querySelector('meta[property="og:title"]')?.content||document.querySelector('#activity-name')?.innerText||document.querySelector('#detail-title')?.innerText||document.title;
   const metrics={};for(const k of ['likes','comments','favorites','shares'])if(selectors[k]){const text=first(selectors[k]);if(text)metrics[k]=text.slice(0,80);}
   let matching=null;
   if(platform==='douyin'){
    const id=location.pathname.match(/\/(?:video|note)\/(\d+)/)?.[1],roots=[];
    for(const key of ['_ROUTER_DATA','__INITIAL_STATE__','__NEXT_DATA__'])if(window[key]&&typeof window[key]==='object')roots.push(window[key]);
    for(const key of ['RENDER_DATA','__NEXT_DATA__']){const raw=document.getElementById(key)?.textContent;if(raw&&raw.length<1800000)try{roots.push(JSON.parse(raw.startsWith('%')?decodeURIComponent(raw):raw));}catch{}}
    const queue=roots.map(value=>({value,depth:0})),seen=new WeakSet();let count=0;
    while(queue.length&&count++<8000){const {value,depth}=queue.shift();if(!value||typeof value!=='object'||seen.has(value)||depth>12)continue;seen.add(value);
     if(id&&String(value.aweme_id||value.awemeId)===id&&typeof value.desc==='string'){matching={desc:value.desc,author:value.author?.nickname,createTime:value.create_time,statistics:value.statistics};break;}
     for(const child of Object.values(value).slice(0,300))if(child&&typeof child==='object')queue.push({value:child,depth:depth+1});
    }
   }
   return {matching,title,body:first(selectors.body).slice(0,20000),author:first(selectors.author||[]).slice(0,120),dateText:first(selectors.date||[]),dateIso:document.querySelector('time[datetime]')?.getAttribute('datetime')||'',metrics,url:location.href,visibleText:document.body?.innerText?.slice(0,6000)||''};
  },canonical.platform);
  const structured=videoPayload?{desc:videoPayload.desc,author:videoPayload.author?.nickname,createTime:videoPayload.create_time,statistics:videoPayload.statistics}:data.matching;
  if(structured){if(!data.body)data.body=cleanText(structured.desc,12000);if(!data.author)data.author=structured.author||'';}
  const html=await page.content(),base=extractPage(html,canonical.url);
  const challenge=navBlocked||[401,403,429].includes(nav?.status())||/安全验证|访问验证|请完成验证|拖动滑块|点击完成验证|captcha|verifycenter/i.test(data.title+' '+data.visibleText.slice(0,1800));
  if(challenge)throw error('浏览器遇到访问限制或验证页面，未继续读取');
  const final=sourceUrl(data.url);if(final.platform!==canonical.platform)throw error('页面跳转到其他平台，未继续读取');
  const rawBody=cleanText(data.body||base.excerpt,12000),body=rawBody.length>=30?rawBody:'',generic=/在抖音记录美好生活|抖音.*记录美好生活/.test(data.title||base.title||''),title=cleanText(generic?(body?body.slice(0,160):''):data.title||base.title,400);
  if(!body&&/登录后查看|登录后浏览|请先登录|登录即可查看/.test(data.visibleText))throw error('页面要求登录后查看正文，已停止');
  let publishedAt=base.publishedAt;
  if(Number.isInteger(structured?.createTime)&&structured.createTime>946684800&&structured.createTime<Date.now()/1000+86400)publishedAt=new Date(structured.createTime*1000).toISOString();
  const date=String(data.dateIso||data.dateText||'').match(/(20\d{2})[年/.-](\d{1,2})[月/.-](\d{1,2})(?:日)?(?:\s+(\d{1,2}):(\d{2}))?/);
  if(date){const iso=`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}T${(date[4]||'00').padStart(2,'0')}:${date[5]||'00'}:00+08:00`;if(!Number.isNaN(Date.parse(iso)))publishedAt=new Date(iso).toISOString();}
  const metrics={};for(const [name,text] of Object.entries(data.metrics))if(/^\d[\d,]*$/.test(text.replace(/\s+/g,''))){const n=Number(text.replace(/[,\s]/g,''));if(Number.isSafeInteger(n))metrics[name]=n;}
  const rawFields={likes:'digg_count',comments:'comment_count',shares:'share_count',favorites:'collect_count'},usedFields={};
  for(const [name,key] of Object.entries(rawFields)){const n=structured?.statistics?.[key];if(metrics[name]===undefined&&Number.isSafeInteger(n)&&n>0){metrics[name]=n;usedFields[key]=n;}}
  // play_count is frequently unavailable/placeholder; it is never treated as observed views here.
  const observed=Object.keys(metrics).length?{...metrics,evidence:'原帖ID '+(targetId||'')+' 的浏览器页面；控件文字：'+JSON.stringify(data.metrics)+'；同帖结构化字段：'+JSON.stringify(usedFields)}:base.metrics;
  return {url:final.url,title,author:cleanText(data.author||base.author,120),summary:body?base.summary:'',excerpt:body,publishedAt,metrics:observed,publicQuestions:body?publicQuestions:[],state:body?'collected':'candidate',reason:body?canonical.platform==='douyin'?'已读取视频发布文案；不包含视频语音转写和画面核验':'浏览器读取公开正文':navBlocked?'浏览器导航受限':'浏览器未获得可识别正文',captureMethod:'browser',bodyKind:canonical.platform==='douyin'?'video_caption':'page_text',capture:{pageHash:crypto.createHash('sha256').update(html).digest('hex'),dateDisplay:cleanText(data.dateText,120),metricDisplays:data.metrics,publicQuestions,structuredStatistics:structured?.statistics||null,requestCount,networkCount,blockedRequests,mainStatus:nav?.status()||null,htmlChars:html.length,renderedChars:data.visibleText.length,visiblePreview:cleanText(data.visibleText,350)}};
 }finally{if(context)await context.close().catch(()=>{});active=false;}
}
export async function closeBrowser(){if(browserPromise){const b=await browserPromise.catch(()=>null);await b?.close().catch(()=>{});browserPromise=null;}}
