#!/usr/bin/env bash
# Флейм-Сити, люди — весь конвейер ассетов: скачать → Blender (скелет, LOD, клипы) → атласы → сжатие → client/people/.
#
#   tools/fc-humans/run.sh <рабочая папка вне репо> [UAL1.zip]
#
# Шаги: fetch (Rocketbox с GitHub по assets.json — только данные, ничего из загрузок не исполняется), build.py в Blender
# 5.2 без интерфейса, tex.py (Python 3 + Pillow + numpy, cwebp), pack.cjs (gltf-transform + meshoptimizer — ставятся в
# ~/.cache/fc-humans-tools). Quaternius UAL1 Standard (CC0) отдаётся только со страницы магазина (JS-кнопка):
# скачай Universal_Animation_LibraryStandard.zip руками и передай вторым аргументом (sha256 — в assets.json).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"   # корень репо (tools/fc-humans → ..)
WORK="${1:?рабочая папка}"; ZIP="${2:-}"
DL="$WORK/dl"; OUTW="$WORK/work"; OUT="$ROOT/client/people"
mkdir -p "$DL/rb/av" "$DL/rb/anim" "$DL/ual1" "$OUTW"
RB=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["rocketbox"])' "$HERE/assets.json")

# 1. Rocketbox: FBX аватаров и цветные текстуры (TGA), клипы m_/f_ — список берётся из дерева репо через API GitHub
TREE="$DL/rb/tree.json"
[ -s "$TREE" ] || curl -sfL -A fc-humans "https://api.github.com/repos/microsoft/Microsoft-Rocketbox/git/trees/master?recursive=1" -o "$TREE"
python3 - "$HERE/assets.json" "$TREE" > "$DL/rb/list.txt" <<'PY'
import json, sys
cfg = json.load(open(sys.argv[1])); tree = [x["path"] for x in json.load(open(sys.argv[2]))["tree"]]
av = {v["src"].split("/")[-1] for v in cfg["variants"]}
names = {c["src"][3:] for c in cfg["clips"] if c["src"].startswith("rb:")}
for p in tree:
    s = p.split("/")
    if len(s) >= 5 and s[0] == "Assets" and s[1] == "Avatars" and s[3] in av:
        n = s[-1]
        if (n.endswith(".fbx") and not n.endswith("_facial.fbx")) or ("_color" in n and n.endswith(".tga") and "pistol" not in n):
            print("av/" + s[3] + "/" + n + "\t" + p)
    if p.startswith("Assets/Animations/") and p.endswith(".max.fbx"):
        n = s[-1][:-8]
        if n[2:] in names and n[:2] in ("m_", "f_"):
            print("anim/" + s[-1] + "\t" + p)
PY
while IFS=$'\t' read -r dst src; do
  f="$DL/rb/$dst"; mkdir -p "$(dirname "$f")"
  [ -s "$f" ] || curl -sfL --retry 3 -A fc-humans -o "$f" "$RB$src"
done < "$DL/rb/list.txt"
curl -sfL -A fc-humans -o "$DL/rb/LICENSE.md" "${RB}LICENSE.md"

# 2. Quaternius UAL1 Standard (CC0)
if [ -n "$ZIP" ]; then
  want=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["ual1_sha256"])' "$HERE/assets.json")
  got=$(shasum -a 256 "$ZIP" | cut -c1-64)
  [ "$got" = "$want" ] || echo "⚠ sha256 архива UAL1 другой ($got) — новая версия пака? проверь имена клипов" >&2
  cp "$ZIP" "$DL/ual1/" && (cd "$DL/ual1" && unzip -q -o "$(basename "$ZIP")" -d x)
fi

# 3–5. Blender → атласы → сжатие и манифест
blender -b --factory-startup -P "$HERE/build.py" -- "$DL" "$OUTW"
python3 "$HERE/tex.py" "$OUTW" "$OUTW/out"
node "$HERE/pack.cjs" "$OUTW" "$OUTW/out"
cp "$OUTW/out/"*.glb "$OUTW/out/"*.webp "$OUTW/out/people.json" "$OUT/"
du -sh "$OUT"
