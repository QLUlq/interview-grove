import { createVerification } from './framework.js';
import { academicSettings, academicAnchor } from './academic.js';

export const recordTrack = record => record?.topic === 'academic' ? 'academic' : 'job';
export const questionKey = text => String(text).toLowerCase().replace(/[\s，。！？、；：“”‘’]/gu, '');
export const oralRatings = { unsure: '还不会', practice: '需要再练', understood: '暂时理解' };
export function validStudyQuestions(questions) {
  const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;
  return Array.isArray(questions) && questions.length > 0 && questions.length <= 5 && new Set(questions.map(q => q?.id)).size === questions.length && new Set(questions.map(q => questionKey(q?.stem))).size === questions.length && questions.every(q => q && text(q.id,100) && text(q.stem,700) && text(q.topic,120) && (q.kind === 'choice' ? Array.isArray(q.options) && q.options.length === 4 && q.options.every(o=>text(o,600)) && new Set(q.options.map(questionKey)).size === 4 && Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < 4 && text(q.explanation,2000) : q.kind === 'oral' && text(q.reference,2000)));
}
export function validStudy(drill) {
  try { academicSettings(drill?.settings); } catch { return false; }
  if (drill.version !== 1 || !validStudyQuestions(drill.questions) || !Array.isArray(drill.attempts) || drill.attempts.length > 1000 || !drill.drafts || typeof drill.drafts !== 'object' || Array.isArray(drill.drafts)) return false;
  const validAnswer = (id, answer, draft=false) => {
    const q=drill.questions.find(q=>q.id===id);
    return q && (q.kind==='choice' ? Number.isInteger(answer) && answer >= (draft?-1:0) && answer<4 : typeof answer==='string' && answer.length<=5000 && (draft || answer.trim()));
  };
  return drill.attempts.every(a=>a && Number.isFinite(a.at) && validAnswer(a.questionId,a.answer) && (a.selfRating===undefined || (drill.questions.find(q=>q.id===a.questionId)?.kind==='oral' && Object.hasOwn(oralRatings,a.selfRating)))) && Object.entries(drill.drafts).every(([id,answer])=>validAnswer(id,answer,true));
}
export function createStudy(settings, questions, source=null) {
  settings=academicSettings(settings);
  if(!validStudyQuestions(questions))throw new Error('题目格式不正确，请重新生成');
  const record=createVerification('academic','专项刷题',{anchor:academicAnchor(settings)});
  record.messages=[];record.runtime='ai';
  record.drill={version:1,settings,questions:structuredClone(questions),attempts:[],drafts:{},...(source?{source}: {})};
  return record;
}
export function submitStudy(record, id, answer) {
  const next=structuredClone(record),q=next.drill?.questions.find(q=>q.id===id);
  if(!q)throw new Error('题目不存在');
  if(q.kind==='oral'){if(typeof answer!=='string')throw new Error('请填写口头回答');answer=answer.trim();}
  next.drill.attempts.push({questionId:id,answer,at:Date.now()});delete next.drill.drafts[id];
  if(!validStudy(next.drill))throw new Error('请选择一个选项，或填写1–5000字的回答');
  next.completedAt=next.drill.questions.every(q=>next.drill.attempts.some(a=>a.questionId===q.id))?Date.now():null;
  return next;
}
export function studyResult(question, attempt) {
  return question.kind==='choice' ? {correct:attempt.answer===question.correctIndex,answer:question.options[question.correctIndex],explanation:question.explanation} : {reference:question.reference};
}
export function rateStudy(record, id, rating) {
  const next=structuredClone(record),q=next.drill?.questions.find(q=>q.id===id);
  const last=next.drill?.attempts.filter(a=>a.questionId===id).at(-1);
  if(q?.kind!=='oral'||!last||Object.hasOwn(next.drill.drafts,id)||!Object.hasOwn(oralRatings,rating))throw new Error('请先提交口头回答，再标记本次理解情况');
  last.selfRating=rating;
  return next;
}
// Derived from saved attempts: an earlier mistake remains visible after a correct retry.
export function studyReviewItems(records,{status='pending',range='',keyword=''}={}) {
  const search=keyword.trim().toLowerCase();
  return records.filter(s=>s.topic==='academic'&&s.drill&&s.testRun?.kind!=='ai-dogfood').flatMap(record=>record.drill.questions.flatMap(question=>{
    const attempts=record.drill.attempts.filter(a=>a.questionId===question.id),last=attempts.at(-1);
    if(!last)return [];
    const wrong=question.kind==='choice'&&attempts.some(a=>a.answer!==question.correctIndex);
    const pending=question.kind==='choice'?wrong:last.selfRating!=='understood';
    return [{record,question,attempts,last,wrong,pending}];
  })).filter(item=>(!range||item.record.drill.settings.range===range)&&(!search||[item.question.topic,item.question.stem,item.record.drill.settings.scope,item.record.drill.settings.major].some(t=>t.toLowerCase().includes(search)))&&(status==='all'||(status==='wrong'?item.wrong:status==='understood'?item.question.kind==='oral'&&item.last.selfRating==='understood':item.pending))).sort((a,b)=>b.last.at-a.last.at);
}
