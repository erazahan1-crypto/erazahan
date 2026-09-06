import fs from 'node:fs';
import path from 'node:path';

// Указываем пути к файлам
const jsonPath = path.resolve('src/data/posts.json');
const outputPath = path.resolve('existing_symbols.txt');

try {
    // 1. Проверяем, существует ли файл
    if (!fs.existsSync(jsonPath)) {
        console.error(`❌ Ошибка: Файл не найден по пути ${jsonPath}`);
        process.exit(1);
    }

    // 2. Читаем и парсим JSON
    console.log('⏳ Чтение файла posts.json...');
    const rawData = fs.readFileSync(jsonPath, 'utf-8');
    const posts = JSON.parse(rawData);

    // Если JSON представляет собой объект, превращаем его в массив
    const postsArray = Array.isArray(posts) ? posts : Object.values(posts);

    // 3. Подготавливаем Set для уникальных слов и регулярку
    const uniqueSymbols = new Set();
    const prefixRegex = /^Երազահան[\s:՝,;–—-]*\s*/iu;
    let parsedCount = 0;

    // 4. Проходим по всем постам
    for (const post of postsArray) {
        // Ищем поле title (или заголовок)
        const title = post.title || post.name || ''; 
        
        if (title) {
            parsedCount++;
            // Очищаем заголовок
            const cleanTitle = title.replace(prefixRegex, '').trim();
            if (cleanTitle) {
                uniqueSymbols.add(cleanTitle);
            }
        }
    }

    // 5. Сортируем по алфавиту и сохраняем
    const sortedSymbols = Array.from(uniqueSymbols).sort();
    fs.writeFileSync(outputPath, sortedSymbols.join('\n'), 'utf-8');

    // 6. Выводим итоги
    console.log('\n✅ Готово!');
    console.log(`📄 Всего постов в JSON: ${postsArray.length}`);
    console.log(`🔍 Заголовков обработано: ${parsedCount}`);
    console.log(`💎 Уникальных символов найдено: ${sortedSymbols.length}`);
    console.log(`💾 Список сохранен в: ${outputPath}`);

} catch (error) {
    console.error('❌ Произошла непредвиденная ошибка:', error.message);
}