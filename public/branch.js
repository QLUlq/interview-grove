import { sessionContext } from './interview-context.js';

export function branchSession(source, index, nodes) {
  if (!Number.isInteger(index) || index<0 || index>=source.turns.length) throw new Error('请选择已回答的一题');
  const next=structuredClone(source), selected=source.turns[index];
  next.id=crypto.randomUUID(); next.parentId=source.id; next.rootId=source.rootId||source.id; next.branchAt=index; next.startedAt=Date.now(); next.completedAt=null; delete next.finishReason; delete next.coaching; delete next.summary; delete next.summaryError;
  delete next.practiceTask; delete next.practiceDrafts;
  let users=0, cut=source.messages.findIndex(m=>m.role==='user' && users++===index);
  if(cut<0) throw new Error('原记录的回答不完整，无法创建分支');
  next.messages=structuredClone(source.messages.slice(0,cut)); next.turns=structuredClone(source.turns.slice(0,index)); next.decisions=structuredClone((source.decisions||[]).filter(d=>d.answerIndex<index));
  next.current=nodes.findIndex(n=>n.id===selected.node); if(next.current<0) throw new Error('题树已更新，无法继续此分支');
  let count=0; for(let i=index-1;i>=0 && source.turns[i].node===selected.node;i--) count++;
  next.followupCount=count; next.followup=count>0; next.askedRules=next.decisions.filter(d=>d.action==='followup').map(d=>`${d.node}:${d.rule}`); next.evidence={};
  for(const t of next.turns) {const n=nodes.find(n=>n.id===t.node); const e=next.evidence[t.node] ||= {label:n.label,target:n.target,samples:[],hits:[],signals:[],status:'已记录，待核实'};e.samples.push(t.text); e.signals.push(...(t.signals||[]));e.hits=[...new Set([...e.hits,...(t.hits||[])])];}
  next.context=sessionContext(next); next.draft=selected.text; return next;
}
