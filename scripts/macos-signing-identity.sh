# Stable macOS code-signing identity for Talkee rebuilds.
#
# Ad-hoc signatures (codesign --sign -) bind TCC to a CDHash that changes on
# every rebuild, so Microphone, Accessibility, and Input Monitoring are asked
# again. A certificate that stays in the login keychain keeps the same
# designated requirement across builds.
#
# Source this file, then call talkee_signing_identity. It prints an identity
# for `codesign --sign` and never prints "-" when a certificate was created.

talkee_signing_identity() {
  if [[ -n "${TALKEE_DEV_SIGNING_IDENTITY:-}" ]]; then
    printf '%s\n' "${TALKEE_DEV_SIGNING_IDENTITY}"
    return 0
  fi
  if [[ -n "${APPLE_SIGNING_IDENTITY:-}" && "${APPLE_SIGNING_IDENTITY}" != "-" ]]; then
    printf '%s\n' "${APPLE_SIGNING_IDENTITY}"
    return 0
  fi

  local apple
  apple="$(
    /usr/bin/security find-identity -v -p codesigning 2>/dev/null |
      /usr/bin/awk '/"Apple Development:/{print $2; exit}'
  )"
  if [[ -n "${apple}" ]]; then
    printf '%s\n' "${apple}"
    return 0
  fi

  local name="Talkee Development"
  local existing
  existing="$(
    /usr/bin/security find-identity -v -p codesigning 2>/dev/null |
      /usr/bin/awk -v cert="${name}" 'index($0, cert) { print $2; exit }'
  )"
  if [[ -n "${existing}" ]]; then
    printf '%s\n' "${existing}"
    return 0
  fi

  if /usr/bin/security find-certificate -c "${name}" >/dev/null 2>&1; then
    printf '%s\n' "${name}"
    return 0
  fi

  local tmp
  tmp="$(/usr/bin/mktemp -d)"
  if ! /usr/bin/openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
    -keyout "${tmp}/key.pem" \
    -out "${tmp}/cert.pem" \
    -subj "/CN=${name}" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,digitalSignature,keyCertSign" \
    -addext "extendedKeyUsage=critical,codeSigning" >/dev/null 2>&1; then
    echo "Talkee: could not create a stable signing certificate; permissions may reset after rebuilds" >&2
    rm -rf "${tmp}"
    printf '%s\n' "-"
    return 0
  fi

  if ! /usr/bin/openssl pkcs12 -export \
    -out "${tmp}/cert.p12" \
    -inkey "${tmp}/key.pem" \
    -in "${tmp}/cert.pem" \
    -name "${name}" \
    -passout pass:talkee >/dev/null 2>&1; then
    echo "Talkee: could not package the signing certificate" >&2
    rm -rf "${tmp}"
    printf '%s\n' "-"
    return 0
  fi

  if ! /usr/bin/security import "${tmp}/cert.p12" \
    -k "${HOME}/Library/Keychains/login.keychain-db" \
    -P talkee \
    -A \
    -T /usr/bin/codesign \
    -T /usr/bin/security >/dev/null 2>&1; then
    echo "Talkee: could not import the signing certificate into the login keychain" >&2
    rm -rf "${tmp}"
    printf '%s\n' "-"
    return 0
  fi

  rm -rf "${tmp}"
  echo "Talkee: created stable signing identity \"${name}\"." >&2
  echo "Talkee: if macOS asks to allow codesign to use this key, choose Always Allow once." >&2
  printf '%s\n' "${name}"
}
