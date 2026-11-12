#!/bin/zsh
cd -- "${0:A:h}" || exit 1
# Prefer a normal Node installation, then the runtime already used for this project.
if [[ -x /opt/homebrew/bin/node ]]; then
  export PATH="/opt/homebrew/bin:$PATH"
elif [[ -x /usr/local/bin/node ]]; then
  export PATH="/usr/local/bin:$PATH"
elif [[ -x /Users/jrh/Documents/Codex/2026-11-11/i-ha/work/website-validation/node-v22.23.5-darwin-arm64/bin/node ]]; then
  export PATH="/Users/jrh/Documents/Codex/2026-11-11/i-ha/work/website-validation/node-v22.23.5-darwin-arm64/bin:$PATH"
fi
if ! command -v node >/dev/null; then
  echo 'Node.js is needed to open the photo manager. Install Node.js 22, then reopen this file.'
  read '?Press Return to close. '; exit 1
fi
if [[ ! -d node_modules ]]; then
  echo 'Installing this project’s dependencies…'
  npm ci || { read '?Installation failed. Press Return to close. '; exit 1; }
fi
node scripts/photo-manager/server.mjs
manager_status=$?
if (( manager_status != 0 && manager_status != 130 )); then
  read '?Could not open the manager. Press Return to close. '
  exit $manager_status
fi
