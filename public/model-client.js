export function reportModelUsage(data) {
  if(data?.modelUsage?.model && typeof globalThis.dispatchEvent==='function' && typeof CustomEvent==='function') {
    globalThis.dispatchEvent(new CustomEvent('interview-model-used',{detail:data.modelUsage}));
  }
}
