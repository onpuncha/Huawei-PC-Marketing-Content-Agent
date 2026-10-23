import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Minimal .env reader: OS-provided values take priority. Never log values.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]]) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[m[1]] = value;
  }
}
function discoverKnowledgeRoot() {
  if (process.env.LOCAL_KB_PATH?.trim()) return path.resolve(ROOT, process.env.LOCAL_KB_PATH.trim());
  if(fs.existsSync(path.join(ROOT,'data','P1-产品参数库')))return path.join(ROOT,'data');
  const parent = fs.existsSync(path.join(ROOT,'华为PC知识库'))?path.join(ROOT,'华为PC知识库'):path.join(ROOT,'..','华为PC知识库');
  if (!fs.existsSync(parent)) return parent;
  if (fs.existsSync(path.join(parent, 'P1-产品参数库'))) return parent;
  return fs.readdirSync(parent, {withFileTypes: true}).filter(d => d.isDirectory()).map(d => path.join(parent, d.name))
    .find(p => fs.existsSync(path.join(p, 'P1-产品参数库'))) || parent;
}
export const config = {
  port: Number(process.env.PORT || process.env.GPT_PORT || 7860), host: process.env.HOST || '0.0.0.0', kbRoot: discoverKnowledgeRoot(),
  apiKey: process.env.GPT_API_KEY || process.env.LLM_API_KEY || '', model: process.env.GPT_MODEL || 'gpt-6.1-sol',
  baseUrl: (process.env.GPT_BASE_URL || 'https://4router.net/v1').replace(/\/$/, ''),
  cacheDir: path.join(ROOT, '.cache', 'gpt'), timeoutMs: 120000,
};
export function assertModelConfig() {
  if (!config.apiKey) throw Object.assign(new Error('未配置 GPT_API_KEY 或 LLM_API_KEY。请配置中转站密钥后重新启动。'), {status:503});
  const url = new URL(config.baseUrl);
  if (url.protocol !== 'https:' || !['4router.net','api.openai.com'].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw Object.assign(new Error('GPT 版仅允许已配置的 4router 或 OpenAI 官方 HTTPS 接口。'), {status:503});
  }
}
