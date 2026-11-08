// ===== База данных =====
const db = new Dexie('gym-tracker');

db.version(1).stores({
  exercises: '++id, &name, muscle',
  programDays: '++id, name, group, week',
  workouts: '++id, date',
  sets: '++id, exerciseId, date, [exerciseId+date]',
});

// ===== Стартовая программа (правь под себя) =====
const PROGRAM = [
  {
    group: 'Грудь-Бицепс',
    week: 1,
    exercises: [
      ['Жим лёжа', 'Грудь'],
      ['Жим гантелей в наклоне', 'Грудь'],
      ['Отжимания на брусьях', 'Грудь'],
      ['Бицепс штанга (широким)', 'Бицепс'],
      ['Молотки', 'Бицепс'],
    ],
  },
  {
    group: 'Грудь-Бицепс',
    week: 2,
    exercises: [
      ['Жим лёжа в наклоне', 'Грудь'],
      ['Жим лёжа в тренажёре', 'Грудь'],
      ['Бабочка', 'Грудь'],
      ['Бицепс штанга (узким)', 'Бицепс'],
      ['Сгибания в кроссовере', 'Бицепс'],
    ],
  },
  {
    group: 'Спина-Трицепс',
    week: 1,
    exercises: [
      ['Тяга вертикальная в блоке', 'Спина'],
      ['Тяга горизонтальная в блоке', 'Спина'],
      ['Тяга к широким', 'Спина'],
      ['Шраги', 'Спина'],
      ['Разгибания с гантелью', 'Трицепс'],
      ['Разгибания в блоке с канатом', 'Трицепс'],
    ],
  },
  {
    group: 'Спина-Трицепс',
    week: 2,
    exercises: [
      ['Тяга вертикальная', 'Спина'],
      ['Тяга горизонтальная в блоке', 'Спина'],
      ['Тяга к широким в хамере', 'Спина'],
      ['Шраги', 'Спина'],
      ['Французский со штангой', 'Трицепс'],
      ['Разгибания в блоке с прямой', 'Трицепс'],
    ],
  },
  {
    group: 'Ноги-Плечи',
    week: 1,
    exercises: [
      ['Приседания 1', 'Ноги'],
      ['Жим гантелей сидя', 'Плечи'],
      ['Подъем гантелей перед собой', 'Плечи'],
      ['Разведение гантелей в стороны', 'Плечи'],
      ['Обратные разведения в тренажере', 'Плечи'],
    ],
  },
  {
    group: 'Ноги-Плечи',
    week: 2,
    exercises: [
      ['Приседания 2', 'Ноги'],
      ['Тяга штанги к подбородку', 'Плечи'],
      ['Подъем гантелей перед собой', 'Плечи'],
      ['Разведение гантелей в стороны', 'Плечи'],
      ['Обратные разведения с гантелями', 'Плечи'],
    ],
  },
];

// Заполняет базу при первом запуске
async function seedIfEmpty() {
  if ((await db.programDays.count()) > 0) return;

  await db.transaction('rw', db.exercises, db.programDays, async () => {
    for (const day of PROGRAM) {
      const ids = [];
      for (const [name, muscle] of day.exercises) {
        let ex = await db.exercises.where('name').equals(name).first();
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
