#!/bin/sh
# Release a version: set it on every library, commit, tag v<version>, and push. The tag runs the
# Publish workflow, which publishes to npm. Usage: pnpm release 0.2.0
set -e
cd "$(dirname "$0")/.."
version=${1:?usage: pnpm release <version>}
if [ -n "$(git status --porcelain)" ]; then
  echo "The working tree has changes: commit or stash them first" >&2
  exit 1
fi
for lib in libs/*/; do
  (cd "$lib" && npm pkg set version="$version")
done
git commit -qam "v$version"
git tag "v$version"
git push origin HEAD "v$version"
