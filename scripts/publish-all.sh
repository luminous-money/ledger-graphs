#!/bin/sh
# Publish each library whose version isn't on npm yet (in dependency order: the API first).
# `pnpm pack` turns `workspace:^` into the version it points at; `npm publish` sends the tarball,
# so CI can use npm's trusted publishing (OIDC, with provenance). By hand, it needs `npm login`.
set -e
cd "$(dirname "$0")/.."
pnpm -r build
packed=$(mktemp -d)
trap 'rm -rf "$packed"' EXIT
for lib in libs/api libs/ui; do
  name=$(node -p "require('./$lib/package.json').name")
  version=$(node -p "require('./$lib/package.json').version")
  published=$(npm view "$name@$version" version 2>/dev/null || true)
  if [ "$published" = "$version" ]; then
    echo "$name@$version is already published"
  else
    echo "Publishing $name@$version"
    (cd "$lib" && pnpm pack --pack-destination "$packed" >/dev/null)
    npm publish "$packed/$(echo "$name" | sed 's/^@//; s/\//-/')-$version.tgz" --access public
  fi
done
