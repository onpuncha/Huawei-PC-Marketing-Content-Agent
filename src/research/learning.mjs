import * as store from './database.mjs';
import {error} from './platforms.mjs';
import {articleText} from '../rules.mjs';
export async function handleLearning(req,url,readBody,readers){
 const route=url.pathname.replace('/api/research/learning','');
 if(req.method==='GET'&&route==='/status')return {body:{stats:store.learningStats(),origins:store.CONCERN_ORIGINS}};
 if(req.method==='GET'&&route==='/concerns')return {body:{items:store.listConcerns(url.searchParams.get('q')||'')}};
 if(req.method==='POST'&&route==='/concerns')return {body:store.addConcern(await readBody(req))};
 const concern=route.match(/^\/concerns\/([a-f0-9-]{36})\/confirm$/);
 if(req.method==='POST'&&concern){const b=await readBody(req);return {body:store.confirmConcern(concern[1],b.confirmed===true)}};
 if(req.method==='GET'&&route==='/revisions')return {body:{items:store.listRevisions()}};
 if(req.method==='GET'&&route==='/drafts')return {body:{items:readers.history().filter(r=>r.status!=='blocked')}};
 const draft=route.match(/^\/drafts\/([a-f0-9-]{36})$/);
 if(req.method==='GET'&&draft){const r=readers.readResult(draft[1]);if(!r.article)throw error('该任务没有通过审核的原稿',409);return {body:{id:r.id,title:r.article.title,platform:r.task.platform,product:r.product.name,text:articleText(r),createdAt:r.createdAt}};}
 if(req.method==='POST'&&route==='/revisions'){
  const b=await readBody(req);if(!/^[a-f0-9-]{36}$/.test(b.resultId||''))throw error('请先选择一份已生成原稿');
  const r=readers.readResult(b.resultId);if(!r.article)throw error('该任务没有通过审核的原稿',409);
  return {body:store.saveRevision({resultId:r.id,platform:r.task.platform,productName:r.product.name,originalText:articleText(r),finalText:b.finalText,reason:b.reason,decision:b.decision,confirmed:b.confirmed===true,context:{task:r.task,product:r.product,facts:r.evidence?.facts,source:r.evidence?.source}})};
 }
 if(req.method==='GET'&&route==='/export')return {body:store.exportLearning(),download:'zhixu-learning-records.json'};
 if(req.method==='POST'&&route==='/import-concerns'){
  const b=await readBody(req);if(!Array.isArray(b.records)||b.records.length>100)throw error('每次最多导入100条顾虑记录');
  const results=b.records.map((r,index)=>{try{return {index,ok:true,...store.addConcern(r)};}catch(e){return {index,ok:false,error:e.status?e.message:'记录未能导入'};}});
  return {body:{accepted:results.filter(r=>r.ok).length,results}};
 }
 throw error('未找到业务反馈接口',404);
}
