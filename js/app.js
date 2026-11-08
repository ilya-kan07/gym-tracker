if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

(async () => {
  await seedIfEmpty();

  // Просим браузер не удалять данные автоматически
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist();
  }

  console.log('База готова. Упражнений:', await db.exercises.count());
})();
