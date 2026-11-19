export async function api(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(path === '/api/materials' ? 55000 : 12000) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '请求未完成，请稍后重试'); return data;
}

export function createAccount({ getRecords, onState, onStatus }) {
  let user = null, revision = 0, dirty = false, timer, running = null;
  async function flush() {
    clearTimeout(timer);
    if (running) { await running; if (dirty) return flush(); return; }
    if (!user || !dirty) return;
    running = (async () => {
      while (dirty) {
        dirty = false; onStatus('正在保存');
        try { const result = await api('/api/records', { owner: user.name, records: structuredClone(getRecords()), revision }); revision = result.revision; onStatus(dirty ? '正在保存' : '已保存到账号'); }
        catch (error) { dirty = true; onStatus('保存失败 · 点击重试或备份'); throw error; }
      }
    })();
    try { await running; } finally { running = null; }
  }
  function accept(state) { user = state.user; revision = state.revision || 0; dirty = false; onState(user, state.records || []); onStatus(user ? '已保存到账号' : '访客 · 当前浏览器保存'); }
  return {
    get user() { return user; }, get unsaved() { return dirty || !!running; },
    async init() { accept(await api('/api/account')); },
    async authenticate(name, password, register) { await flush(); accept(await api(register ? '/api/auth/register' : '/api/auth/login', { name, password })); },
    async logout() { await flush(); await api('/api/auth/logout', { owner: user?.name }); accept({ user: null }); },
    save() { if (!user) return; dirty = true; onStatus('等待保存'); clearTimeout(timer); timer = setTimeout(() => flush().catch(() => {}), 500); },
    async share(enabled) { await api('/api/sharing', { owner: user.name, enabled }); user.shared = enabled; },
    flush
  };
}

export function downloadRecords(records) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = '面向-面试记录备份.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
