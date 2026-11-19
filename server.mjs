import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { answerWithModel, coachAnswer, summarizeSession, extractMaterials, startMaterialInterview, startAcademicInterview, generateStudyQuestions, modelConfig, ModelError } from './model.mjs';
import { Store, studyProfile } from './store.mjs';
import { beginModelRequest, routingStatus } from './model-routing.mjs';
import { createLocalSpeech } from './local-speech.mjs';

const root = path.resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
export function createServer(config = modelConfig(), fetcher = fetch, storage, speech = createLocalSpeech()) {
config={...beginModelRequest(config),usage:undefined};
const store = storage || new Store();
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) { json(res, 403, { error: '仅允许本机访问。' }); return; }
    if (url.pathname.startsWith('/api/')) {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) { json(res, 403, { error: '不允许跨站请求。' }); return; }
      if (req.method === 'GET' && url.pathname === '/api/model/status') { json(res, 200, routingStatus(config)); return; }
      const user = store.user(req);
      if(req.method==='GET'&&url.pathname==='/api/voice/status'){json(res,200,{...await speech.status(),owner:user?.name||'guest'});return;}
      if(req.method==='GET' && url.pathname==='/api/account') { json(res,200,user?store.state(user):{user:null});return; }
      if(req.method==='GET' && url.pathname==='/api/practice') { if(!user) {json(res,401,{error:'请先登录'});return;}json(res,200,{profile:studyProfile(JSON.parse(user.records))});return; }
      if (req.method !== 'POST' || !['/api/voice/transcribe','/api/academic/questions','/api/interview/start','/api/interview/answer', '/api/interview/coach','/api/interview/summary','/api/materials','/api/auth/register','/api/auth/login','/api/auth/logout','/api/records','/api/sharing'].includes(url.pathname)) { json(res, 404, { error: '接口不存在。' }); return; }
      if (!req.headers['content-type']?.startsWith('application/json')) { json(res, 415, { error: '请使用 JSON 请求。' }); return; }
      const chunks = []; let bytes = 0;
      const limit = url.pathname==='/api/voice/transcribe'?2700000:url.pathname==='/api/materials' ? 6500000 : url.pathname==='/api/records' ? 5500000 : url.pathname.startsWith('/api/interview/') ? 1500000 : 250000;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > limit) throw new ModelError('内容过大，请减少材料或记录。', 413); chunks.push(chunk); }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ModelError('请求格式不正确。', 400); }
      if(url.pathname.startsWith('/api/auth/')) {
        if(url.pathname.endsWith('/logout')) {if(user && body?.owner!==user.name){json(res,409,{error:'账号已在其他窗口切换。请先备份当前记录，再刷新页面。'});return;}store.logout(req);res.setHeader('Set-Cookie','interview_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');json(res,200,{ok:true});return;}
        try {const result=await store.authenticate(body?.name,body?.password,url.pathname.endsWith('/register'),req.socket.remoteAddress);res.setHeader('Set-Cookie',`interview_session=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);json(res,200,store.state(result.user));} catch(error){json(res,400,{error:error.message});}return;
      }
      if(url.pathname==='/api/records'||url.pathname==='/api/sharing') {
        if(!user){json(res,401,{error:'请先登录'});return;}
        if(body?.owner!==user.name){json(res,409,{error:'账号已在其他窗口切换。请先备份当前记录，再刷新页面。'});return;}
        if(url.pathname==='/api/sharing'){store.share(user,body?.enabled===true);json(res,200,{ok:true});return;}
        try {const revision=store.save(user,body?.records,body?.revision);json(res,revision===null?409:200,revision===null?{error:'其他窗口已更新记录。请先下载当前记录备份，再刷新页面加载最新版本。'}:{revision});}catch(error){json(res,400,{error:error.message});}return;
      }
      const requestConfig={...config,usage:{}};
      if(url.pathname==='/api/materials'){const data=await extractMaterials(body,requestConfig,fetcher);json(res,200,{...data,modelUsage:requestConfig.usage});return;}
      if((body?.owner||'guest')!==(user?.name||'guest')) {json(res,409,{error:'账号已在其他窗口切换。请先备份当前记录，再刷新页面。'});return;}
      if(url.pathname==='/api/voice/transcribe'){
        const cancellation=new AbortController(),closed=()=>{if(!res.writableEnded)cancellation.abort();};res.on('close',closed);
        try{json(res,200,await speech.transcribe(body.audio,cancellation.signal));}finally{res.removeListener('close',closed);}return;
      }
      if(url.pathname==='/api/academic/questions') {
        if(!user){json(res,401,{error:'请先登录，再生成并保存复试专项题。'});return;}
        json(res,200,{...await generateStudyQuestions(body,requestConfig,fetcher,JSON.parse(user.records)),modelUsage:requestConfig.usage});return;
      }
      if (url.pathname === '/api/interview/start') { json(res,200,{session:await (body?.track==='academic'?startAcademicInterview(body,requestConfig,fetcher):startMaterialInterview(body,requestConfig,fetcher)),modelUsage:requestConfig.usage});return; }
      if (url.pathname === '/api/interview/summary') { json(res, 200, { summary: await summarizeSession(body?.session, requestConfig, fetcher),modelUsage:requestConfig.usage }); return; }
      if (url.pathname === '/api/interview/coach') { json(res, 200, { coaching: await coachAnswer(body?.session, body?.index, requestConfig, fetcher),modelUsage:requestConfig.usage }); return; }
      const personal=user?studyProfile(JSON.parse(user.records)):null;
      const context = `${body?.session?.project||''} ${body?.answer||''}`.toLowerCase();
      const shared=store.sharedHints().filter(h=>context.includes(h.theme.toLowerCase()));
      const next = await answerWithModel(body?.session, body?.answer, {...requestConfig,personal,shared}, fetcher);
      json(res, 200, { session: next,modelUsage:requestConfig.usage }); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!target.startsWith(root + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (req.url?.startsWith('/api/')) json(res, error instanceof ModelError ? error.status : 500, { error: error instanceof ModelError ? error.message : '请求未完成，回答已保留，请重试。' });
    else res.writeHead(404).end('Not found');
  }
});
if(!storage) server.on('close',()=>store.close());
return server;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.loadEnvFile(fileURLToPath(new URL('./.env', import.meta.url))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const config = modelConfig();
  createServer(config).listen(Number(process.env.PORT || 3001), '127.0.0.1', () => console.log(`Interview Grove: http://localhost:${process.env.PORT || 3001} (${config.key ? `AI configured · ${config.model}` : 'demo mode'})`));
}
