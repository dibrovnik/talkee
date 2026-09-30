#!/usr/bin/env bash

set -euo pipefail

export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-14.0}"
export TALKEE_TARGET_CPU="${TALKEE_TARGET_CPU:-native}"
export TALKEE_STT_RELEASE=1

bun scripts/build-release.mjs macos
