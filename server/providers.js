const axios = require('axios');

function safeJoin(baseUrl, endpoint) {
  const trimmed = baseUrl.replace(/\/$/, '');
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${trimmed}${path}`;
}

function buildPromptMessages(mode, userInstruction, context = {}) {
  const sys = mode === 'json'
    ? 'Ты создаешь структурированный JSON-промпт для генератора изображений. Отвечай только валидным JSON с полями mainPrompt, negatives, styleNotes, constraints.'
    : 'Ты создаешь качественный текстовый промпт для генератора изображений. Отвечай кратко и предметно.';
  const ctx = `Режим: ${context.modeName || 'не указан'}\nКонтекст: ${JSON.stringify(context)}`;
  return [
    { role: 'system', content: sys },
    { role: 'user', content: `${ctx}\n\nИнструкция пользователя: ${userInstruction || 'Сформируй базовый промпт без дополнительных требований.'}` }
  ];
}

async function generateWithOpenAI(cfg, payload) {
  const url = safeJoin(cfg.baseUrl, '/chat/completions');
  const res = await axios.post(url, {
    model: cfg.model,
    messages: buildPromptMessages(payload.mode, payload.userInstruction, payload.context),
    temperature: 0.7
  }, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    timeout: 30000
  });
  return res.data?.choices?.[0]?.message?.content || '';
}

async function generateWithXAI(cfg, payload) {
  const url = safeJoin(cfg.baseUrl, '/chat/completions');
  const res = await axios.post(url, {
    model: cfg.model,
    messages: buildPromptMessages(payload.mode, payload.userInstruction, payload.context),
    temperature: 0.7
  }, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    timeout: 30000
  });
  return res.data?.choices?.[0]?.message?.content || '';
}

async function generateWithAnthropic(cfg, payload) {
  const url = safeJoin(cfg.baseUrl, '/messages');
  const user = buildPromptMessages(payload.mode, payload.userInstruction, payload.context)[1].content;
  const res = await axios.post(url, {
    model: cfg.model,
    max_tokens: 1024,
    messages: [{ role: 'user', content: user }]
  }, {
    headers: {
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01'
    },
    timeout: 30000
  });
  return res.data?.content?.[0]?.text || '';
}

async function generateWithGoogle(cfg, payload) {
  const url = safeJoin(cfg.baseUrl, `/models/${cfg.model}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`);
  const user = buildPromptMessages(payload.mode, payload.userInstruction, payload.context)[1].content;
  const res = await axios.post(url, {
    contents: [{ parts: [{ text: user }] }]
  }, { timeout: 30000 });
  return res.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function generatePrompt(settings, input) {
  const provider = input.provider;
  const cfg = settings.promptProviders[provider];
  if (!cfg || !cfg.apiKey) {
    throw new Error('Ключ провайдера промптов не задан.');
  }

  let raw = '';
  if (provider === 'openai') raw = await generateWithOpenAI(cfg, input);
  else if (provider === 'xai') raw = await generateWithXAI(cfg, input);
  else if (provider === 'anthropic') raw = await generateWithAnthropic(cfg, input);
  else if (provider === 'google') raw = await generateWithGoogle(cfg, input);
  else throw new Error('Неизвестный провайдер промптов.');

  const result = { promptText: raw, raw };
  if (input.mode === 'json') {
    try {
      result.promptJson = JSON.parse(raw);
    } catch {
      result.promptJson = null;
    }
  }
  return result;
}

async function testPromptProvider(settings, provider) {
  await generatePrompt(settings, {
    provider,
    mode: 'classic',
    userInstruction: 'Тестовое подключение. Ответь одной короткой фразой.',
    context: { modeName: 'Тест' }
  });
  return { ok: true, message: `Провайдер ${provider} доступен.` };
}

async function callNanoBanana(settings, endpointPath, body) {
  const cfg = settings.nanoBanana;
  if (!cfg.apiKey) {
    throw new Error('Ключ NanoBanana не задан.');
  }
  const url = safeJoin(cfg.baseUrl, endpointPath);
  const res = await axios.post(url, { ...body, model: cfg.model }, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    timeout: 60000
  });
  return res.data;
}

async function testNanoBanana(settings) {
  const cfg = settings.nanoBanana;
  if (!cfg.apiKey) throw new Error('Ключ NanoBanana не задан.');
  return { ok: true, message: 'Параметры NanoBanana сохранены.' };
}

module.exports = {
  generatePrompt,
  testPromptProvider,
  callNanoBanana,
  testNanoBanana
};
