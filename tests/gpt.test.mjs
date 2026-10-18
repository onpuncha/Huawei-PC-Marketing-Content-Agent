import test from 'node:test';import assert from 'node:assert/strict';
import {extractMallProducts,matchesMallProduct,supplementEvidence} from '../src/vmall.mjs';
import {extractResponseText} from '../src/llm.mjs';
test('Responses adapter extracts only message output, excludes reasoning',()=>{
 const body={output:[{type:'reasoning',summary:[{text:'private'}]},{type:'message',content:[{type:'output_text',text:'{"ok":true}'}]}]};assert.equal(extractResponseText(body),'{"ok":true}');
});
test('mall cards use exact product+processor, never generic MateBook substring',()=>{
 assert.ok(matchesMallProduct({name:'HUAWEI MateBook Pro S'},{name:'HUAWEI MateBook Pro S'}));
 assert.ok(!matchesMallProduct({name:'HUAWEI MateBook Pro'},{name:'HUAWEI MateBook Pro S'}));
 assert.ok(!matchesMallProduct({name:'HUAWEI MateBook D 14 2024'},{name:'HUAWEI MateBook 14 鸿蒙版'}));
 assert.ok(!matchesMallProduct({name:'HUAWEI MateBook Fold 非凡大师',processor:'旧款处理器'},{name:'HUAWEI MateBook Fold 非凡大师 麒麟X90 Plus'}));
});
test('mall material crops grouped and videos/external images excluded',()=>{
 const cards=extractMallProducts({item:{prdName:'HUAWEI MateBook Pro S',prdId:12345,skuCode:'SKU',photoPath:'/images/',photoName:'main.png',materialPhotos:[{type:27,ratio:'1:1',photoPath:'/images/a.jpg'},{type:27,ratio:'16:9',photoPath:'/images/a-crop.jpg'},{type:25,photoPath:'/images/video.mp4'},{type:23,photoPath:'https://evil.example/pic.jpg'}]}});
 assert.equal(cards.length,1);assert.equal(cards[0].images.length,2);assert.ok(cards[0].images.every(i=>i.url.startsWith('https://res.vmallres.com/')));
});
