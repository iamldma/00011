const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const multer = require('multer');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { ensureDirs, loadSettings, saveSettings, publicSettings, cleanupTmp } = require('./fs-utils');
const { tmpDir, uploadLimitBytes, cleanupIntervalMs } = require('./config');
const { generatePrompt, testPromptProvider, testNanoBanana } = require('./providers');
const { getJob, startSceneJob, startFaceSwapJob, startCarouselJob, createZipForJob } = require('./jobs');

const app = express();
const PORT = process.env.PORT || 4177;

const upload = multer({
  dest: tmpDir,
  limits: { fileSize: uploadLimitBytes },
  fileFilter: (req, file, cb) => {
    const ok = ['image/png', 'image/jpeg'].includes(file.mimetype);
    cb(ok ? null : new Error('Допустимы только PNG/JPEG файлы.'), ok);
  }
});

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..')));

function safeError(res, error, status = 400) {
  res.status(status).json({ error: error?.message || 'Произошла ошибка.' });
}

async function fileToBase64(filePath) {
  const buf = await fs.readFile(filePath);
  return buf.toString('base64');
}

app.get('/api/settings', async (req, res) => {
  try {
    const settings = await loadSettings();
    res.json(publicSettings(settings));
  } catch (e) {
    safeError(res, e, 500);
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const current = await loadSettings();
    const body = req.body || {};
    const next = { ...current };

    if (body.ui) next.ui = { ...next.ui, ...body.ui };

    if (body.promptProviders) {
      for (const [name, cfg] of Object.entries(body.promptProviders)) {
        if (!next.promptProviders[name]) continue;
        next.promptProviders[name] = {
          ...next.promptProviders[name],
          enabled: cfg.enabled ?? next.promptProviders[name].enabled,
          baseUrl: cfg.baseUrl ?? next.promptProviders[name].baseUrl,
          model: cfg.model ?? next.promptProviders[name].model,
          apiKey: typeof cfg.apiKey === 'string' ? cfg.apiKey : next.promptProviders[name].apiKey
        };
      }
    }

    if (body.nanoBanana) {
      next.nanoBanana = {
        ...next.nanoBanana,
        ...body.nanoBanana,
        apiKey: typeof body.nanoBanana.apiKey === 'string' ? body.nanoBanana.apiKey : next.nanoBanana.apiKey
      };
    }

    await saveSettings(next);
    res.json({ ok: true, settings: publicSettings(next) });
  } catch (e) {
    safeError(res, e);
  }
});

app.post('/api/providers/test', async (req, res) => {
  try {
    const settings = await loadSettings();
    const { testPrompt, testNano, provider } = req.body || {};
    const result = {};
    if (testPrompt) result.prompt = await testPromptProvider(settings, provider || settings.ui.selectedPromptProvider);
    if (testNano) result.nanoBanana = await testNanoBanana(settings);
    res.json({ ok: true, result });
  } catch (e) {
    safeError(res, e);
  }
});

app.post('/api/prompts/generate', async (req, res) => {
  try {
    const settings = await loadSettings();
    const { mode, userInstruction, context, provider } = req.body || {};
    const out = await generatePrompt(settings, {
      mode: mode === 'json' ? 'json' : 'classic',
      userInstruction: userInstruction || '',
      context: context || {},
      provider: provider || settings.ui.selectedPromptProvider
    });
    res.json({ ok: true, ...out });
  } catch (e) {
    safeError(res, e);
  }
});

app.post('/api/jobs/scene', upload.fields([{ name: 'face', maxCount: 1 }, { name: 'room', maxCount: 1 }, { name: 'outfit', maxCount: 1 }]), async (req, res) => {
  try {
    if (!req.files?.face?.[0]) return safeError(res, new Error('Файл лица обязателен.'));
    const settings = await loadSettings();
    const payload = {
      faceImage: await fileToBase64(req.files.face[0].path),
      roomImage: req.files.room?.[0] ? await fileToBase64(req.files.room[0].path) : null,
      outfitImage: req.files.outfit?.[0] ? await fileToBase64(req.files.outfit[0].path) : null,
      prompt: req.body.prompt || ''
    };
    const job = startSceneJob(settings, payload);
    res.json({ ok: true, jobId: job.id });
  } catch (e) {
    safeError(res, e);
  }
});

app.post('/api/jobs/faceswap', upload.fields([{ name: 'faceRef', maxCount: 1 }, { name: 'figure', maxCount: 1 }, { name: 'styleRef', maxCount: 1 }]), async (req, res) => {
  try {
    if (!req.files?.faceRef?.[0]) return safeError(res, new Error('Референс лица обязателен.'));
    if (req.body.confirm !== 'true') return safeError(res, new Error('Требуется подтверждение прав на изображения.'));
    const settings = await loadSettings();
    const payload = {
      faceRefImage: await fileToBase64(req.files.faceRef[0].path),
      figureImage: req.files.figure?.[0] ? await fileToBase64(req.files.figure[0].path) : null,
      styleRefImage: req.files.styleRef?.[0] ? await fileToBase64(req.files.styleRef[0].path) : null,
      prompt: req.body.prompt || ''
    };
    const job = startFaceSwapJob(settings, payload);
    res.json({ ok: true, jobId: job.id });
  } catch (e) {
    safeError(res, e);
  }
});

app.post('/api/jobs/carousel', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return safeError(res, new Error('Референс фото обязателен.'));
    const variations = Number(req.body.variations || 4);
    if (![2, 3, 4, 6, 8].includes(variations)) return safeError(res, new Error('Недопустимое количество вариаций.'));
    const settings = await loadSettings();
    const payload = {
      photo: await fileToBase64(req.file.path),
      prompt: req.body.prompt || '',
      smartVariation: !req.body.prompt,
      variations
    };
    const job = startCarouselJob(settings, payload);
    res.json({ ok: true, jobId: job.id });
  } catch (e) {
    safeError(res, e);
  }
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return safeError(res, new Error('Задача не найдена.'), 404);
  res.json({
    id: job.id,
    type: job.type,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    error: job.error,
    result: job.result
  });
});

app.get('/api/files/:fileId', async (req, res) => {
  try {
    const entries = await fs.readdir(tmpDir);
    const found = entries.find((f) => f.includes(req.params.fileId));
    if (!found) return safeError(res, new Error('Файл не найден.'), 404);
    res.sendFile(path.join(tmpDir, found));
  } catch (e) {
    safeError(res, e, 404);
  }
});

app.get('/api/jobs/:id/zip', async (req, res) => {
  try {
    const job = getJob(req.params.id);
    const zipPath = await createZipForJob(job);
    res.download(zipPath, `drill44-ai-${req.params.id}.zip`);
  } catch (e) {
    safeError(res, e);
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

(async () => {
  await ensureDirs();
  await cleanupTmp();
  setInterval(cleanupTmp, cleanupIntervalMs).unref();
  app.listen(PORT, () => {
    console.log(`DRILL44 AI запущен: http://localhost:${PORT}`);
  });
})();
