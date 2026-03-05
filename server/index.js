const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const multer = require('multer');
const cors = require('cors');
const { ensureDirs, loadSettings, saveSettings, publicSettings, cleanupTmp } = require('./fs-utils');
const { tmpDir, uploadLimitBytes, cleanupIntervalMs } = require('./config');
const { generatePrompt, testPromptProvider, testImageProvider } = require('./providers');
const {
  getJob,
  cancelJob,
  startSceneJob,
  startFaceSwapJob,
  startCarouselJob,
  createZipForJob
} = require('./jobs');

const app = express();
const PORT = process.env.PORT || 4177;

const upload = multer({
  dest: tmpDir,
  limits: { fileSize: uploadLimitBytes },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg'].includes(file.mimetype);
    cb(allowed ? null : new Error('Разрешены только PNG и JPEG.'), allowed);
  }
});

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..')));

function fail(res, error, status = 400) {
  res.status(status).json({ error: error?.message || 'Произошла ошибка.' });
}

async function toBase64(filePath) {
  const data = await fs.readFile(filePath);
  return data.toString('base64');
}

app.get('/api/settings', async (req, res) => {
  try {
    const settings = await loadSettings();
    res.json(publicSettings(settings));
  } catch (error) {
    fail(res, error, 500);
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const current = await loadSettings();
    const body = req.body || {};

    const next = {
      ...current,
      ui: { ...current.ui, ...(body.ui || {}) },
      nanoBanana: {
        ...current.nanoBanana,
        ...(body.nanoBanana || {}),
        apiKey: typeof body.nanoBanana?.apiKey === 'string' ? body.nanoBanana.apiKey : current.nanoBanana.apiKey
      },
      promptProviders: {
        ...current.promptProviders
      }
    };

    Object.keys(next.promptProviders).forEach((provider) => {
      const incoming = body.promptProviders?.[provider] || {};
      next.promptProviders[provider] = {
        ...next.promptProviders[provider],
        ...incoming,
        apiKey: typeof incoming.apiKey === 'string' ? incoming.apiKey : next.promptProviders[provider].apiKey
      };
    });

    await saveSettings(next);
    res.json({ ok: true, settings: publicSettings(next) });
  } catch (error) {
    fail(res, error);
  }
});

app.post('/api/providers/test', async (req, res) => {
  try {
    const settings = await loadSettings();
    const body = req.body || {};
    const result = {};

    if (body.testPrompt) {
      const provider = body.provider || settings.ui.selectedPromptProvider;
      result.prompt = await testPromptProvider(settings, provider);
    }

    if (body.testImage) {
      result.image = await testImageProvider(settings);
    }

    res.json({ ok: true, result });
  } catch (error) {
    fail(res, error);
  }
});

app.post('/api/prompts/generate', async (req, res) => {
  try {
    const settings = await loadSettings();
    const body = req.body || {};
    const generated = await generatePrompt(settings, {
      provider: body.provider || settings.ui.selectedPromptProvider,
      mode: body.mode === 'json' ? 'json' : 'classic',
      userInstruction: body.userInstruction || '',
      context: body.context || {}
    });
    res.json({ ok: true, ...generated });
  } catch (error) {
    fail(res, error);
  }
});

app.post('/api/jobs/scene', upload.fields([{ name: 'face', maxCount: 1 }, { name: 'room', maxCount: 1 }, { name: 'outfit', maxCount: 1 }]), async (req, res) => {
  try {
    if (!req.files?.face?.[0]) return fail(res, new Error('Для редактора сцены файл лица обязателен.'));
    const settings = await loadSettings();

    const payload = {
      faceImage: await toBase64(req.files.face[0].path),
      roomImage: req.files.room?.[0] ? await toBase64(req.files.room[0].path) : null,
      outfitImage: req.files.outfit?.[0] ? await toBase64(req.files.outfit[0].path) : null,
      prompt: req.body.prompt || ''
    };

    const job = startSceneJob(settings, payload);
    res.json({ ok: true, jobId: job.id });
  } catch (error) {
    fail(res, error);
  }
});

app.post('/api/jobs/faceswap', upload.fields([{ name: 'faceRef', maxCount: 1 }, { name: 'figure', maxCount: 1 }, { name: 'styleRef', maxCount: 1 }]), async (req, res) => {
  try {
    if (!req.files?.faceRef?.[0]) return fail(res, new Error('Референс лица обязателен.'));
    if (req.body.confirm !== 'true') return fail(res, new Error('Нужно подтвердить право использования изображений.'));

    const settings = await loadSettings();
    const payload = {
      faceRefImage: await toBase64(req.files.faceRef[0].path),
      figureImage: req.files.figure?.[0] ? await toBase64(req.files.figure[0].path) : null,
      styleRefImage: req.files.styleRef?.[0] ? await toBase64(req.files.styleRef[0].path) : null,
      prompt: req.body.prompt || ''
    };

    const job = startFaceSwapJob(settings, payload);
    res.json({ ok: true, jobId: job.id });
  } catch (error) {
    fail(res, error);
  }
});

app.post('/api/jobs/carousel', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return fail(res, new Error('Референс фото обязателен.'));
    const variations = Number(req.body.variations || 4);
    if (![2, 3, 4, 6, 8].includes(variations)) {
      return fail(res, new Error('Количество вариаций должно быть: 2, 3, 4, 6 или 8.'));
    }

    const settings = await loadSettings();
    const payload = {
      photo: await toBase64(req.file.path),
      prompt: req.body.prompt || '',
      smartVariation: !req.body.prompt,
      variations
    };

    const job = startCarouselJob(settings, payload);
    res.json({ ok: true, jobId: job.id });
  } catch (error) {
    fail(res, error);
  }
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return fail(res, new Error('Задача не найдена.'), 404);

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

app.post('/api/jobs/:id/cancel', (req, res) => {
  const cancelled = cancelJob(req.params.id);
  if (!cancelled) return fail(res, new Error('Задачу нельзя отменить.'), 400);
  res.json({ ok: true });
});

app.get('/api/files/:fileId', async (req, res) => {
  try {
    const files = await fs.readdir(tmpDir);
    const found = files.find((name) => name.includes(req.params.fileId));
    if (!found) return fail(res, new Error('Файл не найден.'), 404);
    res.sendFile(path.join(tmpDir, found));
  } catch (error) {
    fail(res, error, 404);
  }
});

app.get('/api/jobs/:id/zip', async (req, res) => {
  try {
    const job = getJob(req.params.id);
    const zipPath = await createZipForJob(job);
    res.download(zipPath, `drill44-ai-${req.params.id}.zip`);
  } catch (error) {
    fail(res, error);
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
