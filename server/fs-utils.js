const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { appSupportDir, tmpDir, settingsPath, tmpTtlMs } = require('./config');

async function ensureDirs() {
  await fsp.mkdir(appSupportDir, { recursive: true });
  await fsp.mkdir(tmpDir, { recursive: true });
  if (!fs.existsSync(settingsPath)) {
    await fsp.writeFile(settingsPath, JSON.stringify(defaultSettings(), null, 2), 'utf-8');
  }
}

function defaultSettings() {
  return {
    ui: {
      promptFormat: 'classic',
      selectedPromptProvider: 'openai',
      selectedImageModel: 'pro'
    },
    promptProviders: {
      openai: { enabled: true, baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '' },
      xai: { enabled: true, baseUrl: 'https://api.x.ai/v1', model: 'grok-2-latest', apiKey: '' },
      anthropic: { enabled: true, baseUrl: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-latest', apiKey: '' },
      google: { enabled: true, baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-1.5-pro', apiKey: '' }
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

async function loadSettings() {
  await ensureDirs();
  const raw = await fsp.readFile(settingsPath, 'utf-8');
  return JSON.parse(raw);
}

async function saveSettings(nextSettings) {
  await ensureDirs();
  await fsp.writeFile(settingsPath, JSON.stringify(nextSettings, null, 2), 'utf-8');
}

function publicSettings(settings) {
  return {
    ui: settings.ui,
    promptProviders: Object.fromEntries(
      Object.entries(settings.promptProviders).map(([k, cfg]) => [k, {
        enabled: cfg.enabled,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        hasKey: Boolean(cfg.apiKey)
      }])
    ),
    nanoBanana: {
      baseUrl: settings.nanoBanana.baseUrl,
      model: settings.nanoBanana.model,
      scenePath: settings.nanoBanana.scenePath,
      faceSwapPath: settings.nanoBanana.faceSwapPath,
      carouselPath: settings.nanoBanana.carouselPath,
      hasKey: Boolean(settings.nanoBanana.apiKey)
    }
  };
}

async function cleanupTmp() {
  await ensureDirs();
  const now = Date.now();
  const items = await fsp.readdir(tmpDir);
  await Promise.all(items.map(async (name) => {
    const target = path.join(tmpDir, name);
    try {
      const stat = await fsp.stat(target);
      if (now - stat.mtimeMs > tmpTtlMs) {
        await fsp.rm(target, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors
    }
  }));
}

module.exports = {
  ensureDirs,
  defaultSettings,
  loadSettings,
  saveSettings,
  publicSettings,
  cleanupTmp
};
