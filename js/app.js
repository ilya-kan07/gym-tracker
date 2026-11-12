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
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
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

// 0 -> «сегодня», 1 -> «вчера», 5 -> «5 дн. назад»
function daysAgoText(n) {
  if (n <= 0) return 'сегодня';
  if (n === 1) return 'вчера';
  return `${n} дн. назад`;
}

function daysSince(date) {
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

// ===== Дата тренировки =====
// null = «сегодня» (определяется автоматически). Иначе выбранная вручную дата
let manualDate = null;

function getWorkDate() {
  return manualDate || todayStr();
}

// Как называть выбранный день: «Сегодня» или «1 ноября»
function dayWord() {
  return manualDate ? dateLabel(manualDate) : 'Сегодня';
}

// Строка выбора даты (вставляется под заголовок экрана)
function dateBarHtml() {
  const current = getWorkDate();
  return `
    <div class="datebar ${manualDate ? 'past' : ''}">
      <label for="workdate">Дата тренировки</label>
      <input type="date" id="workdate" value="${current}" max="${todayStr()}">
      ${manualDate ? '<button type="button" id="todaybtn">Сегодня</button>' : ''}
    </div>`;
}

// Подключает строку выбора даты; rerender перерисовывает текущий экран
function bindDateBar(rerender) {
  const input = document.getElementById('workdate');
  input.addEventListener('change', () => {
    const v = input.value;
    // пустое значение и будущие даты игнорируем
    if (!v || v > todayStr()) {
      input.value = getWorkDate();
      return;
    }
    manualDate = v === todayStr() ? null : v;
    rerender();
  });

  const btn = document.getElementById('todaybtn');
  if (btn) {
    btn.addEventListener('click', () => {
      manualDate = null;
      rerender();
    });
  }
}

// ===== Экран 1: выбор дня =====
async function renderHome() {
  manualDate = null; // на главном экране всегда возвращаемся к сегодняшней дате
  const programDays = await db.programDays.toArray();

  // Группируем по названию дня: «Грудь-Бицепс» -> [неделя 1, неделя 2]
  const groups = new Map();
  for (const day of programDays) {
    if (!groups.has(day.group)) groups.set(day.group, []);
    groups.get(day.group).push(day);
  }

  // Напоминание о резервной копии
  const setsCount = await db.sets.count();
  const last = getLastBackup();
  let banner = '';
  if (setsCount > 0) {
    if (!last) {
      banner = `<a class="banner" href="#/settings">Резервной копии ещё не было. Сохранить →</a>`;
    } else if (daysSince(last) >= 7) {
      banner = `<a class="banner" href="#/settings">Последняя копия: ${daysAgoText(
        daysSince(last)
      )}. Сохранить →</a>`;
    }
  }

  let html = `<h1>Тренировка</h1>${banner}`;
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
  html += `<a class="settings-link" href="#/settings">Резервная копия и данные</a>`;
  app.innerHTML = html;
}

// ===== Экран 2: упражнения дня =====
async function renderDay(dayId) {
  const day = await db.programDays.get(dayId);
  if (!day) {
    location.hash = '#/';
    return;
  }

  const today = getWorkDate();
  let html = `
    <a class="back" href="#/">‹ Назад</a>
    <h1>${esc(day.group)} · ${day.week} нед.</h1>
    ${dateBarHtml()}`;

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
      ? `<span class="done">${dayWord()}: ${todayCount} подх.</span> · `
      : '';

    html += `
      <a class="exercise" href="#/exercise/${ex.id}">
        <div class="name">${esc(ex.name)}</div>
        <div class="meta">${doneText}${prevText}</div>
      </a>`;
  }
  app.innerHTML = html;
  bindDateBar(() => renderDay(dayId));
}

// ===== Экран 3: упражнение (ввод подходов) =====
async function renderExercise(exId) {
  const ex = await db.exercises.get(exId);
  if (!ex) {
    location.hash = '#/';
    return;
  }

  const today = getWorkDate();
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
      <h2>${dayWord()}</h2>
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
  if (todaySets.length) rows.push({ label: dayWord(), vol: todayVol, today: true });
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
    ${dateBarHtml()}
    ${formBlock}
    ${prevBlock}
    ${todayBlock}
    ${historyBlock}`;

  // ===== Обработчики =====

  // Назад: на предыдущий экран (список упражнений дня)
  bindDateBar(() => renderExercise(exId));
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

// ===== Экран 4: данные и резервная копия =====
async function renderSettings() {
  // Файл готовим заранее: iOS разрешает открыть меню «Поделиться»
  // только сразу после нажатия, без долгих ожиданий
  const payload = await exportData();
  const json = JSON.stringify(payload, null, 2);
  const fileName = `gym-backup-${todayStr()}.json`;
  const file = new File([json], fileName, { type: 'application/json' });
  const setsCount = payload.data.sets.length;

  const last = getLastBackup();
  const lastText = last
    ? `${last.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} (${daysAgoText(
        daysSince(last)
      )})`
    : 'ещё не было';

  app.innerHTML = `
    <a class="back" href="#/">‹ Назад</a>
    <h1>Данные</h1>

    <section class="card">
      <h2>Резервная копия</h2>
      <div class="card-sub">Подходов в базе: ${setsCount}<br>Последняя копия: ${lastText}</div>
      <button type="button" id="save" class="primary">Сохранить копию</button>
      <p class="hint">В открывшемся меню выбери «Сохранить в Файлы» и папку в iCloud Drive.</p>
    </section>

    <section class="card">
      <h2>Восстановление</h2>
      <p class="hint">Все текущие данные будут заменены содержимым файла.</p>
      <label for="file" class="secondary">Загрузить из файла</label>
      <input id="file" type="file" accept=".json,application/json" hidden>
    </section>`;

  // Сохранить копию
  document.getElementById('save').addEventListener('click', async () => {
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Gym Tracker — копия' });
      } else {
        // Запасной вариант: обычное скачивание файла
        const url = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
      markBackupDone();
      await renderSettings();
    } catch (err) {
      // AbortError: ты сам закрыл меню, это не ошибка
      if (err.name !== 'AbortError') {
        alert('Не удалось сохранить файл: ' + err.message);
      }
    }
  });

  // Восстановить из файла
  document.getElementById('file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;

    try {
      let obj;
      try {
        obj = JSON.parse(await f.text());
      } catch {
        alert('Не удалось прочитать файл: он повреждён или это не копия приложения.');
        return;
      }

      const problem = validateBackup(obj);
      if (problem) {
        alert(problem);
        return;
      }

      const when = obj.exportedAt
        ? new Date(obj.exportedAt).toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'long',
          })
        : 'неизвестной даты';

      const ok = confirm(
        `Заменить все данные копией от ${when}?\n` +
          `Подходов в файле: ${obj.data.sets.length}.\n` +
          `Сейчас в приложении: ${setsCount}.\n` +
          `Текущие данные будут удалены.`
      );
      if (!ok) return;

      await importData(obj);
      alert('Готово: данные восстановлены.');
      location.hash = '#/';
    } catch (err) {
      alert('Не удалось восстановить данные: ' + err.message);
    } finally {
      e.target.value = '';
    }
  });
}

// ===== Маршрутизация =====
async function route() {
  const hash = location.hash || '#/';
  const parts = hash.split('/'); // '#/day/3' -> ['#', 'day', '3']

  if (parts[1] === 'day') await renderDay(Number(parts[2]));
  else if (parts[1] === 'exercise') await renderExercise(Number(parts[2]));
  else if (parts[1] === 'settings') await renderSettings();
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
