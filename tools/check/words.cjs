/* Списки запретных слов (политика любой стороны, оскорбления, грубость) и проверка текста — общие для сторожа PR
 * (content-guard.cjs) и страницы статуса (tools/status/build-status.cjs: заголовки идей и PR игроков на нашем сайте).
 * Списки закодированы base64: в поиске по репозиторию игры не всплывают имена и лозунги — это список запретов, а не
 * содержание игры. «слово$» — только целое слово, иначе — начало слова. */
const dec = (s) => JSON.parse(Buffer.from(s, "base64").toString("utf8"));

// Политика любой стороны: флаги, символы, лозунги, политики, война. Совпадение по началу слова, регистр не важен.
const POLITICS = dec("WyLQsdGH0LEkIiwi0LHQtdC70L4t0LrRgNCw0YHQvdC+LdCx0LXQuyIsItCx0LXQuy3Rh9GL0YDQstC+0L3QsC3QsdC10LsiLCLQsdC10LvQvtC60YDQsNGB0L3QvtCx0LXQuyIsIndoaXRlLXJlZC13aGl0ZSIsItC/0LDQs9C+0L3RjyIsInBhaG9uaWEiLCJwYWhvbnlhIiwi0LbRi9Cy0LUg0LHQtdC70LDRgNGD0YHRjCIsItC20LjQstC1INCx0LXQu9Cw0YDRg9GB0YwiLCLRgdC70LDQstCwINGD0LrRgNCw0LjQvdC1Iiwi0LPQtdGA0L7Rj9C8INGB0LvQsNCy0LAiLCLQu9GD0LrQsNGI0LXQvdC6Iiwi0YLQuNGF0LDQvdC+0LLRgdC6Iiwi0L/Rg9GC0LjQvSQiLCLQv9GD0YLQuNC90LAkIiwi0L/Rg9GC0LjQvdGDJCIsItC/0YPRgtC40L3Ri9C8JCIsItC30LXQu9C10L3RgdC6Iiwi0L3QsNCy0LDQu9GM0L0iLCLQsdCw0LHQsNGA0LjQuiIsItGB0LLQvtC40YUg0L3QtSDQsdGA0L7RgdCw0LXQvCIsItC60YDRi9C80L3QsNGIIiwi0YHQstC+JCIsInpvdiQiLCLQutCw0LTRi9GA0L7QsiIsItCy0LDQs9C90LXRgCIsItC60LPQsSQiLCLQvtC80L7QvSQiLCLRgdCy0LDRgdGC0LjQuiIsInN3YXN0aWsiLCJzaWVnIGhlaWwiLCLQt9C40LMg0YXQsNC50LvRjCIsItGF0LDQudC70YwkIl0=");
// Оскорбления групп людей (EN/RU).
const SLURS = dec("WyLRhdCw0YckIiwi0YXQsNGH0LgkIiwi0YXQsNGH0LXQuSQiLCLRh9GD0YDQuiIsItC20LjQtCQiLCLQttC40LTRiyQiLCLQttC40LTQvtCyJCIsItC20LjQtNC+0LLRgdC6Iiwi0L/QuNC00L7RgCIsItC/0LjQtNCw0YAiLCLQv9C10LTQuNC6JCIsItC/0LXQtNC40LrQuCQiLCLRhdC+0YXQvtC7JCIsItGF0L7RhdC70YskIiwi0YXQvtGF0LvQvtCyJCIsItC60LDRhtCw0L8iLCLQvNC+0YHQutCw0LvRjCIsIm5pZ2dlciIsIm5pZ2dhIiwiZmFnZ290Iiwia2lrZSQiLCJyZXRhcmQkIl0=");
// Грубые слова — не запрет, но на глаза мейнтейнеру.
const RUDE = dec("WyLRhdGD0LkiLCLRhdGD0LUiLCLRhdGD0Y8iLCLQv9C40LfQtCIsItC10LHQsNGCIiwi0LXQsdCw0L0iLCLQtdCx0LvQviIsItCx0LvRj9C0Iiwi0LHQu9GP0YLRjCIsItGB0YPQutCwJCIsItGB0YPQutC4JCIsItC80YPQtNCw0LoiLCJmdWNrIiwic2hpdCQiLCJiaXRjaCIsImN1bnQiXQ==");
const norm = (s) => s.toLowerCase().replace(/ё/g, "е");
const wordRe = (w) => {
  const whole = w.endsWith("$"), b = norm(whole ? w.slice(0, -1) : w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^\\p{L}\\p{N}])" + b + (whole ? "(?![\\p{L}\\p{N}])" : ""), "u"); };   // «слово$» — только целиком
const POL = POLITICS.map(wordRe), SL = SLURS.map(wordRe), RU = RUDE.map(wordRe);
// bad(text) → "politics" | "slur" | "rude" | null
function bad(text) {
  const t = norm(String(text || ""));
  if (POL.some((r) => r.test(t))) return "politics";
  if (SL.some((r) => r.test(t))) return "slur";
  if (RU.some((r) => r.test(t))) return "rude";
  return null;
}
module.exports = { norm, POL, SL, RU, bad };
