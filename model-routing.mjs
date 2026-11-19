const states = new WeakMap();
export class ModelError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
export function modelList(value) {
  return [...new Set(String(value || '').split(/[,\s]+/).filter(Boolean))].filter(s => /^[\w.-]{1,120}$/.test(s)).slice(0, 6);
}
function stateFor(config) {
  if (config.routing) return config.routing;
  if (!states.has(config)) states.set(config, { exhausted: new Set(), active: {} });
  return states.get(config);
}
export function beginModelRequest(config) {
  return { ...config, routing: stateFor(config), usage: config.usage || {} };
}
export function usedModel(config) { return config.usage?.model || config.routing?.active.text || config.model; }
function pool(config, vision = false) {
  return [...new Set(vision ? (config.visionModels?.length ? config.visionModels : [config.model]) : [config.model, ...(config.fallbackModels || [])])];
}
export function routingStatus(config) {
  const state = stateFor(config), models = pool(config);
  const active=state.exhausted.has(state.active.text)?null:state.active.text;
  const result = { configured: !!config.key, model: config.key ? active || models.find(m => !state.exhausted.has(m)) || config.model : null };
  if (config.fallbackModels?.length || config.visionModels?.length) Object.assign(result, { models, visionModels: pool(config, true), exhausted: [...state.exhausted], automaticFallback: models.length > 1 });
  return result;
}
function thinking(config, model) {
  let host = ''; try { host = new URL(config.base).hostname; } catch {}
  if (/(?:^|\.)(?:dashscope|maas)\.aliyuncs\.com$/.test(host) && /^qwen3\.(?:5|7)-plus(?:-|$)/.test(model)) return { enable_thinking: config.thinking === true };
  return model === config.model && typeof config.enableThinking === 'boolean' ? { enable_thinking: config.enableThinking } : {};
}
export async function requestModelJSON(config, messages, fetcher, validate) {
  if (!config.key) throw new ModelError('尚未配置模型密钥，请先在本机 .env 文件中完成配置。', 503);
  const vision = messages.some(m => Array.isArray(m.content) && m.content.some(c => c.type === 'image_url'));
  const state = stateFor(config), kind = vision ? 'vision' : 'text', candidates = pool(config, vision);
  const available = candidates.filter(m => !state.exhausted.has(m));
  const preferred = state.active[kind];
  if (available.includes(preferred)) available.splice(0, 0, ...available.splice(available.indexOf(preferred), 1));
  const deadline = Date.now() + 45000;
  let switchedFrom;
  for (const model of available) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new ModelError('等待模型超时，原回答已保留，请重试。');
        const response = await fetcher(`${config.base.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST', signal: AbortSignal.timeout(remaining),
          headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, stream: false, max_tokens: config.maxOutputTokens || 2200, ...thinking(config, model), response_format: { type: 'json_object' }, messages })
        });
        if (!response.ok) {
          let code; try { const data = await response.json(); code = data.error?.code || data.code; } catch {}
          // Only explicit per-model allocation errors trigger switching. Account
          // arrears, keys, permissions and ordinary rate limits are not exhaustion.
          const quota = ['AllocationQuota.FreeTierOnly', 'Throttling.AllocationQuota', 'insufficient_quota'].includes(code);
          if (quota && [403, 429].includes(response.status)) {
            state.exhausted.add(model); switchedFrom ||= model;
            break;
          }
          if ([429, 500, 502, 503].includes(response.status) && attempt === 0 && deadline - Date.now() > 5000) continue;
          throw new ModelError(response.status === 402 ? '模型 API 账户额度不足，请检查服务商的账户余额。' : response.status === 401 ? '模型密钥无效或与接口不匹配，请检查本机配置。' : response.status === 403 ? '模型访问被拒绝，请检查账号权限、地域或账户状态。' : response.status === 404 ? `模型 ${model} 或接口不存在，请检查模型名称及接口地址。` : response.status === 429 ? '模型请求过于频繁，请稍后重试。' : '模型服务暂时不可用，请稍后重试。', 502);
        }
        const data = await response.json(), choice = data.choices?.[0];
        if (!choice || (choice.finish_reason && choice.finish_reason !== 'stop')) throw new Error('incomplete');
        // Validators that create sessions can attribute the result to this exact
        // request even while another user's request switches the shared pool.
        if (config.usage) config.usage.model = model;
        const result = validate(JSON.parse(choice.message.content));
        state.active[kind] = model;
        if (config.usage && switchedFrom) Object.assign(config.usage, { switchedFrom, reason: 'free-quota' });
        return result;
      } catch (error) {
        if (error instanceof ModelError && !error.message.includes('校验')) throw error;
        if (attempt === 0 && deadline - Date.now() > 5000) {
          if (error instanceof ModelError) messages = [...messages, { role: 'user', content: `上次输出未通过服务端校验：${error.message} 请重新生成完整JSON，遵守原定问题范围，不补造事实。` }];
          continue;
        }
        throw new ModelError('模型暂未生成有效内容，原回答已保留，请重试。', 502);
      }
    }
  }
  throw new ModelError(vision ? '已配置的图片识别模型免费额度不足。请配置仍有额度的视觉模型，原图片与输入已保留。' : '已配置模型的免费额度不足，备用列表中没有可继续使用的模型。请补充仍有额度的模型，原回答已保留。', 502);
}
