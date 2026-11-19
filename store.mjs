import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import {validMaterial,validPlan} from './public/plan.js';
import {validAcademic} from './public/academic.js';
import {validStudy} from './public/study.js';
const derive = promisify(scrypt);
const hash = s => createHash('sha256').update(s).digest('hex');
export const technicalTopics = ['Redis', 'MySQL', 'Java', 'Python', 'Node.js', 'React', 'Docker', 'Linux', 'TCP', 'Raft', '缓存', '幂等', '并发', '事务', '数据库', '网络', '机器学习', '算法', '竞赛', '测试'];
export const practiceFocus = ['个人贡献', '方案取舍', '结果依据', '技术原理', '适用边界', '表达结构'];
export function redact(text) {
  return String(text || '').replace(/(?:sk-[\w-]{8,}|Bearer\s+[\w.=-]+|[A-Za-z0-9_-]{32,})/gi, '[凭据已移除]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[邮箱已移除]').replace(/\b1[3-9]\d{9}\b/g, '[电话已移除]').replace(/\b\d{17}[\dXx]\b/g, '[证件已移除]')
    .replace(/(?:姓名|电话|手机|住址|地址|学号|身份证|联系)[：:][^\n，,；;]+/g, '[身份信息已移除]')
    .replace(/((?:api[_-]?key|password|secret|token)\s*[:=]\s*)[^\s,;]+/gi, '$1[已移除]');
}
export function studyProfile(records) {
  records = records.filter(s => s.testRun?.kind !== 'ai-dogfood' && !s.drill);
  const joined = records.map(s => [s.project, ...s.turns.map(t => t.text)].join('\n')).join('\n');
  const tags = technicalTopics.filter(t => joined.toLowerCase().includes(t.toLowerCase()));
  const focus = [...new Set(records.flatMap(s => s.turns.flatMap(t => (t.memory?.focus || []).filter(f => practiceFocus.includes(f)))))];
  const directions = [...new Set(records.flatMap(s => [ ...(s.summary?.nextStep?.text ? [redact(s.summary.nextStep.text).slice(0,400)] : []), ...Object.values(s.coaching || {}).flatMap(c => c.nextStep ? [redact(c.nextStep).slice(0, 400)] : []) ]))].slice(0,5);
  return { tags, focus, directions, interviews: records.length, answers: records.reduce((n,s) => n+s.turns.length,0) };
}
export class Store {
  constructor(filename = path.resolve('data/interviews.sqlite')) {
    if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL, shared INTEGER DEFAULT 0, revision INTEGER DEFAULT 0, records TEXT DEFAULT '[]'); CREATE TABLE IF NOT EXISTS logins(token TEXT PRIMARY KEY, userId TEXT, expires INTEGER);`);
    this.attempts = new Map();
  }
  user(req) {
    const token = /(?:^|;\s*)interview_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    if (!token) return null;
    return this.db.prepare('SELECT u.* FROM users u JOIN logins l ON u.id=l.userId WHERE l.token=? AND l.expires>?').get(hash(token), Date.now()) || null;
  }
  async authenticate(name, password, register, address) {
    if (typeof name !== 'string' || !/^[\p{L}\p{N}_-]{3,32}$/u.test(name) || typeof password !== 'string' || password.length < 8 || password.length > 128) throw new Error('用户名需3–32位文字、数字或下划线，密码需8–128位');
    const now = Date.now(), previous = this.attempts.get(address);
    const attempts = previous && now - previous.time < 900000 ? previous : { time: now, count: 0 };
    if (++attempts.count > 15) throw new Error('尝试次数过多，请15分钟后重试'); this.attempts.set(address, attempts);
    const existing = this.db.prepare('SELECT * FROM users WHERE name=?').get(name);
    const salt = existing?.salt || randomBytes(16).toString('hex');
    const computed = Buffer.from(await derive(password, salt, 64));
    if (register) {
      if (existing) throw new Error('该用户名不可用');
      this.db.prepare('INSERT INTO users(id,name,salt,password) VALUES(?,?,?,?)').run(randomUUID(),name,salt,computed.toString('hex'));
    } else if (!existing || !timingSafeEqual(computed, Buffer.from(existing.password, 'hex'))) throw new Error('用户名或密码不正确');
    const user = this.db.prepare('SELECT * FROM users WHERE name=?').get(name), token = randomBytes(32).toString('hex');
    this.db.prepare('DELETE FROM logins WHERE expires<=?').run(now);
    this.db.prepare('INSERT INTO logins VALUES(?,?,?)').run(hash(token),user.id,now+7*86400000);
    return { user, token };
  }
  logout(req) { const token = /interview_session=([a-f0-9]{64})/.exec(req.headers.cookie || '')?.[1]; if (token) this.db.prepare('DELETE FROM logins WHERE token=?').run(hash(token)); }
  state(user) { return { user: { name:user.name, shared:!!user.shared }, revision:user.revision, records:JSON.parse(user.records) }; }
  save(user, records, revision) {
    if (!Array.isArray(records) || records.length > 150 || new Set(records.map(s=>s?.id)).size!==records.length || JSON.stringify(records).length > 5000000 || records.some(s => !s || ![1,2].includes(s.version) || typeof s.id !== 'string' || s.id.length>100 || !['job','academic','project','cache','concurrency'].includes(s.topic) || typeof s.project!=='string' || s.project.length>3000 || !Number.isFinite(s.startedAt) || !Number.isInteger(s.current) || s.current<0 || s.current>(s.plan?.nodes?.length||5) || !Array.isArray(s.turns) || s.turns.length>12 || s.turns.some(t=>!t||typeof t.text!=='string'||t.text.length>5000||typeof t.node!=='string'||(t.memory && (!Array.isArray(t.memory.tags)||!Array.isArray(t.memory.focus)))) || !Array.isArray(s.messages) || s.messages.length>30 || s.messages.some(m=>!m||!['user','assistant'].includes(m.role)||typeof m.text!=='string'||m.text.length>5000) || !s.evidence || (s.coaching && Object.values(s.coaching).some(c=>!c||typeof c.nextStep!=='string'||typeof c.rewrite!=='string'||!Array.isArray(c.strengths)||!Array.isArray(c.improvements)||!Array.isArray(c.missing))))) throw new Error('记录格式或大小不符合要求');
    for (const s of records) if(s.plan && (s.topic!=='job'||!validMaterial(s.material)||!validPlan(s.plan,s.material))) throw new Error('材料考察计划格式不符合要求');
    for (const s of records) if(s.academic && (s.topic!=='academic'||!validAcademic(s.academic))) throw new Error('复试范围或题目安排不符合要求');
    for (const s of records) if(s.drill && (s.topic!=='academic'||!validStudy(s.drill))) throw new Error('专项题目、草稿或答题记录不符合要求');
    for (const s of records) {
      if (s.practiceTask) {
        const p=s.practiceTask;
        if(typeof p.key!=='string'||p.key.length>1000||typeof p.sourceId!=='string'||p.sourceId.length>100||!Number.isInteger(p.index)||p.index<0||p.index>=s.turns.length||typeof p.goal!=='string'||p.goal.length>800||s.finishReason!=='single-practice'||!s.completedAt)throw new Error('单题练习格式不符合要求');
      }
      if(s.practiceDrafts && (typeof s.practiceDrafts!=='object'||Array.isArray(s.practiceDrafts)||Object.entries(s.practiceDrafts).some(([i,text])=>!/^\d+$/.test(i)||Number(i)>=s.turns.length||typeof text!=='string'||text.length>5000)))throw new Error('单题草稿格式不符合要求');
    }
    for (const s of records) if (s.summary) {
      const item = value => value && Number.isInteger(value.answerIndex) && typeof value.text === 'string' && value.text.length<=350 && typeof value.quote === 'string' && value.quote.length<=500 && value.quote.trim() && s.turns[value.answerIndex]?.text.includes(value.quote);
      if (s.summary.version!==1 || !Array.isArray(s.summary.covered) || !Array.isArray(s.summary.unverified) || s.summary.covered.length>3 || s.summary.unverified.length>3 || ![...s.summary.covered,...s.summary.unverified,s.summary.nextStep].every(item)) throw new Error('整轮复盘格式不符合要求');
    }
    const result = this.db.prepare('UPDATE users SET records=?,revision=revision+1 WHERE id=? AND revision=?').run(JSON.stringify(records),user.id,revision);
    return result.changes ? revision+1 : null;
  }
  share(user, enabled) { this.db.prepare('UPDATE users SET shared=? WHERE id=?').run(enabled?1:0,user.id); }
  sharedHints() {
    const users = this.db.prepare('SELECT records FROM users WHERE shared=1').all();
    const counts = new Map();
    for (const u of users) {
      const pairs=new Set(JSON.parse(u.records).filter(s=>s.testRun?.kind!=='ai-dogfood').flatMap(s=>s.turns.flatMap(t=>(t.memory?.tags||[]).filter(tag=>technicalTopics.includes(tag)).flatMap(tag=>(t.memory?.focus||[]).filter(f=>practiceFocus.includes(f)).map(f=>`${tag}|${f}`)))));
      for(const pair of pairs)counts.set(pair,(counts.get(pair)||0)+1);
    }
    // Only fixed vocabulary supported by three distinct opted-in accounts crosses accounts.
    return [...counts].filter(([,n]) => n>=3).sort((a,b)=>b[1]-a[1]).slice(0,30).map(([pair])=>{const [theme,focus]=pair.split('|');return {theme,focus};});
  }
  close() { this.db.close(); }
}
