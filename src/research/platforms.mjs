import crypto from 'node:crypto';
export const PLATFORMS = {
  xiaohongshu:{label:'小红书',domains:['www.xiaohongshu.com','xiaohongshu.com','xhslink.com'],site:'xiaohongshu.com',search:q=>'https://www.xiaohongshu.com/search_result?keyword='+encodeURIComponent(q)},
  douyin:{label:'抖音',domains:['www.douyin.com','douyin.com','v.douyin.com'],site:'douyin.com/video',search:q=>'https://www.douyin.com/search/'+encodeURIComponent(q)},
  weibo:{label:'微博',domains:['weibo.com','www.weibo.com','m.weibo.cn'],site:'weibo.com',search:q=>'https://s.weibo.com/weibo?q='+encodeURIComponent(q)},
  wechat:{label:'微信公众号',domains:['mp.weixin.qq.com'],site:'mp.weixin.qq.com',search:q=>'https://weixin.sogou.com/weixin?type=2&query='+encodeURIComponent(q)},
};
export const OFFICIAL_DOMAINS=['consumer.huawei.com','www.vmall.com','vmall.com'];
export const KEYWORDS=['华为电脑 选购','华为电脑 大学生','华为 多屏协同','华为 电脑 移动办公','华为 门店 体验','华为 选购 顾虑'];
export const ALLOWED_DOMAINS=[...new Set([...Object.values(PLATFORMS).flatMap(p=>p.domains),...OFFICIAL_DOMAINS])];
export function sourceUrl(value){
  let u;try{u=new URL(String(value));}catch{throw Object.assign(new Error('请输入完整 HTTPS 原帖或华为官方链接'),{status:422});}
  if(u.protocol!=='https:' || u.username || u.password || (u.port && u.port!=='443') || !ALLOWED_DOMAINS.includes(u.hostname))throw Object.assign(new Error('仅支持四个平台及华为官方 HTTPS 页面'),{status:422});
  u.hash='';
  const platform=Object.keys(PLATFORMS).find(k=>PLATFORMS[k].domains.includes(u.hostname)) || 'official';
  if(platform==='wechat'){
    if(!/^\/s(?:\/|$)/.test(u.pathname))throw Object.assign(new Error('请使用公众号文章链接（mp.weixin.qq.com/s）'),{status:422});
    for(const key of [...u.searchParams.keys()])if(!['__biz','mid','idx','sn'].includes(key))u.searchParams.delete(key);
  }else{
    for(const key of [...u.searchParams.keys()])if(/^(utm_|spm|from|source|share_|timestamp|scene|fbclid)/i.test(key))u.searchParams.delete(key);
  }
  if(['xiaohongshu','douyin','weibo'].includes(platform)&&!['xhslink.com','v.douyin.com'].includes(u.hostname)){u.search='';}
  u.searchParams.sort();
  if(platform==='xiaohongshu' && !/^\/(explore|discovery\/item)\/[^/]+/.test(u.pathname) && u.hostname!=='xhslink.com')throw Object.assign(new Error('请提供小红书笔记原帖链接'),{status:422});
  if(platform==='douyin' && !/^\/(video|note)\/\d+/.test(u.pathname) && u.hostname!=='v.douyin.com')throw Object.assign(new Error('请提供抖音视频或图文原帖链接'),{status:422});
  if(platform==='weibo' && !/^\/(?:2\/detail\/\d+|detail\/\d+|status\/[A-Za-z0-9]+|\d+\/[A-Za-z0-9]+)\/?$/.test(u.pathname))throw Object.assign(new Error('请提供微博正文链接'),{status:422});
  return {url:u.href,platform,kind:platform==='official'?(u.pathname.includes('/support/')?'guide':'product'):'post'};
}
export function idFor(url){return crypto.createHash('sha256').update(url).digest('hex').slice(0,24);}
export function searchPlan(keywords=KEYWORDS,platforms=Object.keys(PLATFORMS)){
  return platforms.flatMap(platform=>keywords.map(keyword=>({platform,label:PLATFORMS[platform].label,keyword,query:`site:${PLATFORMS[platform].site} ${keyword}`,url:PLATFORMS[platform].search(keyword)})));
}
export const cleanText=(s,max=16000)=>String(s??'').replace(/\u0000/g,'').trim().slice(0,max);
export const error=(message,status=422)=>Object.assign(new Error(message),{status});

export function relevance(record){
 const text=[record.title,record.summary,record.excerpt].filter(Boolean).join(' ');
 if(!text.trim())return {usable:false,reason:'仅取得链接，尚无可分析的文字'};
 if(/汽车|问界|智界|享界|赛力斯|新车|车展/.test(text)&&!/电脑|笔记本|MateBook|平板|MatePad|手机|Pura|Mate\s*\d+/i.test(text))return {usable:false,reason:'主要为汽车内容，与本轮电脑、手机、平板场景不符'};
 return {usable:true,reason:''};
}
