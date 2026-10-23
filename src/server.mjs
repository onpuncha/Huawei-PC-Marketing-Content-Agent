import {handleResearch} from './research/service.mjs';
import {indexProducts} from './research/database.mjs';
import {mallStatus,refreshMall,mallImage,ensureMall} from './vmall.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {config,ROOT} from './config.mjs';
import {LocalKnowledge} from './kb-local.mjs';
import {normalizeTask,PLATFORMS} from './rules.mjs';
import {runAgent,exportMarkdown,articleText} from './agent.mjs';
const kb=new LocalKnowledge();
try {if(!kb.error)indexProducts(kb);} catch {console.error('研究库产品索引未完成，可在内容研究页重新同步。');}
const jobs=new Map();
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'};
function json(res,status,value) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function readBody(req,maxBytes=32768) {
  if(!String(req.headers['content-type'] || '').startsWith('application/json'))throw Object.assign(new Error('请使用 JSON 请求'),{status:415});
  let bytes=0,chunks=[];
  for await(const chunk of req) {bytes+=chunk.length;if(bytes>maxBytes)throw Object.assign(new Error('请求过大'),{status:413});chunks.push(chunk);}
  try {const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!body || typeof body!=='object' || Array.isArray(body))throw new Error();return body;}catch{throw Object.assign(new Error('请求 JSON 无效'),{status:400});}
}
function readResult(id) {
  if(!/^[a-f0-9-]{36}$/.test(id))throw Object.assign(new Error('记录不存在'),{status:404});
  const active=jobs.get(id)?.result;if(active)return active;
  const file=path.join(config.cacheDir,id+'.json');
  if(!fs.existsSync(file))throw Object.assign(new Error('记录不存在'),{status:404});
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function history() {
  if(!fs.existsSync(config.cacheDir))return [];
  return fs.readdirSync(config.cacheDir).filter(name=>/^[a-f0-9-]{36}\.json$/.test(name)).map(name=>{
    try{const r=JSON.parse(fs.readFileSync(path.join(config.cacheDir,name),'utf8'));return {id:r.id,title:r.article?.title || '待确认任务',product:r.product.name,platform:r.platform,status:r.status,createdAt:r.createdAt};}catch{return null;}
  }).filter(Boolean).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,30);
}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');

  res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'self' https://modelscope.cn https://*.modelscope.cn https://*.ms.show; base-uri 'none'; form-action 'self'");
  try {
    const validHosts=new Set(['127.0.0.1:'+config.port,'localhost:'+config.port]);
    const forwarded=String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    const requestHost=String(req.headers.host || '');
    if(!/^[a-zA-Z0-9.:-]+$/.test(requestHost))return json(res,403,{error:'请求域名无效'});
    validHosts.add(requestHost);
    if(forwarded && /^[a-zA-Z0-9.:-]+$/.test(forwarded))validHosts.add(forwarded);
    const origin=req.headers.origin;
    if(origin){let originHost;try{originHost=new URL(origin).host;}catch{return json(res,403,{error:'请求来源无效'});}
      if(!validHosts.has(originHost))return json(res,403,{error:'请求来源无效'});}
    const url=new URL(req.url,'http://127.0.0.1:'+config.port), route=url.pathname;
    if(route.startsWith('/api/research/')) {
      const result=await handleResearch(req,url,r=>readBody(r,1048576),kb,{readResult,history});
      if(result.download)res.setHeader('Content-Disposition','attachment; filename="'+result.download+'"');
      return json(res,result.status||200,result.body);
    }
    if(req.method==='GET' && route==='/api/health')return json(res,200,{mode:'gpt-vmall',provider:'4router',knowledgeReady:!kb.error,knowledgeMessage:kb.error || '已连接本地知识库',productCount:kb.products.length,mall:mallStatus(),modelConfigured:Boolean(config.apiKey),model:config.model,imaRequired:false,platforms:PLATFORMS});
    if(req.method==='GET' && route==='/api/mall/status')return json(res,200,mallStatus());
    if(req.method==='POST' && route==='/api/mall/refresh') {await refreshMall();return json(res,200,mallStatus());}
    const mallMatch=route.match(/^\/api\/mall-images\/([a-f0-9]+)\/([a-f0-9]{16}|\d+)$/);
    if(req.method==='GET' && mallMatch){const asset=await mallImage(kb.retrieve(mallMatch[1]),mallMatch[2]);res.writeHead(200,{'Content-Type':asset.type,'Cache-Control':'private, max-age=1800'});return res.end(asset.bytes);}
    if(req.method==='GET' && route==='/api/products')return json(res,200,{products:kb.catalog(),error:kb.error});
    if(req.method==='GET' && route==='/api/history')return json(res,200,{history:history()});
    const sourceMatch=route.match(/^\/api\/sources\/([a-f0-9]+)$/);
    if(req.method==='GET' && sourceMatch){res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});return res.end(kb.source(sourceMatch[1]));}
    const imageMatch=route.match(/^\/api\/images\/([a-f0-9]+)\/(\d+)$/);
    if(req.method==='GET' && imageMatch) {
      const file=kb.image(imageMatch[1],imageMatch[2]);
      res.writeHead(200,{'Content-Type':mime[path.extname(file).toLowerCase()] || 'application/octet-stream','Cache-Control':'private, max-age=3600'});return fs.createReadStream(file).pipe(res);
    }
    const evidenceMatch=route.match(/^\/api\/evidence\/([a-f0-9]+)$/);
    if(req.method==='GET' && evidenceMatch) {const e=kb.retrieve(evidenceMatch[1],url.searchParams.get('platform'));delete e.guide;return json(res,200,e);}
    if(req.method==='POST' && route==='/api/jobs') {
      if(kb.error)throw Object.assign(new Error(kb.error),{status:503});
      if(!config.apiKey)throw Object.assign(new Error('未配置 GPT_API_KEY 或 LLM_API_KEY，请配置后重新启动。'),{status:503});
      if([...jobs.values()].filter(j=>j.state==='running').length>=2)throw Object.assign(new Error('当前已有两个任务运行，请等待完成。'),{status:429});
      const body=await readBody(req);
      let revision=null,input=body.task;
      if(body.parentId) {
        const previous=readResult(body.parentId);
        if(!previous.article)throw Object.assign(new Error('此记录尚未通过核验，请重新生成。'),{status:409});
        if(typeof body.instruction!=='string' || !body.instruction.trim() || body.instruction.length>1800)throw Object.assign(new Error('请填写有效的修改要求（最多1800字）'),{status:422});
        input={...previous.task,platform:body.platform || previous.task.platform,requirements:[previous.task.requirements,body.instruction.trim()].filter(Boolean).join('\n').slice(0,1800)};
        revision={instruction:body.instruction.trim(),previous,parentId:previous.id};
      }
      if(!input || typeof input!=='object' || Array.isArray(input))throw Object.assign(new Error('缺少任务信息'),{status:400});
      const {task,questions}=normalizeTask(input);
      if(questions.length)return json(res,422,{error:'请补充任务信息',questions});
      kb.get(task.productId);
      const id=crypto.randomUUID();
      const job={id,state:'running',events:[],startedAt:Date.now()};jobs.set(id,job);
      // Keep in-memory status bounded. Completed records remain on local disk.
      if(jobs.size>60)for(const [key,value] of jobs){if(value.state!=='running' && key!==id){jobs.delete(key);break;}}
      json(res,202,{id});
      runAgent(kb,task,{id,revision,progress:event=>job.events.push(event)}).then(result=>{job.result=result;job.state='done';}).catch(err=>{job.state='failed';job.error=err.status?err.message:'处理失败，请稍后重试。';});
      return;
    }
    const jobMatch=route.match(/^\/api\/jobs\/([a-f0-9-]{36})$/);
    if(req.method==='GET' && jobMatch) {
      const job=jobs.get(jobMatch[1]);
      if(job)return json(res,200,{id:job.id,state:job.state,events:job.events,error:job.error,result:job.result});
      return json(res,200,{state:'done',result:readResult(jobMatch[1]),events:[]});
    }
    const exportMatch=route.match(/^\/api\/export\/([a-f0-9-]{36})$/);
    if(req.method==='GET' && exportMatch) {
      const r=readResult(exportMatch[1]);
      if(!r.article)throw Object.assign(new Error('此记录尚未通过核验，不能导出'),{status:409});
      const kind=url.searchParams.get('format') || 'md';
      if(!['md','txt','json'].includes(kind))throw Object.assign(new Error('导出格式无效'),{status:400});
      const content=kind==='json'?JSON.stringify(r,null,2):kind==='txt'?articleText(r):exportMarkdown(r);
      res.writeHead(200,{'Content-Type':kind==='json'?'application/json; charset=utf-8':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="huawei-content-'+r.id.slice(0,8)+'.'+kind+'"','Cache-Control':'no-store'});
      return res.end(content);
    }
    const publicFiles={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/research.js':'research.js','/learning.js':'learning.js'};
    if(req.method==='GET' && publicFiles[route]) {
      const file=path.join(ROOT,'public',publicFiles[route]);res.writeHead(200,{'Content-Type':mime[path.extname(file)],'Cache-Control':'no-cache'});return fs.createReadStream(file).pipe(res);
    }
    json(res,404,{error:'未找到该资源'});
  } catch(err) {if(!res.headersSent)json(res,err.status || 500,{error:err.status?err.message:'服务器处理失败，请检查配置后重试。'});else res.end();}
});
server.requestTimeout=30000;
server.on('error',err=>{console.error(err.code==='EADDRINUSE'?'端口已占用，请设置 PORT 后重试。':'服务器启动失败。');process.exitCode=1;});
server.listen(config.port,config.host,()=>{console.log('华为 PC 营销工作台 · GPT + 商城版\nhttp://'+config.host+':'+config.port+'\n知识库：'+(kb.error || kb.products.length+' 个型号')+'\n大模型：'+config.model+' / '+(config.apiKey?'凭证已配置':'凭证未配置'));});

ensureMall().then(c=>console.log('华为商城：'+c.products.length+'项商品快照已读取')).catch(()=>console.log('商城暂不可用，保留本地资料并显示提示。'));
