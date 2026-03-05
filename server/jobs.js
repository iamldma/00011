const path = require('path');
const fs = require('fs/promises');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const { tmpDir } = require('./config');
const { generateImages } = require('./providers');

const jobs = new Map();

function createJob(type) {
  const id = uuidv4();
  const job = {
    id,
    type,
    status: 'queued',
    stage: 'Отправка',
    progress: 5,
    error: null,
    result: null,
    createdAt: Date.now(),
    cancelled: false
  };
  jobs.set(id, job);
  return job;
}

function getJob(id) {
  return jobs.get(id);
}

function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return false;
  if (job.status === 'done' || job.status === 'error') return false;
  job.cancelled = true;
  job.status = 'error';
  job.error = 'Задача отменена пользователем.';
  return true;
}

function stripBase64Prefix(base64) {
  return base64.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
}

async function saveImageItem(item, prefix) {
  if (item.source === 'file' && item.fileId) return item;
  const fileId = uuidv4();
  const ext = item.mimeType ? (mime.extension(item.mimeType) || 'png') : 'png';
  const fileName = `${prefix}-${fileId}.${ext}`;
  const fullPath = path.join(tmpDir, fileName);

  if (item.url) {
    return { fileId, fileName, url: item.url, source: 'url', mimeType: item.mimeType || 'image/png' };
  }
  if (!item.base64) throw new Error('Провайдер вернул пустое изображение.');

  await fs.writeFile(fullPath, Buffer.from(stripBase64Prefix(item.base64), 'base64'));
  return { fileId, fileName, source: 'file', mimeType: item.mimeType || 'image/png' };
}

async function normalizeImageResponse(response, prefix) {
  const sourceImages = Array.isArray(response.images)
    ? response.images
    : (response.image ? [response.image] : []);

  if (!sourceImages.length) throw new Error('Провайдер не вернул изображений.');

  const normalized = [];
  for (const image of sourceImages) {
    // eslint-disable-next-line no-await-in-loop
    const saved = await saveImageItem(typeof image === 'string' ? { base64: image } : image, prefix);
    normalized.push(saved);
  }

  return normalized;
}

function runJob(job, handler) {
  (async () => {
    try {
      job.status = 'running';
      job.stage = 'Генерация';
      job.progress = 45;

      const result = await handler();
      if (job.cancelled) return;

      job.stage = 'Сохранение';
      job.progress = 88;
      job.result = result;
      job.status = 'done';
      job.progress = 100;
    } catch (error) {
      job.status = 'error';
      job.error = error?.message || 'Неизвестная ошибка.';
    }
  })();
}

function startSceneJob(settings, payload) {
  const job = createJob('scene');
  runJob(job, async () => {
    const response = await generateImages(settings, 'SCENE', settings.nanoBanana.scenePath, payload, 1);
    const images = await normalizeImageResponse(response, 'scene');
    return { images, promptUsed: payload.prompt || '', meta: response.meta };
  });
  return job;
}

function startFaceSwapJob(settings, payload) {
  const job = createJob('faceswap');
  runJob(job, async () => {
    const response = await generateImages(settings, 'FACE SWAP', settings.nanoBanana.faceSwapPath, payload, 1);
    const images = await normalizeImageResponse(response, 'faceswap');
    return { images, promptUsed: payload.prompt || '', meta: response.meta };
  });
  return job;
}

function startCarouselJob(settings, payload) {
  const job = createJob('carousel');
  runJob(job, async () => {
    const count = Number(payload.variations || 4);
    const response = await generateImages(settings, 'CAROUSEL', settings.nanoBanana.carouselPath, payload, count);
    const images = await normalizeImageResponse(response, 'carousel');
    return { images, promptUsed: payload.prompt || '', meta: response.meta };
  });
  return job;
}

async function createZipForJob(job) {
  if (!job || job.status !== 'done' || !job.result?.images?.length) {
    throw new Error('ZIP недоступен для этой задачи.');
  }

  const zipPath = path.join(tmpDir, `${job.id}.zip`);
  await fs.writeFile(zipPath, '');

  await new Promise((resolve, reject) => {
    const output = require('fs').createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);

    archive.pipe(output);
    job.result.images.forEach((image) => {
      if (image.source === 'file') {
        archive.file(path.join(tmpDir, image.fileName), { name: image.fileName });
      }
    });
    archive.finalize();
  });

  return zipPath;
}

module.exports = {
  createJob,
  getJob,
  cancelJob,
  startSceneJob,
  startFaceSwapJob,
  startCarouselJob,
  createZipForJob
};
