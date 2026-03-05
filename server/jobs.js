const path = require('path');
const fs = require('fs/promises');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const archiver = require('archiver');
const { tmpDir } = require('./config');
const { callNanoBanana } = require('./providers');

const jobs = new Map();

function createJob(type) {
  const id = uuidv4();
  const job = {
    id,
    type,
    status: 'queued',
    stage: 'Отправка',
    progress: 5,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    error: null,
    result: null
  };
  jobs.set(id, job);
  return job;
}

function getJob(id) {
  return jobs.get(id);
}

function sanitizeBase64Image(base64) {
  return base64.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
}

async function saveResponseImage(item, prefix) {
  const fileId = uuidv4();
  const ext = item.mimeType ? (mime.extension(item.mimeType) || 'png') : 'png';
  const fileName = `${prefix}-${fileId}.${ext}`;
  const fullPath = path.join(tmpDir, fileName);
  if (item.url) {
    return { fileId, fileName, mimeType: item.mimeType || 'image/png', url: item.url, source: 'url' };
  }
  if (!item.base64) {
    throw new Error('Пустой ответ изображения.');
  }
  const buffer = Buffer.from(sanitizeBase64Image(item.base64), 'base64');
  await fs.writeFile(fullPath, buffer);
  return { fileId, fileName, mimeType: item.mimeType || 'image/png', source: 'file' };
}

async function normalizeImages(response, prefix) {
  const arr = Array.isArray(response?.images) ? response.images : (response?.image ? [response.image] : []);
  if (!arr.length) throw new Error('Провайдер не вернул изображения.');
  const normalized = [];
  for (const item of arr) {
    if (typeof item === 'string') {
      if (item.startsWith('http')) normalized.push(await saveResponseImage({ url: item }, prefix));
      else normalized.push(await saveResponseImage({ base64: item }, prefix));
    } else {
      normalized.push(await saveResponseImage(item, prefix));
    }
  }
  return normalized;
}

function runJob(job, handler) {
  (async () => {
    try {
      job.status = 'running';
      job.stage = 'Генерация';
      job.progress = 45;
      job.updatedAt = Date.now();
      const result = await handler(job);
      job.stage = 'Сохранение';
      job.progress = 90;
      job.result = result;
      job.status = 'done';
      job.progress = 100;
      job.updatedAt = Date.now();
    } catch (err) {
      job.status = 'error';
      job.error = err?.message || 'Неизвестная ошибка.';
      job.updatedAt = Date.now();
    }
  })();
}

function startSceneJob(settings, payload) {
  const job = createJob('scene');
  runJob(job, async () => {
    const providerResponse = await callNanoBanana(settings, settings.nanoBanana.scenePath, payload);
    const images = await normalizeImages(providerResponse, 'scene');
    return { images, promptUsed: payload.prompt || '' };
  });
  return job;
}

function startFaceSwapJob(settings, payload) {
  const job = createJob('faceswap');
  runJob(job, async () => {
    const providerResponse = await callNanoBanana(settings, settings.nanoBanana.faceSwapPath, payload);
    const images = await normalizeImages(providerResponse, 'faceswap');
    return { images, promptUsed: payload.prompt || '' };
  });
  return job;
}

function startCarouselJob(settings, payload) {
  const job = createJob('carousel');
  runJob(job, async () => {
    const providerResponse = await callNanoBanana(settings, settings.nanoBanana.carouselPath, payload);
    const images = await normalizeImages(providerResponse, 'carousel');
    return { images, promptUsed: payload.prompt || '' };
  });
  return job;
}

async function createZipForJob(job) {
  if (!job || job.status !== 'done' || !job.result?.images?.length) {
    throw new Error('ZIP недоступен для этой задачи.');
  }
  const zipName = `${job.id}.zip`;
  const zipPath = path.join(tmpDir, zipName);
  const output = await fs.open(zipPath, 'w');
  await output.close();

  await new Promise((resolve, reject) => {
    const stream = require('fs').createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    stream.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(stream);

    for (const img of job.result.images) {
      if (img.source === 'file') {
        archive.file(path.join(tmpDir, img.fileName), { name: img.fileName });
      }
    }
    archive.finalize();
  });

  return zipPath;
}

module.exports = {
  createJob,
  getJob,
  startSceneJob,
  startFaceSwapJob,
  startCarouselJob,
  createZipForJob
};
