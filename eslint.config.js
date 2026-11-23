/* Линтер: два правила, ради которых он заведён.
 *
 * no-undef — модули клиента живут на window (IIFE на FC); свободная переменная, уехавшая при переносе кода, в строгом
 * режиме роняет кадр ReferenceError'ом, а цикл отрисовки при этом жив — ошибка прячется. Ловим до запуска.
 * no-unused-vars — мёртвый код: функция или переменная, которую никто не читает, — ошибка. Держать нарочно —
 * `// eslint-disable-line no-unused-vars -- зачем`.
 */
const globals = require("globals");

const rules = {
  "no-undef": "error",
  "no-implicit-globals": ["error", { lexicalBindings: true }],
  "no-unused-vars": ["error", { vars: "all", args: "none", caughtErrors: "none" }],
};

module.exports = [
  {
    files: ["client/**/*.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "script",
      globals: {
        ...globals.browser,
        Telegram: "readonly",
        THREE: "readonly",
      },
    },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules,
  },
  {
    files: ["tools/**/*.cjs", "tools/**/*.js", "eslint.config.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "commonjs", globals: { ...globals.node } },
    rules: { "no-undef": "error", "no-unused-vars": ["error", { vars: "all", args: "none", caughtErrors: "none" }] },
  },
  // Собранный движок (tools/world-three.cjs) и данные OSM — не наш рукописный код.
  { ignores: ["client/vendor/**", "client/minsk/**", "node_modules/**"] },
];
