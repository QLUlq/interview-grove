// Keep relative file names and balanced excerpts: a short biography cannot act
// as the source of a code interview. This limit is shown to the user explicitly.
export const sourceLimits = { files: 80, characters: 110000, perFile: 6000 };
const supported = /\.(?:md|rst|txt|c|h|cc|cpp|hpp|ino|s|js|jsx|ts|tsx|vue|py|java|go|rs|sql|html|css|cmake|toml)$/i;
const excluded = /(?:^|\/)(?:\.[^/]+|node_modules|vendor|dist|build|coverage|venv|__pycache__|obj|output|fwlib|cmsis|stm32\w*_hal_driver|secrets?|credentials)(?:\/|$)|(?:password|secret|credential|private[-_]?key)|(?:^|\/)(?:license|copying)(?:\.|$)/i;
// Repeated copyright/function-template banners crowd out the implementation in
// short excerpts. Keep protocol explanations and inline comments intact.
export function sourceForReading(text,path) {
  if(!/\.(?:c|h|cc|cpp|hpp|ino)$/i.test(path))return text;
  return text.replace(/\/\*[\s\S]*?\*\//g,block=>/Copyright|函数名称|修改历史|@file\b|@author\b/i.test(block)?'\n':block).replace(/\n[\t ]*\n(?:[\t ]*\n)+/g,'\n\n');
}
export const scopeTerms = value => [...new Set((String(value).toLowerCase().replace(/(?:我(?:主要)?负责|模块|部分|目录|仅限|只问)/g, ' ').match(/[a-z0-9_]{2,}|[\u4e00-\u9fff]{2,}/g) || []))];
export async function collectProjectFiles(files, focus = '') {
  const paths = files.map(file => ({file,path:(file.webkitRelativePath || file.name).replaceAll('\\','/').replace(/[\x00-\x1f]/g,'').slice(0,180)}));
  const readable = paths.filter(({file,path}) => supported.test(path) && !excluded.test(path) && file.size <= 500000);
  const terms=scopeTerms(focus);
  const score=path=>(terms.some(t=>path.toLowerCase().includes(t))?100:0)+(/(?:^|\/)(?:readme|main|app|tasks?|freertos)\b/i.test(path)?20:0);
  // Round-robin directories after prioritising entry points and the chosen module.
  const groups=new Map();
  for(const item of readable.sort((a,b)=>score(b.path)-score(a.path)||a.path.localeCompare(b.path))) {
    const directory=item.path.slice(0,item.path.lastIndexOf('/'));
    if(!groups.has(directory))groups.set(directory,[]);groups.get(directory).push(item);
  }
  const ordered=[];while([...groups.values()].some(g=>g.length)) for(const group of groups.values())if(group.length)ordered.push(group.shift());
  const documents=[];
  for(const {file,path} of ordered) {
    if(documents.length>=sourceLimits.files)break;
    let decoded;
    if(file.arrayBuffer){const buffer=await file.arrayBuffer();try{decoded=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{decoded=new TextDecoder('gb18030').decode(buffer);}}
    else decoded=await file.text();
    const raw=sourceForReading(decoded.replace(/\u0000/g,'').replace(/\r\n?/g,'\n'),path);if(!raw.trim())continue;
    documents.push({path,raw});
  }
  // Redistribute unused room from small headers, rather than giving every file
  // the same tiny excerpt while leaving half the overall budget unused.
  const marker='\n/* …省略中间内容… */\n';
  const payloadBudget=sourceLimits.characters-documents.length*marker.length*2;
  let low=0,high=sourceLimits.perFile;
  while(low<high){const mid=Math.ceil((low+high)/2);if(documents.reduce((n,d)=>n+Math.min(d.raw.length,mid),0)<=payloadBudget)low=mid;else high=mid-1;}
  const sources=[];let characters=0,clipped=0;
  for(const {path,raw} of documents) {
    const room=low;
    let text=raw;
    if(raw.length>room){clipped++;const head=Math.floor(room*.5),mid=Math.floor(room*.25),tail=room-head-mid;const center=Math.floor(raw.length/2);text=raw.slice(0,head)+marker+raw.slice(center,center+mid)+marker+raw.slice(-tail);}
    sources.push({id:`s${sources.length}`,path,text});characters+=text.length;
  }
  if(!sources.length)throw new Error('未找到可读取的代码或说明文件，请选择源代码目录');
  return {sources,coverage:{selected:files.length,readable:readable.length,included:sources.length,clipped,omitted:readable.length-sources.length,characters,excluded:files.length-readable.length}};
}
