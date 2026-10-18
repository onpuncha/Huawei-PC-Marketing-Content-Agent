import {supplementEvidence,deduplicateLocalImages} from './vmall.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.mjs';

export function parseCsv(text) {
  const rows=[]; let row=[], cell='', quoted=false;
  text=text.replace(/^\uFEFF/, '');
  for (let i=0; i<text.length; i++) {
    const c=text[i];
    if (c==='"') {if (quoted && text[i+1]==='"') {cell+='"';i++;} else quoted=!quoted;}
    else if (c===',' && !quoted) {row.push(cell);cell='';}
    else if ((c==='\n' || c==='\r') && !quoted) {
      if(c==='\r' && text[i+1]==='\n') i++;
      row.push(cell);if(row.some(Boolean)) rows.push(row);row=[];cell='';
    } else cell+=c;
  }
  if(cell || row.length) {row.push(cell);rows.push(row);}
  const header=rows.shift() || [];
  return rows.map(r=>Object.fromEntries(header.map((h,i)=>[h,r[i] || ''])));
}
export function resolveInside(root, relative) {
  const candidate=path.resolve(root,relative);
  const normalized=path.relative(root,candidate);
  if(normalized.startsWith('..') || path.isAbsolute(normalized)) throw new Error('文件路径超出知识库范围');
  const realRoot=fs.realpathSync(root), realFile=fs.realpathSync(candidate);
  const realRelative=path.relative(realRoot,realFile);
  if(realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('文件链接超出知识库范围');
  return realFile;
}
const relativePath=p=>p.split(path.sep).join('/');
const productId=p=>crypto.createHash('sha256').update(relativePath(p)).digest('hex').slice(0,14);
export function extractSections(raw) {
  const parts=raw.replace(/^\uFEFF/, '').split(/^##\s+/m).slice(1);
  const facts=[], warnings=[];
  for(const section of parts) {
    const newline=section.indexOf('\n');
    const title=(newline<0 ? section : section.slice(0,newline)).trim();
    let content=(newline<0 ? '' : section.slice(newline+1)).trim();
    if(!content || /^(来源|官方规格摘录)$/.test(title)) continue;
    if(/尺寸与重量/.test(title)) {
      const dimensions=[...content.matchAll(/(长度|宽度|深度|高度|厚度)\s*\n+\s*(\d+(?:\.\d+)?)\s*mm/g)];
      if(dimensions.some(m=>(m[1]==='厚度' && +m[2]>50) || (m[1]==='长度' && +m[2]<50))) {
        warnings.push('本地尺寸字段疑似错位，长宽厚参数已排除；需要官方规格页人工复核。');
        const weight=content.match(/(?:^|\n)重量\s*\n+([\s\S]*)/);
        content=weight ? '重量\n\n'+weight[1].trim() : '';
      }
    }
    if(!content) continue;
    facts.push({id:'F'+String(facts.length+1).padStart(2,'0'),title,content});
  }
  return {facts,warnings};
}
export class LocalKnowledge {
  constructor(root=config.kbRoot) {this.root=root;this.products=[];this.error='';this.initialize();}
  initialize() {
    try {
      const matrix=path.join('P1-产品参数库','00-全库横向索引','全型号参数联合矩阵.csv');
      const rows=parseCsv(fs.readFileSync(resolveInside(this.root,matrix),'utf8'));
      this.products=rows.map(row=>{
        const relative=row['本地事实源'];
        const factFile=resolveInside(this.root,relative);
        const raw=fs.readFileSync(factFile,'utf8');
        const heading=raw.match(/^#\s+(.+?)(?:\s*[-—]\s*产品事实)?\s*$/m)?.[1] || row['型号'];
        return {id:productId(relative),name:heading,shortName:row['型号'],system:row['操作系统'],processor:row['处理器'],relative:relativePath(relative),directory:path.dirname(factFile),raw};
      });
    } catch {this.error='未找到可用知识库。请将 LOCAL_KB_PATH 指向含有 P1-产品参数库 的解压目录。';}
  }
  catalog() {return this.products.map(({id,name,shortName,system})=>({id,name,shortName,system}));}
  get(id) {const p=this.products.find(p=>p.id===id);if(!p)throw Object.assign(new Error('请选择知识库中明确的产品型号。'),{status:422});return p;}
  retrieve(id,platform) {
    const product=this.get(id);
    const {facts,warnings}=extractSections(product.raw);
    const sourceUrls=[...new Set(product.raw.match(/https:\/\/[^\s)<>]+/g) || [])].filter(u=>{try{return ['consumer.huawei.com','www.vmall.com','vmall.com'].includes(new URL(u).hostname);}catch{return false;}});
    const imageFile=path.join(product.directory,'图片索引.csv');
    let images=[];
    if(fs.existsSync(imageFile)) images=parseCsv(fs.readFileSync(imageFile,'utf8')).map((row,index)=>{
      const name=row['文件名'];
      const relative=path.relative(this.root,path.join(product.directory,'images',name));
      let available=false;
      try {available=fs.statSync(resolveInside(this.root,relative)).isFile();}catch{}
      return {id:'I'+String(index+1).padStart(2,'0'),name,model:row['产品型号'],pageUrl:row['来源页面'],originalUrl:row['原始图片URL'],description:row['官网图片说明'],usage:row['建议用途'],width:+row['宽度'],height:+row['高度'],available,relative:relativePath(relative),url:'/api/images/'+product.id+'/'+index};
    }).filter(im=>im.available && im.model===product.name);
    const conflictedImages=images.filter(im=>/processor|chipset|(?:^|[-_/])cpu(?:[-_.\/]|$)/i.test(im.originalUrl) && /机身|轻薄|屏幕|键盘|接口/.test(im.description));
    for(const im of conflictedImages) warnings.push('图片“'+im.name+'”的说明与原始资源路径不一致，已排除并待人工复核。');
    images=images.filter(im=>!conflictedImages.includes(im));
    if(!images.length) warnings.push('当前型号没有可用且型号完全匹配的图片，配图需人工补充。');
    const guideName={xiaohongshu:'小红书图文模板.md',wechat:'微信公众号图文模板.md',moments:'销售朋友圈模板.md',poster:'门店海报图文模板.md'}[platform];
    let guide='';
    if(guideName) {try{guide=fs.readFileSync(resolveInside(this.root,path.join('P6-营销素材库','02-平台模板',guideName)),'utf8');}catch{}}
    const context={product:{id:product.id,name:product.name,system:product.system},facts,images,source:{kind:'local',title:'产品事实.md',path:product.relative,urls:sourceUrls,sha256:crypto.createHash('sha256').update(product.raw).digest('hex'),snapshotDate:product.raw.match(/抓取日期[：:]\s*(\d{4}-\d{2}-\d{2})/)?.[1] || '未标注'},warnings,guide};
    return deduplicateLocalImages(supplementEvidence(context,product),this.root);
  }
  image(id,index) {
    if(!/^\d+$/.test(String(index)))throw Object.assign(new Error('图片不存在'),{status:404});
    const product=this.get(id);
    const rows=parseCsv(fs.readFileSync(path.join(product.directory,'图片索引.csv'),'utf8'));
    const row=rows[Number(index)];
    if(!row || row['产品型号']!==product.name)throw Object.assign(new Error('图片不存在'),{status:404});
    return resolveInside(this.root,path.relative(this.root,path.join(product.directory,'images',row['文件名'])));
  }
  source(id) {return this.get(id).raw;}
}
