// ===== База данных =====
// ===== База данных =====
const db = new Dexie('gym-tracker');

const SCHEMA = {
  exercises: '++id, &name, muscle',
  programDays: '++id, name, group, week',
  workouts: '++id, date',
  sets: '++id, exerciseId, date, [exerciseId+date]',
};

db.version(1).stores(SCHEMA);

// Версия 2: новая программа. Старые данные (тестовые) стираются,
// после этого seedIfEmpty() заполнит базу заново
db.version(2)
  .stores(SCHEMA)
  .upgrade(async (tx) => {
    await tx.table('sets').clear();
    await tx.table('workouts').clear();
    await tx.table('programDays').clear();
    await tx.table('exercises').clear();
  });

// ===== Программа (порядок упражнений = их номера) =====
// Упражнение с одинаковым названием на разных неделях — одно и то же,
// история у него общая
const PROGRAM = [
  {
    group: 'Грудь-Бицепс',
    week: 1,
    exercises: [
      ['Жим лёжа', 'Грудь'],
      ['Жим лёжа гантелей в наклоне', 'Грудь'],
      ['Бицепс штанга (широким)', 'Бицепс'],
      ['Отжимания на брусьях', 'Грудь'],
      ['Молотки', 'Бицепс'],
    ],
  },
  {
    group: 'Спина-Трицепс',
    week: 1,
    exercises: [
      ['Тяга вертикальная в блоке', 'Спина'],
      ['Тяга горизонтальная в блоке', 'Спина'],
      ['Тяга в хаммере (верхняя)', 'Спина'],
      ['Разгибание с гантелью', 'Трицепс'],
      ['Разгибания на блоке (канат)', 'Трицепс'],
    ],
  },
  {
    group: 'Ноги-Плечи',
    week: 1,
    exercises: [
      ['Приседания', 'Ноги'],
      ['Жим гантелей сидя', 'Плечи'],
      ['Подъём гантелей перед собой', 'Плечи'],
      ['Отведения гантелей в стороны', 'Плечи'],
      ['Обратные разведения в тренажере', 'Плечи'],
    ],
  },
  {
    group: 'Грудь-Бицепс',
    week: 2,
    exercises: [
      ['Жим лёжа в наклоне', 'Грудь'],
      ['Жим лёжа в тренажере', 'Грудь'],
      ['Бицепс штанга (узким)', 'Бицепс'],
      ['Бабочка', 'Грудь'],
      ['Бицепс гантели', 'Бицепс'],
    ],
  },
  {
    group: 'Спина-Трицепс',
    week: 2,
    exercises: [
      ['Тяга вертикальная в хаммере', 'Спина'],
      ['Тяга горизонтальная в блоке', 'Спина'],
      ['Тяга в хаммере (нижняя)', 'Спина'],
      ['Французский жим со штангой', 'Трицепс'],
      ['Шраги', 'Спина'],
      ['Разгибания на блоке (прямая)', 'Трицепс'],
    ],
  },
  {
    group: 'Ноги-Плечи',
    week: 2,
    exercises: [
      ['Приседания', 'Ноги'],
      ['Тяга штанги к подбородку', 'Плечи'],
      ['Подъём гантелей перед собой', 'Плечи'],
      ['Отведения гантелей в стороны', 'Плечи'],
      ['Обратные разведения с гантелями', 'Плечи'],
    ],
  },
];

// Заполняет базу, если она пустая
async function seedIfEmpty() {
  if ((await db.programDays.count()) > 0) return;

  await db.transaction('rw', db.exercises, db.programDays, async () => {
    for (const day of PROGRAM) {
      const ids = [];
      for (const [name, muscle] of day.exercises) {
        const ex = await db.exercises.where('name').equals(name).first();
        const id = ex ? ex.id : await db.exercises.add({ name, muscle });
        ids.push(id);
      }
      await db.programDays.add({
        name: `${day.group} · ${day.week} неделя`,
        group: day.group,
        week: day.week,
        exerciseIds: ids,
      });
    }
  });
}

// ===== Вспомогательные функции =====

// Сегодняшняя дата по местному времени: '2026-11-08'
function todayStr() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Объём = сумма (вес × повторы)
function calcVolume(sets) {
  return sets.reduce((sum, s) => sum + s.weight * s.reps, 0);
}

// Подходы упражнения за ПРОШЛУЮ тренировку (дата строго раньше beforeDate)
async function getPreviousSets(exerciseId, beforeDate) {
  const last = await db.sets
    .where('[exerciseId+date]')
    .between([exerciseId, Dexie.minKey], [exerciseId, beforeDate])
    .last();
  if (!last) return [];
  return db.sets
    .where('[exerciseId+date]')
    .equals([exerciseId, last.date])
    .sortBy('setNumber');
}

// Подходы упражнения за конкретную дату, по порядку номеров
function getSetsByDate(exerciseId, date) {
  return db.sets
    .where('[exerciseId+date]')
    .equals([exerciseId, date])
    .sortBy('setNumber');
}

// История упражнения: последние тренировки ДО указанной даты.
// Возвращает [{ date, sets, volume }], от новых к старым
async function getHistory(exerciseId, beforeDate, limit = 5) {
  const all = await db.sets.where('exerciseId').equals(exerciseId).toArray();

  const byDate = new Map();
  for (const s of all) {
    if (s.date >= beforeDate) continue;
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  }

  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, limit)
    .map(([date, sets]) => ({ date, sets, volume: calcVolume(sets) }));
}

// ===== Резервное копирование =====
const BACKUP_KEY = 'gym-last-backup';

// Собирает все данные в один объект
async function exportData() {
  const [exercises, programDays, workouts, sets] = await Promise.all([
    db.exercises.toArray(),
    db.programDays.toArray(),
    db.workouts.toArray(),
    db.sets.toArray(),
  ]);
  return {
    app: 'gym-tracker',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: { exercises, programDays, workouts, sets },
  };
}

// Дата последней сохранённой копии (или null)
function getLastBackup() {
  try {
    const v = localStorage.getItem(BACKUP_KEY);
    return v ? new Date(v) : null;
  } catch {
    return null;
  }
}

function markBackupDone() {
  try {
    localStorage.setItem(BACKUP_KEY, new Date().toISOString());
  } catch {}
}

// Проверка файла перед восстановлением. Возвращает текст ошибки или null
function validateBackup(obj) {
  if (!obj || obj.app !== 'gym-tracker' || !obj.data) {
    return 'Это не файл резервной копии Gym Tracker.';
  }
  const d = obj.data;
  for (const table of ['exercises', 'programDays', 'workouts', 'sets']) {
    if (!Array.isArray(d[table])) return `В файле нет раздела «${table}».`;
  }

  const num = (x) => typeof x === 'number' && Number.isFinite(x);
  const dateOk = /^\d{4}-\d{2}-\d{2}$/;

  for (const e of d.exercises) {
    if (!num(e.id) || typeof e.name !== 'string') return 'Повреждены данные упражнений.';
  }
  for (const p of d.programDays) {
    if (!num(p.id) || !Array.isArray(p.exerciseIds)) return 'Повреждены данные программы.';
  }
  for (const s of d.sets) {
    if (
      !num(s.id) ||
      !num(s.exerciseId) ||
      !dateOk.test(s.date) ||
      !num(s.setNumber) ||
      !num(s.weight) ||
      !num(s.reps)
    ) {
      return 'Повреждены данные подходов.';
    }
  }
  return null;
}

// Полностью заменяет данные содержимым копии.
// Это одна транзакция: при любой ошибке старые данные остаются нетронутыми
async function importData(obj) {
  const d = obj.data;
  await db.transaction(
    'rw',
    db.exercises,
    db.programDays,
    db.workouts,
    db.sets,
    async () => {
      await db.exercises.clear();
      await db.programDays.clear();
      await db.workouts.clear();
      await db.sets.clear();

      await db.exercises.bulkAdd(d.exercises);
      await db.programDays.bulkAdd(d.programDays);
      await db.workouts.bulkAdd(d.workouts);
      await db.sets.bulkAdd(d.sets);
    }
  );
}
