/* Флейм-Сити — здания-зоны: места, где в городе работают ИИ-агенты (смены fjobs, мини-игры fgames, интерьеры
 * finside, вывески fdeco). Данные, без кода: fmap.js (Флейм-Сити) и fmapx.js (Минск) сами ставят каждую зону на
 * свободный участок своего района. Новая зона — строка в конце списка (порядок влияет на раскладку участков).
 *
 *   key  — id зоны (M.zones[key]); kind — вид здания (иконка, цвет, оформление fdeco); city — район: msk | minsk | ala,
 *          null — центр; shop — своя вывеска {emoji, title, color, prop, w, h, d}; sub — что там делают.
 * Названия вымышленные: настоящих марок и сервисов в игре нет (docs/ARCHITECTURE.md «Право»).
 */
(function (global) {
  "use strict";
  function shop(emoji, title, color, prop, w, h, d) { return { emoji: emoji, title: title, color: color, prop: prop, w: w || 20, h: h || 16, d: d || 16 }; }
  global.FC_ZONES = [
    { key: "square", name: "Площадь Огонька", sub: "агенты отдыхают и болтают", kind: "plaza", city: null },
    // Москва-Сити: офисы сервисов, через которые агент работает за человека
    { key: "mail", name: "Почтамт", sub: "почта, календарь, диск", kind: "mail", city: "msk" },
    { key: "gallery", name: "Фотогалерея", sub: "смотрят профили и рилсы", kind: "gallery", city: "msk" },
    { key: "chat", name: "Чат-центр", sub: "собирают ботов, агент в чатах", kind: "chat", city: "msk" },
    { key: "web", name: "Сайты", sub: "верстают и выкладывают сайты", kind: "web", city: "msk" },
    { key: "notes", name: "Блокнот", sub: "ведут заметки и базы", kind: "notes", city: "msk" },
    { key: "deck", name: "Презентации", sub: "собирают слайды", kind: "deck", city: "msk" },
    { key: "office", name: "Контора", sub: "напоминания, планы, утренние сводки", kind: "office", city: "msk" },
    { key: "memory", name: "Архив", sub: "помнят правила и привычки хозяина", kind: "stalin", city: "msk" },
    // Москва: деловой пояс
    { key: "agency", name: "Маркетинг-агентство", sub: "конкуренты, клиенты, посты, карусели, сценарии рилсов", kind: "shop", city: "msk",
      shop: shop("📣", "МАРКЕТИНГ", "#ff8a3d", "megaphone", 22, 46, 18) },
    { key: "bank", name: "Банк", sub: "курсы валют, расходы, таблицы и графики", kind: "shop", city: "msk",
      shop: shop("🏦", "БАНК", "#2fbf71", "columns", 26, 20, 20) },
    { key: "notary", name: "Нотариус", sub: "проверяют договоры, готовят документы", kind: "shop", city: "msk",
      shop: shop("📜", "НОТАРИУС", "#a8643b", "seal", 20, 16, 16) },
    { key: "news", name: "Редакция", sub: "правда или фейк, главное из чатов", kind: "shop", city: "msk",
      shop: shop("📰", "РЕДАКЦИЯ", "#e42313", "ticker", 24, 30, 18) },
    { key: "translate", name: "Бюро переводов", sub: "переводы, суть в 3 строки, голосовые в текст", kind: "shop", city: "msk",
      shop: shop("🌍", "ПЕРЕВОДЫ", "#2aabee", "globe", 18, 26, 18) },
    { key: "concierge", name: "Консьерж", sub: "найдут место, специалиста и выгодную покупку", kind: "shop", city: "msk",
      shop: shop("🛎️", "КОНСЬЕРЖ", "#c9a14a", "bell", 20, 38, 18) },
    // Минск
    { key: "library", name: "Читальня", sub: "ищут в сети, читают, отвечают на вопросы", kind: "diamond", city: "minsk" },
    { key: "scout", name: "Разведка", sub: "собирают данные из открытых источников", kind: "beacon", city: "minsk" },
    { key: "forge", name: "Мастерская", sub: "код, документы, файлы", kind: "forge", city: "minsk" },
    { key: "school", name: "Школа", sub: "решают задачи, переписывают текст с фото", kind: "shop", city: "minsk",
      shop: shop("✏️", "ШКОЛА", "#4285f4", "clock", 26, 16, 18) },
    { key: "lab", name: "Лаборатория", sub: "разбирают состав, считают калории", kind: "shop", city: "minsk",
      shop: shop("🧪", "ЛАБОРАТОРИЯ", "#41e08c", "flasks", 20, 18, 18) },
    { key: "print", name: "Типография", sub: "PDF, QR-коды, пригласительные", kind: "shop", city: "minsk",
      shop: shop("🖨️", "ТИПОГРАФИЯ", "#7c5cff", "roll", 24, 14, 18) },
    { key: "skills", name: "Академия навыков", sub: "учат агента новому", kind: "shop", city: "minsk",
      shop: shop("🎓", "АКАДЕМИЯ", "#ffc451", "dome", 24, 18, 20) },
    { key: "toys", name: "Магазин фигурок", sub: "3D-фигурка в коробке", kind: "shop", city: "minsk",
      shop: shop("🧸", "ФИГУРКИ", "#ff8a5c", "box", 18, 16, 16) },
    { key: "stickers", name: "Стикерная", sub: "стикерпаки из фото", kind: "shop", city: "minsk",
      shop: shop("😜", "СТИКЕРЫ", "#ffcc4d", "kiosk", 16, 12, 14) },
    { key: "baby", name: "Будущий малыш", sub: "каким будет ваш ребёнок", kind: "shop", city: "minsk",
      shop: shop("👶", "МАЛЫШ", "#9fd0ff", "rattle", 18, 14, 16) },
    { key: "voice", name: "Радио", sub: "озвучка текста и голосовые задачи", kind: "shop", city: "minsk",
      shop: shop("🎙️", "РАДИО", "#ff4a4a", "mast", 18, 20, 16) },
    // Алматы: киностудия
    { key: "shoot", name: "Съёмочная", sub: "снимают видео и рисуют картинки", kind: "shoot", city: "ala" },
    { key: "cut", name: "Монтажная", sub: "собирают ролики и субтитры", kind: "cut", city: "ala" },
    { key: "reels", name: "Рилс-студия", sub: "монтаж коротких роликов", kind: "reels", city: "ala" },
    { key: "queue", name: "Проявочная", sub: "ждут, пока проявится рендер", kind: "queue", city: "ala" },
    { key: "view", name: "Просмотровая", sub: "колесо обозрения: разбирают снимки и ролики", kind: "wheel", city: "ala" },
    // Алматы: Фотоквартал — всё про фото
    { key: "foto34", name: "Фото на документы", sub: "паспорт, виза, пропуск — фото по стандарту", kind: "shop", city: "ala",
      shop: shop("📇", "ФОТО НА ДОКУМЕНТЫ", "#2f6fd6", "booth", 22, 14, 16) },
    { key: "photoshoot", name: "Фотостудия", sub: "фотосессии, образы, обложка журнала", kind: "shop", city: "ala",
      shop: shop("📷", "ФОТОСТУДИЯ", "#e1306c", "camera", 22, 22, 18) },
    { key: "restore", name: "Реставрация", sub: "старые фото, чёткость, портрет поколений", kind: "shop", city: "ala",
      shop: shop("🖼️", "РЕСТАВРАЦИЯ", "#b88a3e", "columns", 22, 14, 16) },
    { key: "retouch", name: "Ретушь", sub: "убрать лишнее, убрать фон, правка фото", kind: "shop", city: "ala",
      shop: shop("✂️", "РЕТУШЬ", "#ff6fae", "scissors", 18, 16, 16) },
    { key: "interior", name: "Дизайн-бюро", sub: "новый интерьер комнаты по фото", kind: "shop", city: "ala",
      shop: shop("🛋️", "ДИЗАЙН-БЮРО", "#3fa99b", "showroom", 22, 16, 18) },
    { key: "salon", name: "Салон причёсок", sub: "примерка причёски по фото", kind: "shop", city: "ala",
      shop: shop("💇", "САЛОН", "#ff7ab8", "pole", 18, 12, 14) },
    { key: "art", name: "Арт-студия", sub: "аниме-стиль, карикатуры, рисунки", kind: "shop", city: "ala",
      shop: shop("🎨", "АРТ-СТУДИЯ", "#ffb02e", "palette", 20, 16, 16) },
    { key: "effects", name: "Студия эффектов", sub: "трендовые видео-эффекты из фото", kind: "shop", city: "ala",
      shop: shop("🔮", "ЭФФЕКТЫ", "#a77bff", "neon", 20, 14, 16) }
  ];
})(window);
