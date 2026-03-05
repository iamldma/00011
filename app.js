const state = {
  settings: null,
  currentView: 'scene',
  currentJobId: null,
  pollTimer: null,
  carouselImages: [],
  carouselIndex: 0
};

const providerDefs = [
  { id: 'openai', title: 'OpenAI (ChatGPT)' },
  { id: 'xai', title: 'xAI (Grok)' },
  { id: 'anthropic', title: 'Anthropic (Claude)' },
  { id: 'google', title: 'Google (Gemini)' }
];

const el = (q) => document.querySelector(q);
const toast = (text) => {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = text;
  el('#toastRoot').appendChild(node);
  setTimeout(() => node.remove(), 3800);
};

function fileInput(name, label, required = false) {
  return `<label>${label}${required ? ' *' : ''}<input data-file="${name}" type="file" accept="image/png,image/jpeg" ${required ? 'required' : ''}></label>`;
}

function buildViews() {
  el('#sceneView').innerHTML = `
    <div class="grid">
      <div class="card">${fileInput('face', 'Лицо', true)}${fileInput('room', 'Комната')} ${fileInput('outfit', 'Одежда / аксессуар')}
      <label>Промпт (опционально)<textarea id="scenePrompt"></textarea></label>
      <div class="btn-row"><button id="sceneGenPrompt">Сгенерировать промпт</button><button id="sceneRun">Сгенерировать сцену</button></div></div>
      <div class="card result" id="sceneResult"><div class="skeleton"></div></div>
    </div>`;

  el('#faceswapView').innerHTML = `
    <div class="grid">
      <div class="card">${fileInput('faceRef', 'Референс лица', true)}${fileInput('figure', 'Фигура / поза')} ${fileInput('styleRef', 'Пример сцены / стиля')}
      <label>Дополнительный промпт<textarea id="facePrompt"></textarea></label>
      <label class="check-row"><input type="checkbox" id="faceConfirm"> У меня есть право использовать эти изображения и я не создаю вводящие в заблуждение материалы.</label>
      <div class="btn-row"><button id="faceGenPrompt">Сгенерировать промпт</button><button id="faceRun" disabled>Запустить Face Swap</button></div></div>
      <div class="card result" id="faceResult"><div class="skeleton"></div></div>
    </div>`;

  el('#carouselView').innerHTML = `
    <div class="grid">
      <div class="card">${fileInput('photo', 'Референс фото', true)}
      <label>Промпт (опционально)<textarea id="carouselPrompt"></textarea></label>
      <label>Количество вариаций<select id="variations"><option>2</option><option>3</option><option selected>4</option><option>6</option><option>8</option></select></label>
      <div class="btn-row"><button id="carouselGenPrompt">Сгенерировать промпт</button><button id="carouselRun">Сгенерировать карусель</button></div></div>
      <div class="card result" id="carouselResult"><div class="skeleton"></div></div>
    </div>`;
}

function bindNav() {
  document.querySelectorAll('.nav-btn').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach((n) => n.classList.remove('active'));
    btn.classList.add('active');
    state.currentView = btn.dataset.view;
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    el(`#${btn.dataset.view}View`).classList.add('active');
    el('#viewTitle').textContent = btn.textContent;
  }));
}

function providerForm() {
  const root = el('#providerSettings');
  root.innerHTML = providerDefs.map(({ id, title }) => {
    const cfg = state.settings.promptProviders[id];
    return `<div class="card"><h3>${title}</h3>
      <label>Base URL <input data-provider="${id}" data-key="baseUrl" type="text" value="${cfg.baseUrl}"></label>
      <label>Модель <input data-provider="${id}" data-key="model" type="text" value="${cfg.model}"></label>
      <label>API Key <input data-provider="${id}" data-key="apiKey" type="password" autocomplete="off" placeholder="${cfg.hasKey ? 'Ключ сохранен' : 'Введите ключ'}"></label>
      <small>${cfg.hasKey ? 'Ключ уже сохранен на сервере.' : 'Ключ пока не задан.'}</small></div>`;
  }).join('');
}

async function api(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

async function loadSettings() {
  state.settings = await api('/api/settings');
  el('#promptFormat').value = state.settings.ui.promptFormat;
  el('#selectedPromptProvider').value = state.settings.ui.selectedPromptProvider;
  el('#nanoBaseUrl').value = state.settings.nanoBanana.baseUrl;
  el('#nanoModel').value = state.settings.nanoBanana.model;
  el('#nanoScenePath').value = state.settings.nanoBanana.scenePath;
  el('#nanoFaceSwapPath').value = state.settings.nanoBanana.faceSwapPath;
  el('#nanoCarouselPath').value = state.settings.nanoBanana.carouselPath;
  el('#nanoApiKey').placeholder = state.settings.nanoBanana.hasKey ? 'Ключ сохранен' : 'Введите ключ';
  providerForm();
}

function collectSettingsPayload(resetKeys = false) {
  const payload = {
    ui: {
      promptFormat: el('#promptFormat').value,
      selectedPromptProvider: el('#selectedPromptProvider').value
    },
    promptProviders: {},
    nanoBanana: {
      baseUrl: el('#nanoBaseUrl').value.trim(),
      model: el('#nanoModel').value,
      scenePath: el('#nanoScenePath').value.trim(),
      faceSwapPath: el('#nanoFaceSwapPath').value.trim(),
      carouselPath: el('#nanoCarouselPath').value.trim()
    }
  };

  document.querySelectorAll('[data-provider]').forEach((i) => {
    const p = i.dataset.provider;
    payload.promptProviders[p] ||= {};
    payload.promptProviders[p][i.dataset.key] = i.value.trim();
  });

  if (resetKeys) {
    payload.nanoBanana.apiKey = '';
    Object.values(payload.promptProviders).forEach((p) => { p.apiKey = ''; });
  } else {
    const nanoKey = el('#nanoApiKey').value.trim();
    if (nanoKey) payload.nanoBanana.apiKey = nanoKey;
  }

  return payload;
}

function filesFrom(container) {
  const data = {};
  container.querySelectorAll('input[type=file]').forEach((inp) => {
    if (inp.files[0]) data[inp.dataset.file] = inp.files[0];
  });
  return data;
}

async function generatePromptFor(modeName, promptEl) {
  const data = await api('/api/prompts/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: el('#promptFormat').value,
      userInstruction: promptEl.value,
      context: { modeName },
      provider: el('#selectedPromptProvider').value
    })
  });
  promptEl.value = data.promptText || JSON.stringify(data.promptJson, null, 2);
  toast('Промпт сгенерирован.');
}

function renderSingleResult(root, job) {
  const item = job.result.images[0];
  const src = item.url || `/api/files/${item.fileId}`;
  root.innerHTML = `<img src="${src}" alt="Результат"><div class="btn-row">
    <a href="${src}" download><button>Скачать PNG/JPG</button></a>
    <button class="copyPrompt">Копировать промпт</button>
    <button class="repeatJob">Повторить</button>
  </div>`;
  root.querySelector('.copyPrompt').onclick = () => navigator.clipboard.writeText(job.result.promptUsed || '');
}

function renderCarousel(job) {
  const root = el('#carouselResult');
  state.carouselImages = job.result.images.map((img) => img.url || `/api/files/${img.fileId}`);
  state.carouselIndex = 0;
  const thumbs = state.carouselImages.map((src, i) => `<img data-i="${i}" src="${src}" class="${i === 0 ? 'active' : ''}">`).join('');
  root.innerHTML = `<div class="carousel-viewport"><img class="carousel-main" src="${state.carouselImages[0]}" alt="Вариация">
    <div class="btn-row"><button id="prevVar">←</button><button id="nextVar">→</button><a href="/api/jobs/${job.id}/zip"><button>Скачать всё ZIP</button></a></div>
    <div id="carouselCounter">1 / ${state.carouselImages.length}</div><div class="mini-row">${thumbs}</div></div>`;

  const update = () => {
    root.querySelector('.carousel-main').src = state.carouselImages[state.carouselIndex];
    root.querySelector('#carouselCounter').textContent = `${state.carouselIndex + 1} / ${state.carouselImages.length}`;
    root.querySelectorAll('.mini-row img').forEach((img, i) => img.classList.toggle('active', i === state.carouselIndex));
  };
  root.querySelector('#prevVar').onclick = () => { state.carouselIndex = (state.carouselIndex - 1 + state.carouselImages.length) % state.carouselImages.length; update(); };
  root.querySelector('#nextVar').onclick = () => { state.carouselIndex = (state.carouselIndex + 1) % state.carouselImages.length; update(); };
  root.querySelectorAll('.mini-row img').forEach((img) => img.onclick = () => { state.carouselIndex = Number(img.dataset.i); update(); });
}

function pollJob(jobId, view) {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    const job = await api(`/api/jobs/${jobId}`);
    el('#jobStatus').textContent = `${job.stage} • ${job.progress}%`;
    if (job.status === 'done') {
      clearInterval(state.pollTimer);
      el('#jobStatus').textContent = 'Готово';
      if (view === 'scene') renderSingleResult(el('#sceneResult'), job);
      if (view === 'faceswap') renderSingleResult(el('#faceResult'), job);
      if (view === 'carousel') renderCarousel(job);
      toast('Генерация завершена.');
    }
    if (job.status === 'error') {
      clearInterval(state.pollTimer);
      el('#jobStatus').textContent = 'Ошибка';
      toast(job.error || 'Ошибка задачи.');
    }
  }, 1000);
}

function bindActions() {
  el('#toggleSettings').onclick = () => el('#settingsPanel').classList.toggle('collapsed');
  el('#showKeys').onchange = (e) => {
    document.querySelectorAll('input[type=password], input[data-key="apiKey"]').forEach((input) => {
      input.type = e.target.checked ? 'text' : 'password';
    });
  };

  el('#saveSettings').onclick = async () => {
    await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collectSettingsPayload()) });
    toast('Настройки сохранены.');
    await loadSettings();
  };

  el('#resetKeys').onclick = async () => {
    await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(collectSettingsPayload(true)) });
    toast('Ключи сброшены.');
    await loadSettings();
  };

  el('#testPromptProvider').onclick = async () => {
    const p = el('#selectedPromptProvider').value;
    const out = await api('/api/providers/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testPrompt: true, provider: p }) });
    toast(out.result.prompt.message);
  };

  el('#testNano').onclick = async () => {
    const out = await api('/api/providers/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testNano: true }) });
    toast(out.result.nanoBanana.message);
  };

  el('#faceConfirm').onchange = (e) => { el('#faceRun').disabled = !e.target.checked; };
  el('#sceneGenPrompt').onclick = () => generatePromptFor('Редактор сцены', el('#scenePrompt'));
  el('#faceGenPrompt').onclick = () => generatePromptFor('Face Swap', el('#facePrompt'));
  el('#carouselGenPrompt').onclick = () => generatePromptFor('Карусель вариаций', el('#carouselPrompt'));

  el('#sceneRun').onclick = async () => {
    const box = el('#sceneView');
    const files = filesFrom(box);
    if (!files.face) return toast('Загрузите файл лица.');
    const fd = new FormData();
    Object.entries(files).forEach(([k, v]) => fd.append(k, v));
    fd.append('prompt', el('#scenePrompt').value.trim());
    const out = await fetch('/api/jobs/scene', { method: 'POST', body: fd }).then((r) => r.json());
    if (!out.ok) return toast(out.error || 'Ошибка запуска.');
    el('#sceneResult').innerHTML = '<div class="skeleton"></div>';
    pollJob(out.jobId, 'scene');
  };

  el('#faceRun').onclick = async () => {
    const files = filesFrom(el('#faceswapView'));
    if (!files.faceRef) return toast('Загрузите референс лица.');
    const fd = new FormData();
    Object.entries(files).forEach(([k, v]) => fd.append(k, v));
    fd.append('prompt', el('#facePrompt').value.trim());
    fd.append('confirm', String(el('#faceConfirm').checked));
    const out = await fetch('/api/jobs/faceswap', { method: 'POST', body: fd }).then((r) => r.json());
    if (!out.ok) return toast(out.error || 'Ошибка запуска.');
    el('#faceResult').innerHTML = '<div class="skeleton"></div>';
    pollJob(out.jobId, 'faceswap');
  };

  el('#carouselRun').onclick = async () => {
    const files = filesFrom(el('#carouselView'));
    if (!files.photo) return toast('Загрузите референс фото.');
    const fd = new FormData();
    fd.append('photo', files.photo);
    fd.append('prompt', el('#carouselPrompt').value.trim());
    fd.append('variations', el('#variations').value);
    const out = await fetch('/api/jobs/carousel', { method: 'POST', body: fd }).then((r) => r.json());
    if (!out.ok) return toast(out.error || 'Ошибка запуска.');
    el('#carouselResult').innerHTML = '<div class="skeleton"></div>';
    pollJob(out.jobId, 'carousel');
  };
}

(async () => {
  buildViews();
  bindNav();
  await loadSettings();
  bindActions();
})();
