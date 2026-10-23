import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import {sourceUrl,cleanText,error} from './platforms.mjs';
const AGENT='ZhiXuResearchBot/0.1 (public-page research; no login)';
const robotsCache=new Map(),lastHost=new Map();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function isPublic(ip){
 if(net.isIP(ip)===4){const [a,b]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19));}
 if(ip.startsWith('::ffff:'))return isPublic(ip.slice(7));
 return /^[23][0-9a-f:]+$/i.test(ip)&&!ip.toLowerCase().startsWith('2001:db8:');
}
async function download(url,maxBytes=1800000){
 const u=new URL(url),addresses=await dns.lookup(u.hostname,{all:true});
 if(!addresses.length||addresses.some(a=>!isPublic(a.address)))throw error('页面地址未通过公网检查');
 return new Promise((resolve,reject)=>{
  const chosen=addresses[0];
  const request=https.get(u,{signal:AbortSignal.timeout(16000),headers:{'User-Agent':AGENT,Accept:'text/html,application/xhtml+xml,text/plain;q=0.9','Accept-Encoding':'identity'},lookup:(host,options,cb)=>options?.all?cb(null,[chosen]):cb(null,chosen.address,chosen.family)},response=>{
   const status=response.statusCode,type=String(response.headers['content-type']||'');
   if(status>=300&&status<400){response.resume();return resolve({status,location:response.headers.location,type,text:''});}
   let size=0,chunks=[];
   response.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){request.destroy(error('页面超过采集大小上限'));return;}chunks.push(chunk);});
   response.on('end',()=>{if(size<=maxBytes)resolve({status,type,text:Buffer.concat(chunks).toString('utf8')});});
   response.on('error',reject);
  });
  request.setTimeout(12000,()=>request.destroy(error('页面连接超时',504)));request.on('error',reject);
 });
}
function robotsRules(text){
 const groups=[];let group=null,started=false;
 for(const line of text.split(/\r?\n/)){
  const s=line.replace(/#.*$/,'').trim(),m=s.match(/^([^:]+):\s*(.*)$/);if(!m)continue;
  const key=m[1].toLowerCase().trim(),value=m[2].trim();
  if(key==='user-agent'){if(!group||started){group={agents:[],rules:[]};groups.push(group);started=false;}group.agents.push(value.toLowerCase());}
  else if(group&&(key==='allow'||key==='disallow')){started=true;if(value)group.rules.push({allow:key==='allow',pattern:value});}
 }
 const explicit=groups.filter(g=>g.agents.some(a=>a!=='*'&&AGENT.toLowerCase().includes(a)));
 return (explicit.length?explicit:groups.filter(g=>g.agents.includes('*'))).flatMap(g=>g.rules);
}
export async function robotsAllowed(u){
 let cached=robotsCache.get(u.origin);
 if(!cached||Date.now()-cached.at>3600000){
  let response;try{response=await download(u.origin+'/robots.txt',250000);}catch{throw error('无法确认站点 robots 规则，本次跳过页面');}
  if(response.status===404||response.status===410)cached={at:Date.now(),rules:[]};
  else if(response.status===200&&response.type.includes('text'))cached={at:Date.now(),rules:robotsRules(response.text)};
  else throw error('站点 robots 规则不可读取，本次跳过页面');
  robotsCache.set(u.origin,cached);
 }
 const target=u.pathname+u.search,matches=cached.rules.filter(rule=>{
  const regex='^'+rule.pattern.split('*').map(v=>v.replace(/[.+?^{}()|[\]\\]/g,'\\$&')).join('.*');
  try{return new RegExp(regex).test(target);}catch{return true;}
 }).sort((a,b)=>b.pattern.replace(/[*$]/g,'').length-a.pattern.replace(/[*$]/g,'').length||Number(b.allow)-Number(a.allow));
 if(matches[0]&&!matches[0].allow)throw error('站点 robots 规则不允许采集此页面');
}
export async function publicPage(value){
 let current=sourceUrl(value).url;
 for(let redirects=0;redirects<=3;redirects++){
  const u=new URL(current);await robotsAllowed(u);
  const wait=900-(Date.now()-(lastHost.get(u.hostname)||0));if(wait>0)await delay(wait);lastHost.set(u.hostname,Date.now());
  const response=await download(current);
  if(response.status>=300&&response.status<400){if(!response.location)throw error('页面重定向缺少目标');current=sourceUrl(new URL(response.location,current).href).url;continue;}
  if(response.status===401||response.status===403||response.status===429)throw error('页面限制访问或请求频率；已停止，不尝试登录或绕过验证');
  if(response.status!==200)throw error('页面返回 HTTP '+response.status);
  if(!/text\/html|application\/xhtml\+xml/.test(response.type))throw error('该链接不是可采集的网页');
  return {...response,url:current};
 }
 throw error('页面重定向次数超过上限');
}
function decode(s){return String(s||'').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const c=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return c>0&&c<=0x10ffff?String.fromCodePoint(c):'';}).replace(/&(amp|quot|apos|lt|gt|nbsp);/g,(_,n)=>({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '})[n]);}
const attrs=tag=>Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1].toLowerCase(),decode(m[2]??m[3])]));
const plain=s=>decode(String(s).replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
export function extractPage(html,url){
 const meta={};for(const m of html.matchAll(/<meta\s+[^>]*>/gi)){const a=attrs(m[0]),key=a.property||a.name;if(key&&a.content)meta[key]=a.content;}
 const title=cleanText(meta['og:title']||meta['twitter:title']||plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||''),400);
 const summary=cleanText(meta['og:description']||meta.description||'',1200);
 const article=html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]||html.match(/<div\b[^>]*id=["']js_content["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]||'';
 const official=sourceUrl(url).platform==='official';
 const officialBody=official?(html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]||html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]||'').replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi,' '):'';
 let excerpt=cleanText(plain(article||officialBody),12000),author=cleanText(meta.author||meta['article:author']||'',120),publishedAt=null;
 const rawDate=meta['article:published_time']||meta.pubdate||'';if(rawDate&&!Number.isNaN(Date.parse(rawDate)))publishedAt=new Date(rawDate).toISOString();
 let metrics=null;
 for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
  try{
   const value=JSON.parse(m[1]);const objects=Array.isArray(value)?value:value['@graph']||[value];
   for(const object of objects){
    if(!/Article|Posting|VideoObject/.test(String(object['@type'])))continue;
    const identity=object.url||object.mainEntityOfPage?.['@id'];
    if(identity){try{if(sourceUrl(new URL(identity,url).href).url!==sourceUrl(url).url)continue;}catch{continue;}}
    else if(objects.filter(o=>/Article|Posting|VideoObject/.test(String(o['@type']))).length>1)continue;
    if(object.headline&&!title)meta.fallbackTitle=cleanText(object.headline,400);
    if(!excerpt&&object.articleBody)excerpt=cleanText(object.articleBody,12000);
    if(!author&&object.author)author=cleanText(typeof object.author==='string'?object.author:object.author.name,120);
    if(!publishedAt&&object.datePublished&&!Number.isNaN(Date.parse(object.datePublished)))publishedAt=new Date(object.datePublished).toISOString();
    const observations=Array.isArray(object.interactionStatistic)?object.interactionStatistic:[object.interactionStatistic].filter(Boolean);
    for(const o of observations){const type=String(o.interactionType?.['@type']||o.interactionType||''),key=/LikeAction/.test(type)?'likes':/CommentAction/.test(type)?'comments':/ShareAction/.test(type)?'shares':/WatchAction|ViewAction/.test(type)?'views':null;
     if(key&&/^\d+$/.test(String(o.userInteractionCount))&&Number.isSafeInteger(Number(o.userInteractionCount))){metrics??={evidence:'原页 JSON-LD interactionStatistic 中的可读取计数'};metrics[key]=Number(o.userInteractionCount);}
    }
   }
  }catch{}
 }
 const blocked=/安全验证|访问验证|完成验证|captcha|verifycenter/i.test(title+' '+summary) || (!excerpt&&/登录后查看|登录后浏览|请先登录/.test(summary));
 return {url,title:title||meta.fallbackTitle||'',summary,excerpt,author,publishedAt,metrics,state:blocked?'blocked':excerpt||summary?'collected':'candidate',reason:blocked?'原页要求验证，未继续采集':!excerpt?'仅取得公开元信息，未获得正文':''};
}
export async function collectPage(url){const page=await publicPage(url);return {...extractPage(page.text,page.url),captureMethod:'html',bodyKind:sourceUrl(page.url).platform==='douyin'?'video_caption':'page_text'};}
