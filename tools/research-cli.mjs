import fs from 'node:fs';
import {LocalKnowledge} from '../src/kb-local.mjs';
import {indexProducts,importRecords,stats,getSource,putSource,listSources,updateSource,backupDatabase,addConcern,repairShellMetadata} from '../src/research/database.mjs';
import {startCollection,collectSource,researchStatus} from '../src/research/service.mjs';
import {sourceUrl,relevance} from '../src/research/platforms.mjs';
const [command,arg,arg2,count]=process.argv.slice(2);
try {
 if(command==='index')console.log(JSON.stringify(indexProducts(new LocalKnowledge()),null,2));
 else if(command==='repair-shells')console.log(JSON.stringify(repairShellMetadata()));
 else if(command==='curate'){let excluded=0;for(const source of listSources({kind:'post',limit:500}).items){const r=relevance(source);if(!r.usable&&r.reason.startsWith('主要为汽车')){updateSource(source.id,{state:'out_of_scope',reason:r.reason});excluded++;}}console.log(JSON.stringify({excluded}));}
 else if(command==='backup')console.log(JSON.stringify(backupDatabase(arg),null,2));
 else if(command==='faq'){
 const records=JSON.parse(fs.readFileSync(arg,'utf8'));const results=[];
 for(const item of records){try{
  const source=putSource({url:item.url,title:item.question},{origin:'official_reference'}),page=await collectSource(source.id);
  const normalized=v=>String(v).replace(/[\s/\\|、，。:：-]/g,'').toLowerCase();
  if(page.state!=='collected'||!normalized(page.title+' '+page.excerpt).includes(normalized(item.question)))throw new Error('官方页面未取到对应问题，保留为候选');
  const record=addConcern({question:item.question,audience:'华为电脑选购或使用者',scene:'购机确认、软件与生态适配',origin:'official_faq',evidence:'官方支持页面：'+page.url+'；页面读取时间：'+page.updated_at+'；机器已读取对应标题，仍待人工核对；本地来源卡：'+item.localReference,sourceId:page.id,confirmed:false});
  results.push({question:item.question,sourceId:page.id,id:record.id,ok:true});
 }catch(e){results.push({question:item.question,ok:false,reason:e.status?e.message:'页面未完成对应问题的核对'});}}
 console.log(JSON.stringify({accepted:results.filter(r=>r.ok).length,results},null,2));
 }
 else if(command==='status')console.log(JSON.stringify(researchStatus(),null,2));
 else if(command==='collect'){const record=putSource({url:sourceUrl(arg).url});const result=await collectSource(record.id);console.log(JSON.stringify({id:result.id,url:result.url,title:result.title,state:result.state,reason:result.reason,hasExcerpt:Boolean(result.excerpt),metrics:result.metrics},null,2));}
 else if(command==='import'){const data=JSON.parse(fs.readFileSync(arg,'utf8'));console.log(JSON.stringify(importRecords(Array.isArray(data)?data:data.records||data.items),null,2));}
 else if(command==='search-plan'){const result=startCollection({maxPages:32});console.log(JSON.stringify(result));const timer=setInterval(()=>{const s=researchStatus();if(!s.running){clearInterval(timer);console.log(JSON.stringify(s.stats.runs[0],null,2));}},1000);}
 else if(command==='search-all'){const result=startCollection({keywords:[arg||'华为 电脑'],perQuery:10,maxPages:8});console.log(JSON.stringify(result));const timer=setInterval(()=>{const s=researchStatus();if(!s.running){clearInterval(timer);console.log(JSON.stringify(s.stats.runs[0],null,2));}},1000);}
 else if(command==='search'){const result=startCollection({platforms:[arg],keywords:[arg2],perQuery:Number(count)||3,maxPages:2});console.log(JSON.stringify(result));const timer=setInterval(()=>{const s=researchStatus();if(!s.running){clearInterval(timer);console.log(JSON.stringify(s.stats.runs[0],null,2));}},1000);}
 else console.log('Usage: node tools/research-cli.mjs index|status|collect <https-url>|search <platform> <keyword> [count]|import <json-file>');
} catch(e){console.error(e.status?e.message:'Research operation did not complete');process.exitCode=1;}
