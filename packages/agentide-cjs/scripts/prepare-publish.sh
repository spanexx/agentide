#!/usr/bin/env bash
# prepare-publish.sh — run by pnpm publish (prepublishOnly hook).
# Bumps patch version + flattens workspace:* deps to semver.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

current=$(python3 -c 'import json; print(json.load(open("package.json"))["version"])')
parts=(${current//./ })
patch=$((parts[2] + 1))
bumped="${parts[0]}.${parts[1]}.${patch}"
OWN_NAME=$(python3 -c 'import json; print(json.load(open("package.json"))["name"])')

python3 - <<EOF
import json
p = json.load(open("package.json"))
p["version"] = "$bumped"
new_deps = {}
for k, v in p.get("dependencies", {}).items():
    new_deps[k] = ("^$bumped" if v == "workspace:*" else v)
p["dependencies"] = new_deps
new_dev = {}
for k, v in p.get("devDependencies", {}).items():
    new_dev[k] = ("^$bumped" if v == "workspace:*" else v)
p["devDependencies"] = new_dev
with open("package.json", "w") as f:
    json.dump(p, f, indent=2)
    f.write("\n")
EOF

# Mirror + compile
bash scripts/build.sh

echo "[prepare-publish] $OWN_NAME bumped to $bumped + workspace refs flattened + dist built."
