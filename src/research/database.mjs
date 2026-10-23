import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {config,ROOT} from '../config.mjs';
import {sourceUrl,idFor,cleanText,error} from './platforms.mjs';
const dir=process.env.RESEARCH_DATA_DIR?path.resolve(process.env.RESEARCH_DATA_DIR):path.join(config.cacheDir,'research');
fs.mkdirSync(dir,{recursive:true});
export const databasePath=path.join(dir,'research.sqlite');
const seed=path.join(ROOT,'data','research','initial.sqlite');
if(!fs.existsSync(databasePath)&&fs.existsSync(seed))fs.copyFileSync(seed,databasePath);
const db=new DatabaseSync(databasePath);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS sources(
 id TEXT PRIMARY KEY,url TEXT NOT NULL UNIQUE,platform TEXT NOT NULL,kind TEXT NOT NULL,
 title TEXT NOT NULL DEFAULT '',author TEXT NOT NULL DEFAULT '',published_at TEXT,summary TEXT NOT NULL DEFAULT '',
 excerpt TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT 'candidate',reason TEXT NOT NULL DEFAULT '',
 origin TEXT NOT NULL DEFAULT 'manual',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS observations(
 id INTEGER PRIMARY KEY,source_id TEXT NOT NULL REFERENCES sources(id),observed_at TEXT NOT NULL,
 views INTEGER,likes INTEGER,comments INTEGER,shares INTEGER,favorites INTEGER,
 origin TEXT NOT NULL,evidence TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS observations_source ON observations(source_id,id DESC);
CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,state TEXT NOT NULL,config_json TEXT NOT NULL,result_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS discoveries(run_id TEXT NOT NULL REFERENCES runs(id),source_id TEXT NOT NULL REFERENCES sources(id),keyword TEXT NOT NULL,rank INTEGER,discovered_at TEXT NOT NULL,PRIMARY KEY(run_id,source_id,keyword));
CREATE TABLE IF NOT EXISTS product_documents(id TEXT PRIMARY KEY,name TEXT NOT NULL,body TEXT NOT NULL,urls_json TEXT NOT NULL,digest TEXT NOT NULL,indexed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS analyses(id TEXT PRIMARY KEY,platform TEXT NOT NULL,source_ids_json TEXT NOT NULL,report_json TEXT NOT NULL,model TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS analysis_inputs(analysis_id TEXT PRIMARY KEY REFERENCES analyses(id),sources_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS analysis_reviews(analysis_id TEXT PRIMARY KEY REFERENCES analyses(id),reason TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS feedback(id TEXT PRIMARY KEY,source_id TEXT NOT NULL REFERENCES sources(id),adopted INTEGER NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS source_captures(id TEXT PRIMARY KEY,source_id TEXT NOT NULL REFERENCES sources(id),method TEXT NOT NULL,body_kind TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS concerns(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL UNIQUE,question TEXT NOT NULL,audience TEXT NOT NULL,scene TEXT NOT NULL,origin TEXT NOT NULL,evidence TEXT NOT NULL,source_id TEXT REFERENCES sources(id),confirmed_at TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS revision_samples(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL UNIQUE,result_id TEXT NOT NULL,platform TEXT NOT NULL,product_name TEXT NOT NULL,original_text TEXT NOT NULL,final_text TEXT NOT NULL,reason TEXT NOT NULL,decision TEXT NOT NULL,origin TEXT NOT NULL,context_json TEXT NOT NULL,changed INTEGER NOT NULL,confirmed_at TEXT,fact_status TEXT NOT NULL,created_at TEXT NOT NULL);
PRAGMA user_version=2;`);
db.prepare("UPDATE sources SET kind='guide' WHERE platform='official' AND url LIKE ?").run('https://consumer.huawei.com/cn/support/%');
// Preserve collection workers in other live processes; only recover demonstrably stale runs.
for(const run of db.prepare("SELECT id,config_json,updated_at FROM runs WHERE state='running'").all()){
 let stale=false;try{const owner=JSON.parse(run.config_json).__ownerPid;if(owner){try{process.kill(owner,0);}catch{stale=true;}}else stale=Date.now()-Date.parse(run.updated_at)>1800000;}catch{stale=true;}
 if(stale)db.prepare("UPDATE runs SET state='interrupted',updated_at=? WHERE id=?").run(new Date().toISOString(),run.id);
}
function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}
function iso(value){if(!value)return null;const s=String(value);if(!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(s) || Number.isNaN(Date.parse(s)))throw error('时间格式应为 YYYY-MM-DD 或 ISO 日期');return new Date(s).toISOString();}
export function putSource(input,{origin='manual',state='candidate'}={}){
 const canonical=sourceUrl(input.url),now=new Date().toISOString(),id=idFor(canonical.url);
 const previous=db.prepare('SELECT * FROM sources WHERE id=?').get(id);
 if(previous?.state==='collected'&&state==='candidate')input={...input,title:previous.title,summary:previous.summary,excerpt:previous.excerpt,author:previous.author,publishedAt:previous.published_at,reason:previous.reason};
 const title=cleanText(input.title,400) || previous?.title || '';
 const published=input.publishedAt?iso(input.publishedAt):previous?.published_at || null;
 db.prepare(`INSERT INTO sources(id,url,platform,kind,title,author,published_at,summary,excerpt,state,reason,origin,created_at,updated_at)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,title=excluded.title,author=excluded.author,published_at=excluded.published_at,summary=excluded.summary,excerpt=excluded.excerpt,state=excluded.state,reason=excluded.reason,updated_at=excluded.updated_at`).run(
 id,canonical.url,canonical.platform,canonical.kind,title,cleanText(input.author,120)||previous?.author||'',published,
 cleanText(input.summary,1200)||previous?.summary||'',cleanText(input.excerpt,12000)||previous?.excerpt||'',
 previous?.state==='collected' && state==='candidate'?'collected':state,cleanText(input.reason,300),previous?.origin||origin,previous?.created_at||now,now);
 return getSource(id);
}
export function getSource(id){const r=db.prepare('SELECT * FROM sources WHERE id=?').get(id);if(!r)throw error('资料不存在',404);return {...r,metrics:db.prepare('SELECT * FROM observations WHERE source_id=? ORDER BY observed_at DESC,id DESC LIMIT 1').get(id)||null};}
export function updateSource(id,fields){const old=getSource(id);return putSource({...old,publishedAt:old.published_at,...fields},{origin:old.origin,state:fields.state||old.state});}
export function addObservation(id,input,origin='manual'){
 getSource(id);const names=['views','likes','comments','shares','favorites'];
 const values=names.map(k=>{const n=input[k];if(n===undefined||n===null||n==='')return null;if(!/^\d+$/.test(String(n))||!Number.isSafeInteger(Number(n)))throw error('互动指标必须为非负整数；未知值请留空');return Number(n);});
 if(values.every(v=>v===null))throw error('至少填写一项实际观察到的指标');
 const at=iso(input.observedAt)||new Date().toISOString();if(Date.parse(at)>Date.now()+300000)throw error('观察时间不能在未来');
 const evidence=cleanText(input.evidence,1000);if(!evidence)throw error('请注明指标依据，例如后台导出文件名或页面可见数字位置');
 db.prepare('INSERT INTO observations(source_id,observed_at,views,likes,comments,shares,favorites,origin,evidence,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,at,...values,origin,evidence,new Date().toISOString());
 return getSource(id);
}
export function listSources({platform='',kind='',q='',metric='',state='',limit=100,offset=0}={}){
 const where=[],args=[];
 for(const [k,v] of [['s.platform',platform],['s.kind',kind],['s.state',state]])if(v){where.push(k+'=?');args.push(v);}
 if(q){where.push('(s.title LIKE ? OR s.summary LIKE ? OR s.excerpt LIKE ?)');args.push(...Array(3).fill('%'+cleanText(q,120)+'%'));}
 if(metric && !['views','likes','comments','shares','favorites'].includes(metric))throw error('不支持的排序指标');
 if(metric && (!platform || platform==='official'))throw error('按互动指标排序前，请先选定一个社交平台');
 if(metric)where.push('o.'+metric+' IS NOT NULL');
 if(!state)where.push("s.state!='out_of_scope'");
 const filter=where.length?' WHERE '+where.join(' AND '):'';
 const join=' FROM sources s LEFT JOIN observations o ON o.id=(SELECT o2.id FROM observations o2 WHERE o2.source_id=s.id ORDER BY o2.observed_at DESC,o2.id DESC LIMIT 1)';
 const total=db.prepare('SELECT COUNT(*) n'+join+filter).get(...args).n;
 const rows=db.prepare('SELECT s.*,o.views,o.likes,o.comments,o.shares,o.favorites,o.observed_at,o.origin metric_origin,o.evidence metric_evidence'+join+filter+' ORDER BY '+(metric?'o.'+metric+' DESC,':'')+'s.updated_at DESC LIMIT ? OFFSET ?').all(...args,Math.max(1,Math.min(500,Math.floor(Number(limit))||100)),Math.max(0,Math.floor(Number(offset))||0));
 return {total,items:rows};
}
export function importRecords(records){
 if(!Array.isArray(records)||records.length>300)throw error('每次最多导入300条对象记录');
 const results=[];for(const [i,r] of records.entries())try{
  const value=transaction(()=>{const record=putSource(r,{origin:'import',state:r.excerpt?'imported':'candidate'});if(r.metrics&&Object.keys(r.metrics).some(k=>['views','likes','comments','shares','favorites'].includes(k)&&r.metrics[k]!==null&&r.metrics[k]!==''))addObservation(record.id,{...r.metrics,evidence:r.metrics.evidence||r.evidence||'用户导入记录；未经系统独立核验'},'import');return record;});
  results.push({index:i,id:value.id,ok:true});
 }catch(e){results.push({index:i,ok:false,error:e.status?e.message:'该条记录未能导入'});}
 return {inserted:results.filter(r=>r.ok).length,rejected:results.filter(r=>!r.ok).length,results};
}
export function stats(){return {postTextCandidates:db.prepare("SELECT COUNT(*) n FROM sources WHERE kind='post' AND state!='out_of_scope' AND (title!='' OR summary!='' OR excerpt!='')").get().n,sources:db.prepare('SELECT COUNT(*) n FROM sources').get().n,platforms:db.prepare('SELECT platform,state,COUNT(*) count FROM sources GROUP BY platform,state').all(),observations:db.prepare('SELECT COUNT(*) n FROM observations').get().n,products:db.prepare('SELECT COUNT(*) n FROM product_documents').get().n,analyses:db.prepare('SELECT COUNT(*) n FROM analyses').get().n,runs:db.prepare('SELECT id,state,config_json,result_json,created_at,updated_at FROM runs ORDER BY created_at DESC LIMIT 8').all().map(r=>({...r,config:JSON.parse(r.config_json),result:JSON.parse(r.result_json)}))};}
export function createRun(options){const id=crypto.randomUUID(),at=new Date().toISOString();db.prepare('INSERT INTO runs(id,state,config_json,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,'running',JSON.stringify({...options,__ownerPid:process.pid}),at,at);return id;}
export function saveRun(id,state,result){db.prepare('UPDATE runs SET state=?,result_json=?,updated_at=? WHERE id=?').run(state,JSON.stringify(result),new Date().toISOString(),id);}
export function getRun(id){const r=db.prepare('SELECT * FROM runs WHERE id=?').get(id);if(!r)throw error('采集任务不存在',404);return {...r,config:JSON.parse(r.config_json),result:JSON.parse(r.result_json)};}
export function discover(runId,id,keyword,rank){db.prepare('INSERT OR IGNORE INTO discoveries VALUES(?,?,?,?,?)').run(runId,id,keyword,rank,new Date().toISOString());}
export function indexProducts(kb){return transaction(()=>{
 const now=new Date().toISOString();let count=0;
 for(const p of kb.catalog()){
  const c=kb.retrieve(p.id),body=c.facts.map(f=>'## '+f.title+'\n'+f.content).join('\n\n'),urls=c.source.urls||[];
  db.prepare('INSERT INTO product_documents VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,body=excluded.body,urls_json=excluded.urls_json,digest=excluded.digest,indexed_at=excluded.indexed_at').run(p.id,p.name,body,JSON.stringify(urls),crypto.createHash('sha256').update(body).digest('hex'),now);
  for(const url of urls)try{putSource({url,title:p.name+' · 官方来源',summary:'本地产品资料登记的原始来源链接；尚未重新读取网页。'},{origin:'local_reference',state:'candidate'});}catch{}
  count++;
 }return {indexed:count};});}
export function productDocuments(q=''){return db.prepare('SELECT id,name,urls_json,digest,indexed_at,substr(body,1,180) preview FROM product_documents WHERE name LIKE ? OR body LIKE ? ORDER BY name LIMIT 50').all('%'+cleanText(q,120)+'%','%'+cleanText(q,120)+'%').map(r=>({...r,urls:JSON.parse(r.urls_json)}));}
export function saveAnalysis(platform,ids,report,model,inputs=[]){return transaction(()=>{const id=crypto.randomUUID(),at=new Date().toISOString();db.prepare('INSERT INTO analyses VALUES(?,?,?,?,?,?)').run(id,platform,JSON.stringify(ids),JSON.stringify(report),cleanText(model,120),at);db.prepare('INSERT INTO analysis_inputs VALUES(?,?,?)').run(id,JSON.stringify(inputs),at);return {id,platform,sourceIds:ids,report,model};});}
export function invalidateAnalysis(id,reason){db.prepare('INSERT OR REPLACE INTO analysis_reviews VALUES(?,?,?)').run(id,cleanText(reason,1000),new Date().toISOString());}
export function recentAnalyses(){return db.prepare('SELECT * FROM analyses WHERE id NOT IN (SELECT analysis_id FROM analysis_reviews) ORDER BY created_at DESC LIMIT 12').all().map(r=>({...r,report:JSON.parse(r.report_json),sourceIds:JSON.parse(r.source_ids_json),sources:JSON.parse(db.prepare('SELECT sources_json FROM analysis_inputs WHERE analysis_id=?').get(r.id)?.sources_json||'[]').map(({id,title,url})=>({id,title,url}))}));}
export function styleReferences(platform){
 const map={xiaohongshu:'xiaohongshu',wechat:'wechat',douyin:'douyin',weibo:'weibo'};if(!map[platform])return [];
 return db.prepare('SELECT * FROM analyses WHERE platform=? AND id NOT IN (SELECT analysis_id FROM analysis_reviews) ORDER BY created_at DESC LIMIT 2').all(map[platform]).map(r=>({id:r.id,createdAt:r.created_at,report:JSON.parse(r.report_json),sources:JSON.parse(db.prepare('SELECT sources_json FROM analysis_inputs WHERE analysis_id=?').get(r.id)?.sources_json||'[]').map(({id,title,url})=>({id,title,url}))}));
}
export function addFeedback(id,adopted,note){getSource(id);const key=crypto.randomUUID();db.prepare('INSERT INTO feedback VALUES(?,?,?,?,?)').run(key,id,adopted?1:0,cleanText(note,2000),new Date().toISOString());return {id:key};}

export function observations(id){getSource(id);return db.prepare('SELECT * FROM observations WHERE source_id=? ORDER BY observed_at DESC,id DESC LIMIT 100').all(id);}

export function backupDatabase(destination){
 const output=path.resolve(destination);if(fs.existsSync(output))throw error('快照文件已存在，请使用新文件名');
 fs.mkdirSync(path.dirname(output),{recursive:true});db.prepare('VACUUM INTO ?').run(output);
 return {file:output,bytes:fs.statSync(output).size};
}

export function saveCapture(sourceId,page){getSource(sourceId);const id=crypto.randomUUID();db.prepare('INSERT INTO source_captures VALUES(?,?,?,?,?,?)').run(id,sourceId,page.captureMethod||'html',page.bodyKind||'page_text',JSON.stringify({title:page.title,author:page.author,publishedAt:page.publishedAt,excerpt:page.excerpt,metrics:page.metrics,reason:page.reason,...page.capture}),new Date().toISOString());return id;}
export function captures(id){getSource(id);return db.prepare('SELECT * FROM source_captures WHERE source_id=? ORDER BY created_at DESC LIMIT 12').all(id).map(r=>({...r,payload:JSON.parse(r.payload_json)}));}
export const CONCERN_ORIGINS={store_record:'门店实际咨询（用户提供）',public_question:'公开用户提问（保留来源）',official_faq:'官方FAQ',public_topic:'公开选题线索',simulated:'模拟问题'};
export function addConcern(input){
 const question=cleanText(input.question,1000),audience=cleanText(input.audience,180),scene=cleanText(input.scene,300),evidence=cleanText(input.evidence,1800),origin=String(input.origin||'');
 if(question.length<5)throw error('请填写至少5个字的顾虑或问题');if(!CONCERN_ORIGINS[origin])throw error('请选择问题的真实来源类型');if(!evidence)throw error('请填写来源依据；没有真实记录时请选择模拟问题');
 const sourceId=input.sourceId||null;if(sourceId)getSource(sourceId);
 const fingerprint=crypto.createHash('sha256').update([question,origin,sourceId||evidence].join('\n')).digest('hex'),id=crypto.randomUUID(),at=new Date().toISOString();
 const old=sourceId?db.prepare('SELECT id FROM concerns WHERE question=? AND origin=? AND source_id=?').get(question,origin,sourceId):db.prepare('SELECT id FROM concerns WHERE fingerprint=?').get(fingerprint);if(old)return {id:old.id,duplicate:true};
 db.prepare('INSERT INTO concerns VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,fingerprint,question,audience,scene,origin,evidence,sourceId,input.confirmed===true?at:null,at);
 return {id};
}
export function listConcerns(q=''){return db.prepare('SELECT c.*,s.url source_url FROM concerns c LEFT JOIN sources s ON s.id=c.source_id WHERE c.question LIKE ? OR c.scene LIKE ? ORDER BY c.created_at DESC LIMIT 150').all('%'+cleanText(q,100)+'%','%'+cleanText(q,100)+'%').map(r=>({...r,originLabel:CONCERN_ORIGINS[r.origin]}));}
export function saveRevision(input){
 const before=cleanText(input.originalText,20000),after=cleanText(input.finalText,20000),reason=cleanText(input.reason,1600);
 if(!before||!after)throw error('原稿与最终稿不能为空');if(!reason)throw error('请记录修改或采用原因');
 if(!['adopted','needs_changes','rejected'].includes(input.decision))throw error('请选择采用判断');
 const id=crypto.randomUUID(),at=new Date().toISOString(),changed=before!==after;
 const fingerprint=crypto.createHash('sha256').update([input.resultId,after,reason,input.decision,input.confirmed===true].join('\n')).digest('hex');
 const old=db.prepare('SELECT id FROM revision_samples WHERE fingerprint=?').get(fingerprint);if(old)return {id:old.id,duplicate:true};
 db.prepare('INSERT INTO revision_samples VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,fingerprint,input.resultId,input.platform,input.productName,before,after,reason,input.decision,changed?'human_edit':'human_review',JSON.stringify(input.context||{}),changed?1:0,input.confirmed===true?at:null,changed?'not_checked_after_edit':'original_preserved',at);
 return {id,changed,factStatus:changed?'not_checked_after_edit':'original_preserved'};
}
export function listRevisions(){return db.prepare('SELECT id,result_id,platform,product_name,original_text,final_text,reason,decision,origin,changed,confirmed_at,fact_status,created_at FROM revision_samples ORDER BY created_at DESC LIMIT 100').all();}
export function learningStats(){return {concerns:db.prepare('SELECT origin,COUNT(*) count,SUM(CASE WHEN confirmed_at IS NOT NULL THEN 1 ELSE 0 END) confirmed FROM concerns GROUP BY origin').all(),revisions:db.prepare('SELECT COUNT(*) total,SUM(changed) changed,SUM(CASE WHEN confirmed_at IS NOT NULL THEN 1 ELSE 0 END) confirmed FROM revision_samples').get(),captures:db.prepare('SELECT method,body_kind,COUNT(*) count FROM source_captures GROUP BY method,body_kind').all()};}
export function learningReferences(task){
 const terms=[...new Set((task.audience+' '+task.scene).match(/学生|大学|办公|出差|会议|摄影|设计|剪辑|软件|适配|生态|协同|便携|换新|家庭|采购/g)||[])].slice(0,8);
 const candidates=listConcerns().filter(r=>r.confirmed_at&&r.origin!=='simulated'&&r.origin!=='public_topic');
 const concerns=candidates.map(r=>({...r,score:terms.filter(t=>(r.audience+' '+r.scene+' '+r.question).includes(t)).length})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score).slice(0,6).map(r=>({id:r.id,question:r.question,audience:r.audience,scene:r.scene,origin:r.originLabel}));
 const hints=db.prepare("SELECT id,reason FROM revision_samples WHERE confirmed_at IS NOT NULL AND decision='adopted' AND platform=? ORDER BY created_at DESC LIMIT 3").all(task.platform).map(r=>({id:r.id,reason:r.reason}));
 return {concerns,revisionHints:hints};
}
export function exportLearning(){return {version:1,exportedAt:new Date().toISOString(),note:'原始反馈样本，不是已验证训练集；人工修改后尚未自动复核产品事实。模拟问题与真实来源保留独立标签。',concerns:listConcerns(),revisions:db.prepare('SELECT * FROM revision_samples ORDER BY created_at DESC').all().map(r=>({...r,context:JSON.parse(r.context_json)}))};}

export function confirmConcern(id,confirmed){const record=db.prepare('SELECT id FROM concerns WHERE id=?').get(id);if(!record)throw error('顾虑记录不存在',404);db.prepare('UPDATE concerns SET confirmed_at=? WHERE id=?').run(confirmed===true?new Date().toISOString():null,id);return {id,confirmed:confirmed===true};}
export function repairShellMetadata(){
 let repaired=0;const inputs=db.prepare('SELECT sources_json FROM analysis_inputs').all().flatMap(r=>JSON.parse(r.sources_json));
 for(const source of db.prepare("SELECT * FROM sources WHERE kind='post' AND excerpt='' AND state='collected'").all()){
  const last=captures(source.id)[0];if(last?.method!=='browser'||last.payload.excerpt)continue;
  const saved=inputs.find(r=>r.id===source.id);
  db.prepare("UPDATE sources SET state='candidate',title=?,summary=?,reason=?,updated_at=? WHERE id=?").run(saved?.title||source.title,saved?.summary||source.summary,'仅取得平台框架或元信息，未读取原帖正文',new Date().toISOString(),source.id);repaired++;
 }
 return {repaired};
}
