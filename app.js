const state = {
  settings: null,
  activeView: 'scene',
  pollTimer: null,
  latestJob: null,
  carousel: { items: [], index: 0, viewMode: 'carousel' }
};

const viewConfig = {
  scene: { title: 'Редактор сцены', hint: 'Лицо обязательно, остальные референсы опциональны.' },
  faceswap: { title: 'Face Swap (NanoBanana)', hint: 'Подтверждение прав на изображения обязательно.' },
  carousel: { title: 'Карусель вариаций', hint: 'Поддерживает режимы карусели и сетки + горячие клавиши стрелок.' }
};

const promptProviders = [
  { id: 'openai', label: 'OpenAI (ChatGPT)' },
  { id: 'xai', label: 'xAI (Grok)' }
];

const $ = (selector) => document.querySelector(selector);
const fileStore = new Map();

function showToast(text) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = text;
  $('#toastRoot').appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Ошибка запроса.');
  return data;
}

function createDropzone({ id, label, required = false, hint = '' }) {
  return `
    <div class="dropzone" data-dropzone="${id}">
      <div class="drop-top">
        <strong>${label}${required ? ' *' : ''}</strong>
        <button type="button" data-pick="${id}">Загрузить</button>
      </div>
      <div class="drop-name">${hint || 'PNG/JPG до 15 МБ. Можно перетащить файл.'}</div>
      <img class="drop-preview" data-preview="${id}" alt="Превью ${label}" hidden />
      <input class="hidden-file" type="file" data-file="${id}" accept="image/png,image/jpeg" ${required ? 'required' : ''} />
      <div class="drop-actions">
        <button type="button" data-clear="${id}" class="danger">Очистить</button>
      </div>
    </div>
  `;
}

function buildViews() {
  $('#sceneView').innerHTML = `
    <div class="two-col">
      <section class="card">
        <h3>Исходные референсы</h3>
        ${createDropzone({ id: 'sceneFace', label: 'Лицо', required: true })}
        ${createDropzone({ id: 'sceneRoom', label: 'Комната' })}
        ${createDropzone({ id: 'sceneOutfit', label: 'Одежда / аксессуар' })}
        <label>Промпт (опционально)
          <textarea id="scenePrompt" placeholder="Опишите желаемую сцену..."></textarea>
        </label>
        <div class="btn-grid">
          <button id="scenePromptBtn">Сгенерировать промпт</button>
          <button id="sceneRunBtn">Сгенерировать сцену</button>
        </div>
      </section>
      <section class="card" id="sceneResult"><div class="skeleton"></div></section>
    </div>
  `;

  $('#faceswapView').innerHTML = `
    <div class="two-col">
      <section class="card">
        <h3>Референсы Face Swap</h3>
        ${createDropzone({ id: 'faceRef', label: 'Референс лица', required: true })}
        ${createDropzone({ id: 'faceFigure', label: 'Фигура / поза / одежда' })}
        ${createDropzone({ id: 'faceStyle', label: 'Пример сцены / стиля' })}
        <label>Доп. промпт (опционально)
          <textarea id="facePrompt"></textarea>
        </label>
        <label class="inline-check">
          <input id="faceConfirm" type="checkbox" />
          Я имею право использовать эти изображения и не создаю вводящие в заблуждение материалы.
        </label>
        <div class="btn-grid">
          <button id="facePromptBtn">Сгенерировать промпт</button>
          <button id="faceRunBtn" disabled>Запустить Face Swap</button>
        </div>
      </section>
      <section class="card" id="faceResult"><div class="skeleton"></div></section>
    </div>
  `;

  $('#carouselView').innerHTML = `
    <div class="two-col">
      <section class="card">
        <h3>Параметры вариаций</h3>
        ${createDropzone({ id: 'carouselPhoto', label: 'Референс фото', required: true })}
        <label>Промпт (опционально)
          <textarea id="carouselPrompt" placeholder="Если оставить пустым, включится умная вариация."></textarea>
        </label>
        <label>Количество вариаций
          <select id="carouselCount">
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4" selected>4</option>
            <option value="6">6</option>
            <option value="8">8</option>
          </select>
        </label>
        <div class="meta">Горячие клавиши просмотра: <kbd>←</kbd> и <kbd>→</kbd>.</div>
        <div class="btn-grid">
          <button id="carouselPromptBtn">Сгенерировать промпт</button>
          <button id="carouselRunBtn">Сгенерировать карусель</button>
        </div>
      </section>
      <section class="card" id="carouselResult"><div class="skeleton"></div></section>
    </div>
  `;
}

function setupDropzones() {
  document.querySelectorAll('[data-dropzone]').forEach((zone) => {
    const id = zone.dataset.dropzone;
    const fileInput = zone.querySelector(`[data-file="${id}"]`);
    const preview = zone.querySelector(`[data-preview="${id}"]`);

    zone.querySelector(`[data-pick="${id}"]`).onclick = () => fileInput.click();
    zone.querySelector(`[data-clear="${id}"]`).onclick = () => {
      fileInput.value = '';
      fileStore.delete(id);
      preview.hidden = true;
      preview.src = '';
    };

    const consume = (file) => {
      if (!file) return;
      if (!['image/png', 'image/jpeg'].includes(file.type)) {
        showToast('Разрешены только PNG/JPEG.');
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        showToast('Файл больше 15 МБ.');
        return;
      }
      fileStore.set(id, file);
      const url = URL.createObjectURL(file);
      preview.src = url;
      preview.hidden = false;
    };

    fileInput.addEventListener('change', () => consume(fileInput.files[0]));

    zone.addEventListener('dragover', (event) => {
      event.preventDefault();
      zone.classList.add('drag');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      zone.classList.remove('drag');
      consume(event.dataTransfer.files?.[0]);
    });
  });
}

function renderPromptProviders() {
  const html = promptProviders.map((provider) => {
    const cfg = state.settings.promptProviders[provider.id];
    return `
      <section class="card provider-card">
        <div class="provider-head">
          <strong>${provider.label}</strong>
          <span>${cfg.hasKey ? 'ключ задан' : 'ключ не задан'}</span>
        </div>
        <label>Base URL <input data-provider="${provider.id}" data-key="baseUrl" value="${cfg.baseUrl}" /></label>
        <label>Модель <input data-provider="${provider.id}" data-key="model" value="${cfg.model}" /></label>
        <label>API ключ <input data-provider="${provider.id}" data-key="apiKey" type="password" placeholder="${cfg.hasKey ? 'Ключ сохранен' : 'Введите ключ'}" autocomplete="off" /></label>
      </section>
    `;
  }).join('');
  $('#promptProviderCards').innerHTML = html;
}

function applySettingsToUI() {
  $('#promptFormat').value = state.settings.ui.promptFormat;
  $('#selectedPromptProvider').value = state.settings.ui.selectedPromptProvider;

  $('#nanoBaseUrl').value = state.settings.nanoBanana.baseUrl;
  $('#nanoModel').value = state.settings.nanoBanana.model;
  $('#nanoScenePath').value = state.settings.nanoBanana.scenePath;
  $('#nanoFaceSwapPath').value = state.settings.nanoBanana.faceSwapPath;
  $('#nanoCarouselPath').value = state.settings.nanoBanana.carouselPath;
  $('#nanoApiKey').placeholder = state.settings.nanoBanana.hasKey ? 'Ключ сохранен' : 'Введите ключ';

  $('#providerBadge').textContent = state.settings.imageRuntime.mode === 'demo' ? 'Image: DEMO' : 'Image: NanoBanana';

  renderPromptProviders();
}

function collectSettingsPayload(resetKeys = false) {
  const payload = {
    ui: {
      promptFormat: $('#promptFormat').value,
      selectedPromptProvider: $('#selectedPromptProvider').value
    },
    promptProviders: {},
    nanoBanana: {
      baseUrl: $('#nanoBaseUrl').value.trim(),
      model: $('#nanoModel').value,
      scenePath: $('#nanoScenePath').value.trim(),
      faceSwapPath: $('#nanoFaceSwapPath').value.trim(),
      carouselPath: $('#nanoCarouselPath').value.trim()
    }
  };

  document.querySelectorAll('[data-provider]').forEach((node) => {
    const provider = node.dataset.provider;
    payload.promptProviders[provider] ||= {};
    payload.promptProviders[provider][node.dataset.key] = node.value.trim();
  });

  if (resetKeys) {
    payload.nanoBanana.apiKey = '';
    Object.keys(payload.promptProviders).forEach((key) => { payload.promptProviders[key].apiKey = ''; });
  } else {
    const nanoKey = $('#nanoApiKey').value.trim();
    if (nanoKey) payload.nanoBanana.apiKey = nanoKey;
  }

  return payload;
}

function setView(viewId) {
  state.activeView = viewId;
  document.querySelectorAll('.mode-btn').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === viewId);
  });
  document.querySelectorAll('.view').forEach((view) => {
    view.classList.toggle('active', view.id === `${viewId}View`);
  });
  $('#viewTitle').textContent = viewConfig[viewId].title;
  $('#viewHint').textContent = viewConfig[viewId].hint;
}

async function requestPrompt(modeName, targetTextarea) {
  const result = await api('/api/prompts/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: $('#promptFormat').value,
      userInstruction: targetTextarea.value,
      context: { modeName },
      provider: $('#selectedPromptProvider').value
    })
  });
  targetTextarea.value = result.promptText || JSON.stringify(result.promptJson, null, 2);
  showToast('Промпт готов.');
}

function resultCard(imageUrl, meta) {
  return `
    <img class="result-media" src="${imageUrl}" alt="Результат DRILL44 AI" />
    <div class="result-meta">
      <span>Провайдер: ${meta.provider}</span>
      <span>Модель: ${meta.model}</span>
      <span>Время: ${meta.createdAt}</span>
    </div>
  `;
}

function renderSceneFaceResult(rootSelector, job, promptText) {
  const img = job.result.images[0];
  const src = img.url || `/api/files/${img.fileId}`;
  const node = $(rootSelector);
  node.innerHTML = `
    ${resultCard(src, job.result.meta)}
    <div class="result-actions">
      <a href="${src}" download><button>Скачать</button></a>
      <button class="copy-prompt">Копировать промпт</button>
      <button class="repeat-job">Повторить</button>
    </div>
  `;
  node.querySelector('.copy-prompt').onclick = () => navigator.clipboard.writeText(promptText || '');
  node.querySelector('.repeat-job').onclick = () => {
    if (state.activeView === 'scene') $('#sceneRunBtn').click();
    if (state.activeView === 'faceswap') $('#faceRunBtn').click();
  };
}

function renderCarousel(job) {
  const root = $('#carouselResult');
  state.carousel.items = job.result.images.map((item) => item.url || `/api/files/${item.fileId}`);
  state.carousel.index = 0;
  state.carousel.viewMode = 'carousel';

  const thumbs = state.carousel.items.map((src, index) => `<img src="${src}" data-thumb-index="${index}" class="${index === 0 ? 'active' : ''}" alt="Миниатюра ${index + 1}" />`).join('');

  root.innerHTML = `
    <div class="carousel-main-wrap">
      <img class="carousel-main" src="${state.carousel.items[0]}" alt="Вариация 1" />
    </div>
    <div class="carousel-nav">
      <button id="carouselPrev">←</button>
      <button id="carouselNext">→</button>
      <span id="carouselCounter">1 / ${state.carousel.items.length}</span>
      <a href="/api/jobs/${job.id}/zip"><button>Скачать всё ZIP</button></a>
    </div>
    <div class="btn-grid">
      <button id="switchCarouselView">Режим: Карусель</button>
      <button id="switchGridView">Режим: Сетка</button>
    </div>
    <div class="thumb-strip">${thumbs}</div>
  `;

  const render = () => {
    const main = root.querySelector('.carousel-main');
    main.src = state.carousel.items[state.carousel.index];
    $('#carouselCounter').textContent = `${state.carousel.index + 1} / ${state.carousel.items.length}`;
    root.querySelectorAll('[data-thumb-index]').forEach((thumb, index) => {
      thumb.classList.toggle('active', index === state.carousel.index);
    });

    if (state.carousel.viewMode === 'grid') {
      main.style.display = 'none';
      let grid = root.querySelector('.result-grid');
      if (!grid) {
        grid = document.createElement('div');
        grid.className = 'result-grid';
        root.appendChild(grid);
      }
      grid.innerHTML = state.carousel.items.map((src) => `<img class="result-media" src="${src}" alt="Вариант" />`).join('');
    } else {
      main.style.display = 'block';
      root.querySelector('.result-grid')?.remove();
    }
  };

  root.querySelector('#carouselPrev').onclick = () => { state.carousel.index = (state.carousel.index - 1 + state.carousel.items.length) % state.carousel.items.length; render(); };
  root.querySelector('#carouselNext').onclick = () => { state.carousel.index = (state.carousel.index + 1) % state.carousel.items.length; render(); };
  root.querySelector('#switchCarouselView').onclick = () => { state.carousel.viewMode = 'carousel'; render(); };
  root.querySelector('#switchGridView').onclick = () => { state.carousel.viewMode = 'grid'; render(); };
  root.querySelectorAll('[data-thumb-index]').forEach((thumb) => {
    thumb.onclick = () => { state.carousel.index = Number(thumb.dataset.thumbIndex); render(); };
  });

  render();
}

function startPolling(jobId, onDone) {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    try {
      const job = await api(`/api/jobs/${jobId}`);
      $('#jobStatus').textContent = `${job.status.toUpperCase()} • ${job.stage} • ${job.progress}%`;
      if (job.status === 'done') {
        clearInterval(state.pollTimer);
        state.latestJob = job;
        $('#jobStatus').textContent = 'DONE • Готово';
        onDone(job);
        showToast('Генерация завершена.');
      }
      if (job.status === 'error') {
        clearInterval(state.pollTimer);
        $('#jobStatus').textContent = 'ERROR';
        showToast(job.error || 'Ошибка выполнения задачи.');
      }
    } catch (error) {
      clearInterval(state.pollTimer);
      showToast(error.message || 'Ошибка polling.');
    }
  }, 1000);
}

function bindGlobalActions() {
  document.querySelectorAll('.mode-btn').forEach((button) => {
    button.onclick = () => setView(button.dataset.view);
  });

  $('#toggleDrawer').onclick = () => $('#settingsDrawer').classList.toggle('collapsed');
  $('#showKeys').onchange = (event) => {
    document.querySelectorAll('input[data-key="apiKey"], #nanoApiKey').forEach((input) => {
      input.type = event.target.checked ? 'text' : 'password';
    });
  };

  $('#saveSettings').onclick = async () => {
    await api('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectSettingsPayload(false))
    });
    showToast('Настройки сохранены.');
    await initSettings();
  };

  $('#resetKeys').onclick = async () => {
    await api('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectSettingsPayload(true))
    });
    showToast('Ключи сброшены.');
    await initSettings();
  };

  $('#testPrompt').onclick = async () => {
    const provider = $('#selectedPromptProvider').value;
    const response = await api('/api/providers/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testPrompt: true, provider })
    });
    showToast(response.result.prompt.message);
  };

  $('#testImage').onclick = async () => {
    const response = await api('/api/providers/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testImage: true })
    });
    showToast(response.result.image.message);
  };

  $('#faceConfirm').onchange = (event) => { $('#faceRunBtn').disabled = !event.target.checked; };

  $('#scenePromptBtn').onclick = () => requestPrompt('Редактор сцены', $('#scenePrompt'));
  $('#facePromptBtn').onclick = () => requestPrompt('Face Swap', $('#facePrompt'));
  $('#carouselPromptBtn').onclick = () => requestPrompt('Карусель вариаций', $('#carouselPrompt'));

  $('#sceneRunBtn').onclick = async () => {
    if (!fileStore.get('sceneFace')) return showToast('Загрузите лицо.');

    const form = new FormData();
    form.append('face', fileStore.get('sceneFace'));
    if (fileStore.get('sceneRoom')) form.append('room', fileStore.get('sceneRoom'));
    if (fileStore.get('sceneOutfit')) form.append('outfit', fileStore.get('sceneOutfit'));
    form.append('prompt', $('#scenePrompt').value.trim());

    $('#sceneResult').innerHTML = '<div class="skeleton"></div>';

    const response = await fetch('/api/jobs/scene', { method: 'POST', body: form }).then((r) => r.json());
    if (!response.ok) return showToast(response.error || 'Не удалось запустить задачу.');

    startPolling(response.jobId, (job) => renderSceneFaceResult('#sceneResult', job, $('#scenePrompt').value));
  };

  $('#faceRunBtn').onclick = async () => {
    if (!fileStore.get('faceRef')) return showToast('Загрузите референс лица.');
    if (!$('#faceConfirm').checked) return showToast('Подтвердите право использования изображений.');

    const form = new FormData();
    form.append('faceRef', fileStore.get('faceRef'));
    if (fileStore.get('faceFigure')) form.append('figure', fileStore.get('faceFigure'));
    if (fileStore.get('faceStyle')) form.append('styleRef', fileStore.get('faceStyle'));
    form.append('prompt', $('#facePrompt').value.trim());
    form.append('confirm', 'true');

    $('#faceResult').innerHTML = '<div class="skeleton"></div>';

    const response = await fetch('/api/jobs/faceswap', { method: 'POST', body: form }).then((r) => r.json());
    if (!response.ok) return showToast(response.error || 'Не удалось запустить Face Swap.');

    startPolling(response.jobId, (job) => renderSceneFaceResult('#faceResult', job, $('#facePrompt').value));
  };

  $('#carouselRunBtn').onclick = async () => {
    if (!fileStore.get('carouselPhoto')) return showToast('Загрузите референс фото.');

    const form = new FormData();
    form.append('photo', fileStore.get('carouselPhoto'));
    form.append('prompt', $('#carouselPrompt').value.trim());
    form.append('variations', $('#carouselCount').value);

    $('#carouselResult').innerHTML = '<div class="skeleton"></div>';

    const response = await fetch('/api/jobs/carousel', { method: 'POST', body: form }).then((r) => r.json());
    if (!response.ok) return showToast(response.error || 'Не удалось запустить карусель.');

    startPolling(response.jobId, (job) => renderCarousel(job));
  };

  document.addEventListener('keydown', (event) => {
    if (state.activeView !== 'carousel' || !state.carousel.items.length) return;
    if (event.key === 'ArrowLeft') {
      state.carousel.index = (state.carousel.index - 1 + state.carousel.items.length) % state.carousel.items.length;
      const prevButton = $('#carouselPrev');
      if (prevButton) prevButton.click();
    }
    if (event.key === 'ArrowRight') {
      state.carousel.index = (state.carousel.index + 1) % state.carousel.items.length;
      const nextButton = $('#carouselNext');
      if (nextButton) nextButton.click();
    }
  });
}

async function initSettings() {
  state.settings = await api('/api/settings');
  applySettingsToUI();
}

async function bootstrap() {
  buildViews();
  setupDropzones();
  await initSettings();
  bindGlobalActions();
}

bootstrap().catch((error) => showToast(error.message || 'Ошибка инициализации интерфейса.'));
