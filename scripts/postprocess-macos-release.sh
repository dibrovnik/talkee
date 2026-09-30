#!/usr/bin/env bash

set -euo pipefail

VERSION="${1:?usage: postprocess-macos-release.sh <version>}"
APP_NAME="Talkee"
APP_IDENTIFIER="com.trixter.talkee"
BUILD_ROOT="${BUILD_ROOT:-/tmp/talkee-target/release/bundle}"
APP_PATH="${BUILD_ROOT}/macos/${APP_NAME}.app"
DMG_PATH="${BUILD_ROOT}/dmg/${APP_NAME}_${VERSION}_aarch64.dmg"
STAGING_DIR="${BUILD_ROOT}/macos/dmg-staging"
DMG_DIR="$(dirname "${DMG_PATH}")"

if [[ ! -d "${APP_PATH}" ]]; then
  echo "App bundle not found at ${APP_PATH}" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/macos-signing-identity.sh"
SIGNING_IDENTITY="$(talkee_signing_identity)"
if [[ "${SIGNING_IDENTITY}" == "-" ]]; then
  echo "Ad-hoc signing ${APP_PATH}; macOS permissions may reset after the next rebuild" >&2
else
  echo "Signing ${APP_PATH} with stable identity ${SIGNING_IDENTITY}"
fi
codesign --force --deep --sign "${SIGNING_IDENTITY}" --identifier "${APP_IDENTIFIER}" "${APP_PATH}"

echo "Rebuilding DMG from signed app bundle"
rm -rf "${STAGING_DIR}"
mkdir -p "${STAGING_DIR}"
mkdir -p "${DMG_DIR}"
cp -R "${APP_PATH}" "${STAGING_DIR}/"
ln -s /Applications "${STAGING_DIR}/Applications"
rm -f "${DMG_PATH}"

hdiutil create \
  -volname "${APP_NAME}" \
  -srcfolder "${STAGING_DIR}" \
  -ov \
  -format UDZO \
  "${DMG_PATH}"

echo "Post-processing complete"
codesign -dv --verbose=4 "${APP_PATH}" 2>&1 | sed 's/^/codesign: /'
