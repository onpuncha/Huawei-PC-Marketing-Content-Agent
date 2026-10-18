import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {config} from './config.mjs';
export const MALL_PAGE='https://www.vmall.com/portal/activity/index.html?isShowLayout=false&pn=pczq';
const API='https://openapi.vmall.com/mcp/content/getPageInfoListAsync';
const HOSTS=new Set(['openapi.vmall.com','res.vmallres.com']);
const cacheFile=path.join(config.cacheDir,'vmall-catalog.json');
let catalog=null,pending=null;
const assetMapFile=path.join(config.cacheDir,'vmall-assets.json');
let assetMap={};try{assetMap=JSON.parse(fs.readFileSync(assetMapFile,'utf8'));}catch{}
function registerAsset(productId,url){const key=crypto.createHash('sha256').update(productId+'|'+url).digest('hex').slice(0,16);if(!assetMap[key]){assetMap[key]={productId,url};fs.mkdirSync(config.cacheDir,{recursive:true});fs.writeFileSync(assetMapFile,JSON.stringify(assetMap));}return key;}
function safeAsset(value){try{const u=new URL(value,'https://res.vmallres.com');return u.protocol==='https:' && u.hostname==='res.vmallres.com'?u.href:null;}catch{return null;}}
export async function fetchPublic(url,{binary=false}={}){
 const u=new URL(url);if(u.protocol!=='https:' || !HOSTS.has(u.hostname))throw new Error('商城来源域名不在允许范围');
 const r=await fetch(url,{signal:AbortSignal.timeout(12000),redirect:'error',headers:{'User-Agent':'HuaweiPC-ContentAgent/0.2'}});
 if(!r.ok)throw new Error('商城请求失败 HTTP '+r.status);
 const limit=binary?12*1024*1024:3*1024*1024;const type=r.headers.get('content-type') || '';
 if(binary && !/^image\/(?:jpeg|png|webp|gif)/i.test(type))throw new Error('商城资源不是支持的图片');
 if(Number(r.headers.get('content-length') || 0)>limit)throw new Error('商城资源过大');
 const reader=r.body.getReader();let total=0;const chunks=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>limit)throw new Error('商城资源超过大小限制');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
 const bytes=Buffer.concat(chunks);return binary?{bytes,type}:JSON.parse(bytes.toString('utf8'));
}
export function extractMallProducts(data){
 const found=new Map();
 function walk(x){if(!x || typeof x!=='object')return;if(Array.isArray(x))return x.forEach(walk);
  if(typeof x.prdName==='string' && /MateBook/.test(x.prdName) && /^\d+$/.test(String(x.prdId))){
   const prdId=String(x.prdId),sku=String(x.skuCode || ''),pageUrl='https://www.vmall.com/product/'+prdId+'.html';
   const images=[];const main=safeAsset((x.photoPath || '')+(x.photoName || ''));
   if(main && x.photoName)images.push({url:main,group:prdId+'-primary',kind:'商品主图'});
   const material=Array.isArray(x.materialPhotos)?x.materialPhotos:[];
   // Same material type in several ratios is usually one composition, not different images.
   for(const kind of [material.some(p=>+p.type===27)?27:23]){const candidates=material.filter(p=>+p.type===kind && /\.(png|jpe?g|webp)(?:$|\?)/i.test(p.photoPath || '')).sort((a,b)=>(a.ratio==='1:1'?-1:1)-(b.ratio==='1:1'?-1:1));const p=candidates[0],url=p && safeAsset(p.photoPath);if(url)images.push({url,group:prdId+'-material-'+kind,kind:'商城商品素材'});}
   found.set(prdId,{name:x.prdName,prdId,sku,pageUrl,sellingPoints:String(x.prodSellPoint || ''),images});
  }Object.values(x).filter(v=>typeof v==='object').forEach(walk);
 }walk(data);return [...found.values()];
}
export function matchesMallProduct(local,remote){
 const n=local.name,r=remote.name;
 if(n==='HUAWEI MateBook Pro S')return r==='HUAWEI MateBook Pro S';
 if(n==='HUAWEI MateBook 14（鸿蒙版）')return r==='HUAWEI MateBook 14 鸿蒙版';
 if(n==='HUAWEI MateBook Pro')return r==='HUAWEI MateBook Pro 麒麟X90 Plus' && /麒麟\s*X90\s*Plus/i.test(local.processor || '');
 if(n==='HUAWEI MateBook Fold 非凡大师')return r==='HUAWEI MateBook Fold 非凡大师 麒麟X90 Plus' && /麒麟\s*X90\s*Plus/i.test(local.processor || '');
 return false;
}
export async function refreshMall(){
 if(pending)return pending;
 pending=(async()=>{
  const root=await fetchPublic(API+'?pageAlias=pczq&lang=zh_CN&country=CN&portal=1');
  if(String(root.code)!=='0')throw new Error('商城未返回公开页面数据');
  const pages=[root],ids=new Set();
  function find(x){if(!x || typeof x!=='object')return;if(Array.isArray(x))return x.forEach(find);for(const [k,v] of Object.entries(x)){if(typeof v==='string' && /url|config|tab/i.test(k)){for(const m of v.matchAll(/pageId(?:=|%3[Dd]|["\\:\s]+)(\d{6,})/g))ids.add(m[1]);}if(typeof v==='object')find(v);}}
  find(root);
  // Public computer zone contains the product cards in this linked child page.
  for(const id of [...ids].slice(0,3)){const child=await fetchPublic(API+'?pageId='+id+'&lang=zh_CN&country=CN&portal=1');if(String(child.code)==='0')pages.push(child);}
  let products=extractMallProducts(pages);
  if(!products.length){const child=await fetchPublic(API+'?pageId=301154374&lang=zh_CN&country=CN&portal=1');products=extractMallProducts(child);}
  if(!products.length)throw new Error('商城页面未找到可识别的商品卡片');
  catalog={fetchedAt:new Date().toISOString(),pageUrl:MALL_PAGE,products};fs.mkdirSync(config.cacheDir,{recursive:true});fs.writeFileSync(cacheFile,JSON.stringify(catalog,null,2));return catalog;
 })().finally(()=>pending=null);
 return pending;
}
export function mallCatalog(){
 if(!catalog && fs.existsSync(cacheFile)){try{catalog=JSON.parse(fs.readFileSync(cacheFile,'utf8'));}catch{}}
 return catalog;
}
export function mallStatus(){const c=mallCatalog();return {configured:true,ready:Boolean(c),fetchedAt:c?.fetchedAt || null,productCount:c?.products.length || 0,pageUrl:MALL_PAGE,cacheHours:6};}
export async function ensureMall(){const c=mallCatalog();if(c && Date.now()-Date.parse(c.fetchedAt)<6*3600000)return c;return refreshMall();}
export function supplementEvidence(context,local){
 const snapshot=mallCatalog();context.sources=[{kind:'local',title:context.source.title,url:context.source.urls[0],fetchedAt:context.source.snapshotDate}];
 if(!snapshot){context.warnings.push('商城资料尚未读取，当前仅使用本地资料；可在连接状态中刷新商城。');return context;}
 const match=snapshot.products.find(p=>matchesMallProduct(local,p));
 context.mall={matched:Boolean(match),fetchedAt:snapshot.fetchedAt,pageUrl:snapshot.pageUrl,productName:match?.name || null,sku:match?.sku || null};
 if(!match){context.warnings.push('商城当前电脑专区未找到型号及芯片可明确对应的商品，未添加其他型号图片。');return context;}
 const age=Date.now()-Date.parse(snapshot.fetchedAt);if(age>6*3600000)context.warnings.push('商城快照超过6小时，请刷新后复核。');
 context.sources.push({kind:'vmall',title:match.name,url:match.pageUrl,fetchedAt:snapshot.fetchedAt,sku:match.sku});
 context.facts.push({id:'V01',title:'华为商城商品身份与来源',content:'来源：华为商城电脑专区。读取时间：'+snapshot.fetchedAt+'。\n商品名称：'+match.name+'。\n商品ID：'+match.prdId+'。销售SKU：'+match.sku+'。\n商品页：'+match.pageUrl+'\n仅确认商品身份与素材归属，未验证当前价格、库存或促销；图库素材不证明具体配置参数。'});
 const names=new Set(context.images.map(i=>i.originalUrl));
 const allowedImages=match.images.filter((im,index,all)=>im.kind==='商品主图' || index===all.findIndex(candidate=>candidate.kind!=='商品主图'));
 const added=allowedImages.filter(im=>!names.has(im.url)).map((im,i)=>({id:'VIMG'+(i+1),name:'vmall_'+match.prdId+'_'+(i+1)+path.extname(new URL(im.url).pathname),model:context.product.name,pageUrl:match.pageUrl,originalUrl:im.url,description:match.name+' · '+im.kind+'（以画面为准，不据此推断场景或功能）',usage:'匹配商品素材；同款式裁切仅保留一个，不引用图片中的未验证促销。',width:0,height:0,available:true,sourceKind:'vmall',sourceName:'华为商城',fetchedAt:snapshot.fetchedAt,artworkGroup:im.group,url:'/api/mall-images/'+context.product.id+'/'+registerAsset(context.product.id,im.url)}));
 context.images=[...added,...context.images];context.source.additionalSources=context.sources.slice(1);
 return context;
}
export async function mallImage(context,index){
 const stored=assetMap[index];if(stored && stored.productId===context.product.id)return fetchPublic(stored.url,{binary:true});
 const image=context.images.filter(i=>i.sourceKind==='vmall')[Number(index)];if(!image)throw Object.assign(new Error('商城图片不存在'),{status:404});
 return fetchPublic(image.originalUrl,{binary:true});
}
export function deduplicateLocalImages(context,kbRoot){
 const hashes=new Set(),urls=new Set();let removed=0;
 context.images=context.images.filter(image=>{
  let key=image.originalUrl?.replace(/\.(?:25|50|75)\.webp$|\.webp$/,'');
  if(key && urls.has(key)){removed++;return false;}if(key)urls.add(key);
  if(image.relative){try{const digest=crypto.createHash('sha256').update(fs.readFileSync(path.resolve(kbRoot,image.relative))).digest('hex');if(hashes.has(digest)){removed++;return false;}hashes.add(digest);}catch{}}
  return true;
 });
 if(removed)context.warnings.push('已移除'+removed+'张相同文件或同源重复图片。');return context;
}
