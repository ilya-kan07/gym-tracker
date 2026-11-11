if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

const app = document.getElementById('app');

// ===== Вспомогательные функции =====

// Защита от «ломающих» символов в названиях
function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 1160 -> «1 160», 72.5 -> «72,5»
function fmt(n) {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}

// Из поля ввода в число (понимает и запятую, и точку)
function parseNum(str) {
  return Number(String(str).trim().replace(',', '.'));
}

// Из числа в текст для поля ввода
function inputVal(n) {
  return String(n).replace('.', ',');
}

// '2026-11-01' -> '1 ноября'
function dateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  });
}

function totalReps(sets) {
  return sets.reduce((sum, s) => sum + s.reps, 0);
}

// ===== Экран 1: выбор дня =====
async function renderHome() {
  const days = await db.programDays.toArray();

  // Группируем по названию дня: «Грудь-Бицепс» -> [неделя 1, неделя 2]
  const groups = new Map();
  for (const day of days) {
    if (!groups.has(day.group)) groups.set(day.group, []);
    groups.get(day.group).push(day);
  }

  let html = '<h1>Тренировка</h1>';
  for (const [name, list] of groups) {
    list.sort((a, b) => a.week - b.week);
    html += `
      <section class="group">
        <h2>${esc(name)}</h2>
        <div class="weeks">
          ${list
            .map(
              (d) =>
                `<a class="week-btn" href="#/day/${d.id}">${d.week} неделя</a>`
            )
            .join('')}
        </div>
      </section>`;
  }
  app.innerHTML = html;
}

// ===== Экран 2: упражнения дня =====
async function renderDay(dayId) {
  const day = await db.programDays.get(dayId);
  if (!day) {
    location.hash = '#/';
    return;
  }

  const today = todayStr();
  let html = `
    <a class="back" href="#/">‹ Назад</a>
    <h1>${esc(day.group)} · ${day.week} нед.</h1>`;

  for (const exId of day.exerciseIds) {
    const ex = await db.exercises.get(exId);

    const todayCount = await db.sets
      .where('[exerciseId+date]')
      .equals([exId, today])
      .count();

    const prevSets = await getPreviousSets(exId, today);
    const prevText = prevSets.length
      ? `Прошлый раз: ${fmt(calcVolume(prevSets))} кг`
      : 'Прошлый раз: нет данных';

    const doneText = todayCount
      ? `<span class="done">Сегодня: ${todayCount} подх.</span> · `
      : '';

    html += `
      <a class="exercise" href="#/exercise/${ex.id}">
        <div class="name">${esc(ex.name)}</div>
        <div class="meta">${doneText}${prevText}</div>
      </a>`;
  }
  app.innerHTML = html;
}

// ===== Экран 3: упражнение (ввод подходов) =====
async function renderExercise(exId) {
  const ex = await db.exercises.get(exId);
  if (!ex) {
    location.hash = '#/';
    return;
  }

  const today = todayStr();
  const todaySets = await getSetsByDate(exId, today);
  const prevSets = await getPreviousSets(exId, today);
  const past = await getHistory(exId, today, 5);

  const todayVol = calcVolume(todaySets);
  const prevVol = calcVolume(prevSets);
  const nextNumber = todaySets.length + 1;

  // Что подставить в форму: тот же по номеру подход прошлой тренировки,
  // иначе последний сегодняшний подход, иначе пусто
  const src = prevSets[nextNumber - 1] || todaySets[todaySets.length - 1];
  const defWeight = src ? inputVal(src.weight) : '';
  const defReps = src ? String(src.reps) : '';

  // --- Блок «Прошлая тренировка» ---
  const prevBlock = prevSets.length
    ? `
    <section class="card">
      <h2>Прошлая тренировка</h2>
      <div class="card-sub">${dateLabel(prevSets[0].date)}</div>
      <div class="chips">
        ${prevSets
          .map(
            (s) =>
              `<div class="chip"><b>${s.setNumber}</b>${fmt(s.weight)} × ${s.reps}</div>`
          )
          .join('')}
      </div>
      <div class="total">Объём: ${fmt(prevVol)} кг
        <span>· ${totalReps(prevSets)} повт.</span></div>
    </section>`
    : `
    <section class="card">
      <h2>Прошлая тренировка</h2>
      <div class="card-sub">Данных пока нет</div>
    </section>`;

  // --- Блок «Форма ввода» ---
  const formBlock = `
    <section class="card">
      <h2>Подход ${nextNumber}</h2>
      <div class="field">
        <label for="weight">Вес, кг (0 — свой вес)</label>
        <div class="stepper">
          <button type="button" class="step" data-target="weight" data-delta="-2.5">−</button>
          <input id="weight" type="text" inputmode="decimal" placeholder="0" value="${defWeight}">
          <button type="button" class="step" data-target="weight" data-delta="2.5">+</button>
        </div>
      </div>
      <div class="field">
        <label for="reps">Повторы</label>
        <div class="stepper">
          <button type="button" class="step" data-target="reps" data-delta="-1">−</button>
          <input id="reps" type="text" inputmode="numeric" placeholder="0" value="${defReps}">
          <button type="button" class="step" data-target="reps" data-delta="1">+</button>
        </div>
      </div>
      <button type="button" id="add" class="primary">Добавить подход</button>
    </section>`;

  // --- Блок «Сегодня» ---
  let diffHtml = '';
  if (todaySets.length && prevVol > 0) {
    const diff = todayVol - prevVol;
    const pct = Math.round((diff / prevVol) * 100);
    const sign = diff > 0 ? '+' : '';
    diffHtml = `<div class="total ${diff >= 0 ? 'up' : 'down'}">
      К прошлому разу: ${sign}${fmt(diff)} кг (${sign}${pct}%)</div>`;
  }

  const todayBlock = todaySets.length
    ? `
    <section class="card">
      <h2>Сегодня</h2>
      <div class="sets-list">
        ${todaySets
          .map(
            (s) => `
          <div class="set-row">
            <span class="num">${s.setNumber}</span>
            <span class="val">${fmt(s.weight)} кг × ${s.reps}</span>
            <button type="button" class="del" data-id="${s.id}" aria-label="Удалить подход">✕</button>
          </div>`
          )
          .join('')}
      </div>
      <div class="total">Объём: ${fmt(todayVol)} кг
        <span>· ${totalReps(todaySets)} повт.</span></div>
      ${diffHtml}
    </section>`
    : '';

  // --- Блок «История» ---
  const rows = [];
  if (todaySets.length) rows.push({ label: 'Сегодня', vol: todayVol, today: true });
  for (const h of past) rows.push({ label: dateLabel(h.date), vol: h.volume });

  const maxVol = Math.max(...rows.map((r) => r.vol), 1);
  const historyBlock = rows.length
    ? `
    <section class="card">
      <h2>Объём по тренировкам</h2>
      ${rows
        .map(
          (r) => `
        <div class="hist-row ${r.today ? 'today' : ''}">
          <span class="d">${r.label}</span>
          <div class="bar"><i style="width:${Math.round((r.vol / maxVol) * 100)}%"></i></div>
          <span class="v">${fmt(r.vol)}</span>
        </div>`
        )
        .join('')}
    </section>`
    : '';

  app.innerHTML = `
    <a class="back" id="back" href="#/">‹ Назад</a>
    <h1>${esc(ex.name)}</h1>
    ${prevBlock}
    ${formBlock}
    ${todayBlock}
    ${historyBlock}`;

  // ===== Обработчики =====

  // Назад: на предыдущий экран (список упражнений дня)
  document.getElementById('back').addEventListener('click', (e) => {
    e.preventDefault();
    if (history.length > 1) history.back();
    else location.hash = '#/';
  });

  // Кнопки «−» и «+»
  app.querySelectorAll('.step').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      const cur = parseNum(input.value) || 0;
      const next = Math.max(
        0,
        Math.round((cur + Number(btn.dataset.delta)) * 100) / 100
      );
      input.value = inputVal(next);
    });
  });

  // Добавить подход
  document.getElementById('add').addEventListener('click', async () => {
    const weight = parseNum(document.getElementById('weight').value);
    const reps = parseNum(document.getElementById('reps').value);

    if (
      !Number.isFinite(weight) ||
      weight < 0 ||
      !Number.isInteger(reps) ||
      reps < 1
    ) {
      alert('Проверь вес и повторы: повторов должно быть минимум 1.');
      return;
    }

    await db.sets.add({
      exerciseId: exId,
      date: today,
      setNumber: nextNumber,
      weight,
      reps,
    });
    await renderExercise(exId);
  });

  // Удалить подход
  app.querySelectorAll('.del').forEach((btn) => {
    btn.addEventListener('click', () => deleteSet(exId, Number(btn.dataset.id)));
  });
}

// Удаляет подход и перенумеровывает оставшиеся за этот день
async function deleteSet(exId, setId) {
  const s = await db.sets.get(setId);
  if (!s || !confirm(`Удалить подход ${s.setNumber}?`)) return;

  await db.sets.delete(setId);
  const rest = await getSetsByDate(exId, s.date);
  await Promise.all(
    rest.map((x, i) => db.sets.update(x.id, { setNumber: i + 1 }))
  );
  await renderExercise(exId);
}

// ===== Маршрутизация =====
async function route() {
  const hash = location.hash || '#/';
  const parts = hash.split('/'); // '#/day/3' -> ['#', 'day', '3']

  if (parts[1] === 'day') await renderDay(Number(parts[2]));
  else if (parts[1] === 'exercise') await renderExercise(Number(parts[2]));
  else await renderHome();

  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);

// ===== Запуск =====
(async () => {
  await seedIfEmpty();

  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist();
  }

  await route();
})();
