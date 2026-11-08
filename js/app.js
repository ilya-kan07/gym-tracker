if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

const app = document.getElementById('app');

// Защита от «ломающих» символов в названиях
function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(n) {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
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

// ===== Экран 3: заглушка (сделаем в следующем шаге) =====
async function renderExercise(exId) {
  const ex = await db.exercises.get(exId);
  app.innerHTML = `
    <a class="back" href="javascript:history.back()">‹ Назад</a>
    <h1>${ex ? esc(ex.name) : 'Упражнение'}</h1>
    <p class="placeholder">Экран ввода подходов появится в следующем шаге.</p>`;
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
