const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { appSupportDir, tmpDir, settingsPath, tmpTtlMs } = require('./config');

function defaultSettings() {
  return {
    ui: {
      promptFormat: 'classic',
      selectedPromptProvider: 'openai'
    },
    promptProviders: {
      openai: {
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        apiKey: '',
        endpointPath: '/chat/completions'
      },
      xai: {
        baseUrl: 'https://api.x.ai/v1',
        model: 'grok-2-latest',
        apiKey: '',
        endpointPath: '/chat/completions'
      }
    },
    nanoBanana: {
      baseUrl: 'https://api.nanobanana.example',
      apiKey: '',
      model: 'pro',
      scenePath: '/scene',
      faceSwapPath: '/faceswap',
      carouselPath: '/carousel'
    }
  };
}

async function ensureDirs() {
  await fsp.mkdir(appSupportDir, { recursive: true });
  await fsp.mkdir(tmpDir, { recursive: true });

  if (!fs.existsSync(settingsPath)) {
    await fsp.writeFile(settingsPath, JSON.stringify(defaultSettings(), null, 2), 'utf-8');
  }
}

async function loadSettings() {
  await ensureDirs();
  const raw = await fsp.readFile(settingsPath, 'utf-8');
  const parsed = JSON.parse(raw);
  return {
    ...defaultSettings(),
    ...parsed,
    promptProviders: {
      ...defaultSettings().promptProviders,
      ...(parsed.promptProviders || {})
    },
    nanoBanana: {
      ...defaultSettings().nanoBanana,
      ...(parsed.nanoBanana || {})
    },
    ui: {
      ...defaultSettings().ui,
      ...(parsed.ui || {})
    }
  };
}

async function saveSettings(settings) {
  await ensureDirs();
  await fsp.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

function resolveImageRuntime(settings) {
  return {
    mode: settings.nanoBanana.apiKey ? 'nanobanana' : 'demo'
  };
}

function publicSettings(settings) {
  return {
    ui: settings.ui,
    promptProviders: {
      openai: {
        baseUrl: settings.promptProviders.openai.baseUrl,
        model: settings.promptProviders.openai.model,
        endpointPath: settings.promptProviders.openai.endpointPath,
        hasKey: Boolean(settings.promptProviders.openai.apiKey)
      },
      xai: {
        baseUrl: settings.promptProviders.xai.baseUrl,
        model: settings.promptProviders.xai.model,
        endpointPath: settings.promptProviders.xai.endpointPath,
        hasKey: Boolean(settings.promptProviders.xai.apiKey)
      }
    },
    nanoBanana: {
      baseUrl: settings.nanoBanana.baseUrl,
      model: settings.nanoBanana.model,
      scenePath: settings.nanoBanana.scenePath,
      faceSwapPath: settings.nanoBanana.faceSwapPath,
      carouselPath: settings.nanoBanana.carouselPath,
      hasKey: Boolean(settings.nanoBanana.apiKey)
    },
    imageRuntime: resolveImageRuntime(settings)
  };
}

async function cleanupTmp() {
  await ensureDirs();
  const now = Date.now();
  const names = await fsp.readdir(tmpDir);
  await Promise.all(names.map(async (name) => {
    const fullPath = path.join(tmpDir, name);
    try {
      const stat = await fsp.stat(fullPath);
      if (now - stat.mtimeMs > tmpTtlMs) {
        await fsp.rm(fullPath, { force: true, recursive: true });
      }
    } catch {
      // игнорируем ошибки очистки
    }
  }));
}

module.exports = {
  defaultSettings,
  ensureDirs,
  loadSettings,
  saveSettings,
  publicSettings,
  cleanupTmp,
  resolveImageRuntime
};
