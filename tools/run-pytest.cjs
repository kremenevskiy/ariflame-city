#!/usr/bin/env node
/* npm test → pytest игрового сервера. Python: $PYTHON, иначе .venv/bin/python в корне репо, иначе python3.
 * Зависимости сервера: pip install -r server/requirements.txt -r server/requirements-dev.txt */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const venv = path.join(root, ".venv", "bin", "python");
const py = process.env.PYTHON || (fs.existsSync(venv) ? venv : "python3");
const r = spawnSync(py, ["-m", "pytest", "server/tests", "-q", "-p", "no:cacheprovider", ...process.argv.slice(2)],
  { cwd: root, stdio: "inherit" });
process.exit(r.status == null ? 1 : r.status);
