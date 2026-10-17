#!/bin/sh
# Publish each library whose version isn't on npm yet (in dependency order: the API first).
# `pnpm publish` turns `workspace:^` into the version it points at. Needs `npm login` (or an
# NPM_TOKEN in CI).
set -e
cd "$(dirname "$0")/.."
pnpm -r build
for lib in libs/api libs/ui; do
  name=$(node -p "require('./$lib/package.json').name")
  version=$(node -p "require('./$lib/package.json').version")
  published=$(npm view "$name@$version" version 2>/dev/null || true)
  if [ "$published" = "$version" ]; then
    echo "$name@$version is already published"
  else
    echo "Publishing $name@$version"
    (cd "$lib" && pnpm publish --access public --no-git-checks)
  fi
done
