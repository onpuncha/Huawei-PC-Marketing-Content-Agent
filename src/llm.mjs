import {config,assertModelConfig} from './config.mjs';
export class ModelError extends Error {constructor(message,status=502){super(message);this.status=status;}}
export function parseModelJson(text) {
  if(typeof text!=='string')throw new Error('No text content');
  return JSON.parse(text.replace(/^\s*```(?:json)?\s*/,'').replace(/\s*```\s*$/,''));
}
export function extractResponseText(envelope) {
  if(typeof envelope.output_text==='string')return envelope.output_text;
  return (envelope.output || []).filter(item=>item.type==='message').flatMap(item=>item.content || []).filter(item=>item.type==='output_text').map(item=>item.text || '').join('');
}
export async function completeJson(messages,{maxTokens=4500}={}) {
  assertModelConfig();
  const accumulated={prompt_tokens:0,completion_tokens:0,total_tokens:0};let current=messages;
  for(let attempt=0;attempt<2;attempt++) {
    let response;
    try {
      response=await fetch(config.baseUrl+'/responses',{method:'POST',signal:AbortSignal.timeout(config.timeoutMs),headers:{Authorization:'Bearer '+config.apiKey,'Content-Type':'application/json'},body:JSON.stringify({model:config.model,input:current,text:{format:{type:'json_object'}},max_output_tokens:maxTokens,store:false})});
    }catch(err){throw new ModelError(err.name==='TimeoutError'?'GPT 响应超时，请稍后重试。':'无法连接 GPT 中转接口，请检查网络。',504);}
    if(!response.ok){const errors={401:'GPT 凭证无效，请检查 GPT_API_KEY 或 LLM_API_KEY。',402:'GPT 中转账户额度不足。',429:'GPT 接口请求过于频繁，请稍后重试。',400:'GPT 接口拒绝了请求，请确认模型名与 Responses 接入配置。'};throw new ModelError(errors[response.status] || 'GPT 接口暂不可用（HTTP '+response.status+'）。',response.status===429?429:502);}
    let envelope;try{envelope=await response.json();}catch{throw new ModelError('GPT 接口未返回有效 JSON。');}
    if(envelope.status==='incomplete' || envelope.error)throw new ModelError('GPT 输出未完整完成，请缩短任务或重试。');
    accumulated.prompt_tokens+=envelope.usage?.input_tokens || 0;accumulated.completion_tokens+=envelope.usage?.output_tokens || 0;accumulated.total_tokens+=envelope.usage?.total_tokens || 0;
    const text=extractResponseText(envelope);
    try{return {value:parseModelJson(text),model:envelope.model || config.model,usage:accumulated,requestCount:attempt+1};}
    catch{if(attempt===1)throw new ModelError('GPT 连续两次未返回有效内容格式，已停止本次任务。');current=[...messages,{role:'assistant',content:text.slice(0,30000)},{role:'user',content:'上次输出不是合法JSON。遵循原有字段与事实要求，仅返回一个完整有效JSON对象，正确转义字符串。不要输出JSON之外的文字。'}];}
  }
}
