#!/usr/bin/env bash
# CI-only Ubuntu bootstrap. Keep Playwright's dependency list authoritative.
set -euo pipefail

apt_config=$(mktemp)
trap 'rm -f "$apt_config"' EXIT
cat > "$apt_config" <<'APT'
Acquire::Retries "0";
Acquire::http::Timeout "20";
Acquire::https::Timeout "20";
APT::Update::Error-Mode "any";
DPkg::Lock::Timeout "30";
APT

for attempt in 1 2; do
  echo "Installing Playwright system dependencies (attempt $attempt/2, limit 180s)"
  # Run timeout as root so it can terminate the entire apt/dpkg process group.
  # APT_CONFIG reaches apt through Playwright's shell without sudo stripping it.
  if sudo -n timeout --kill-after=10s 180s env \
    APT_CONFIG="$apt_config" DEBIAN_FRONTEND=noninteractive \
    "$(command -v node)" node_modules/playwright/cli.js install-deps chromium; then
    exit 0
  else
    status=$?
  fi
  echo "::warning::Playwright Ubuntu package bootstrap attempt $attempt/2 failed (exit $status). Check apt output above for mirror DNS/HTTP failures or package/lock errors; timeout exits are 124/137."
  if [ "$attempt" -lt 2 ]; then
    sleep 10
  fi
done

echo "::error::Playwright system dependencies failed after two bounded attempts. Browser E2E cannot run until Ubuntu package access succeeds."
exit 1
