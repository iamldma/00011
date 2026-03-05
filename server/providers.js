const axios = require('axios');
const { createDemoImage } = require('./demo-image');
const { resolveImageRuntime } = require('./fs-utils');

function joinUrl(baseUrl, endpointPath) {
  return `${baseUrl.replace(/\/$/, '')}${endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`}`;
}

function promptMessages(mode, userInstruction, context) {
  const asJson = mode === 'json';
  const sys = asJson
    ? 'Ты создаешь JSON-промпт для генератора изображений. Ответ строго JSON: {"mainPrompt":"...","negativePrompt":"...","style":"...","constraints":["..."]}'
    : 'Ты создаешь качественный текстовый промпт для генерации изображений.';

  return [
    { role: 'system', content: sys },
    {
      role: 'user',
      content: [
        `Режим продукта: ${context.modeName || 'Не указан'}`,
        `Контекст: ${JSON.stringify(context || {})}`,
        `Инструкция: ${userInstruction || 'Сделай универсальный аккуратный промпт.'}`
      ].join('\n')
    }
  ];
}

async function generateOpenAiLike(cfg, payload) {
  const url = joinUrl(cfg.baseUrl, cfg.endpointPath || '/chat/completions');
  const response = await axios.post(url, {
    model: cfg.model,
    messages: promptMessages(payload.mode, payload.userInstruction, payload.context),
    temperature: 0.7
  }, {
    timeout: 30000,
    headers: { Authorization: `Bearer ${cfg.apiKey}` }
  });

  return response.data?.choices?.[0]?.message?.content || '';
}

async function generatePrompt(settings, input) {
  const provider = input.provider;
  const cfg = settings.promptProviders[provider];
  if (!cfg) throw new Error('Провайдер промптов не найден.');
  if (!cfg.apiKey) throw new Error(`Для ${provider} не задан API ключ.`);

  let raw;
  if (provider === 'openai' || provider === 'xai') {
    raw = await generateOpenAiLike(cfg, input);
  } else {
    throw new Error('Неподдерживаемый провайдер промптов.');
  }

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
    userInstruction: 'Проверка соединения. Ответь одной фразой.',
    context: { modeName: 'Тест провайдера' }
  });

  return { ok: true, message: `Провайдер ${provider} доступен.` };
}

async function callNanoBanana(settings, endpointPath, body) {
  const cfg = settings.nanoBanana;
  const url = joinUrl(cfg.baseUrl, endpointPath);
  const response = await axios.post(url, { ...body, model: cfg.model }, {
    timeout: 60000,
    headers: { Authorization: `Bearer ${cfg.apiKey}` }
  });
  return response.data;
}

async function generateDemoSet({ modeName, prompt, count }) {
  const list = [];
  for (let i = 0; i < count; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const image = await createDemoImage({
      modeName,
      prompt,
      variantIndex: i + 1,
      totalVariants: count
    });
    list.push(image);
  }
  return {
    images: list,
    meta: {
      provider: 'demo',
      model: 'demo-local-v1',
      createdAt: new Date().toLocaleString('ru-RU')
    }
  };
}

async function generateImages(settings, modeName, endpointPath, body, count = 1) {
  const runtime = resolveImageRuntime(settings);
  if (runtime.mode === 'demo') {
    return generateDemoSet({ modeName, prompt: body.prompt, count });
  }

  const response = await callNanoBanana(settings, endpointPath, body);
  return {
    ...response,
    meta: {
      provider: 'nanobanana',
      model: settings.nanoBanana.model,
      createdAt: new Date().toLocaleString('ru-RU')
    }
  };
}

async function testImageProvider(settings) {
  const runtime = resolveImageRuntime(settings);
  if (runtime.mode === 'demo') {
    return { ok: true, message: 'Работает DEMO image provider (без ключа NanoBanana).' };
  }
  if (!settings.nanoBanana.apiKey) throw new Error('Ключ NanoBanana не задан.');
  return { ok: true, message: 'NanoBanana включен и готов к запросам.' };
}

module.exports = {
  generatePrompt,
  testPromptProvider,
  generateImages,
  testImageProvider
};
