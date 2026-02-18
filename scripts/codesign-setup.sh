#!/usr/bin/env bash
# =============================================================================
# macOS Code Signing Setup for Jam
# =============================================================================
# This script helps set up code signing for local development and CI.
#
# Prerequisites:
#   - Apple Developer account (developer.apple.com)
#   - Developer ID Application certificate (.cer) downloaded from portal
#   - Certificate Signing Request (.certSigningRequest) generated from Keychain Access
#
# Usage:
#   ./scripts/codesign-setup.sh install-cert <path-to-.cer>
#   ./scripts/codesign-setup.sh export-p12 <output-path> <password>
#   ./scripts/codesign-setup.sh base64-p12 <path-to-.p12>
#   ./scripts/codesign-setup.sh verify
#   ./scripts/codesign-setup.sh sign-local
# =============================================================================

set -euo pipefail

TEAM_ID="A28U83VJ4V"
IDENTITY="Developer ID Application: Gad Shalev ($TEAM_ID)"
INTERMEDIATE_URL="https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

cmd_install_cert() {
  local cer_path="${1:-}"
  [[ -z "$cer_path" ]] && error "Usage: $0 install-cert <path-to-.cer>"
  [[ ! -f "$cer_path" ]] && error "File not found: $cer_path"

  info "Installing Apple Developer ID G2 intermediate certificate..."
  local tmp_intermediate="/tmp/DeveloperIDG2CA.cer"
  curl -sL "$INTERMEDIATE_URL" -o "$tmp_intermediate"
  security import "$tmp_intermediate" -k ~/Library/Keychains/login.keychain-db 2>/dev/null || true
  rm -f "$tmp_intermediate"

  info "Installing Developer ID Application certificate..."
  security import "$cer_path" -k ~/Library/Keychains/login.keychain-db

  info "Verifying..."
  local count
  count=$(security find-identity -v -p codesigning | grep -c "Developer ID Application" || true)
  if [[ "$count" -ge 1 ]]; then
    info "Certificate installed and paired with private key."
    security find-identity -v -p codesigning | grep "Developer ID Application"
  else
    warn "Certificate imported but no valid identity found."
    warn "Make sure the private key from your CSR is in the login keychain."
    warn "Open Keychain Access > My Certificates to verify."
  fi
}

cmd_export_p12() {
  local output="${1:-jam-cert.p12}"
  local password="${2:-}"
  [[ -z "$password" ]] && error "Usage: $0 export-p12 <output-path> <password>"

  info "Exporting signing identity as .p12..."
  security export \
    -k ~/Library/Keychains/login.keychain-db \
    -t identities \
    -f pkcs12 \
    -P "$password" \
    -o "$output"

  info "Exported to $output"
}

cmd_base64_p12() {
  local p12_path="${1:-}"
  [[ -z "$p12_path" ]] && error "Usage: $0 base64-p12 <path-to-.p12>"
  [[ ! -f "$p12_path" ]] && error "File not found: $p12_path"

  info "Base64 encoding .p12 (copied to clipboard)..."
  base64 -i "$p12_path" | pbcopy
  local size
  size=$(base64 -i "$p12_path" | wc -c | tr -d ' ')
  info "Copied to clipboard ($size chars). Paste as CSC_LINK GitHub secret."
}

cmd_verify() {
  info "Checking code signing identities..."
  echo ""
  security find-identity -v -p codesigning
  echo ""

  local count
  count=$(security find-identity -v -p codesigning | grep -c "Developer ID Application" || true)
  if [[ "$count" -ge 1 ]]; then
    info "Found $count Developer ID Application identity/identities."
  else
    warn "No Developer ID Application identity found."
    warn "Run: $0 install-cert <path-to-.cer>"
  fi
}

cmd_sign_local() {
  info "Building and signing locally..."
  local app_path
  app_path=$(find apps/desktop/release -name "*.app" -maxdepth 2 2>/dev/null | head -1)

  if [[ -z "$app_path" ]]; then
    info "No .app found. Building first..."
    yarn workspace @jam/desktop electron:build
    app_path=$(find apps/desktop/release -name "*.app" -maxdepth 2 | head -1)
  fi

  [[ -z "$app_path" ]] && error "No .app found after build"

  info "Signing $app_path..."
  codesign --force --deep --options runtime --sign "$IDENTITY" "$app_path"
  info "Verifying signature..."
  codesign --verify --deep --strict "$app_path"
  spctl --assess --type execute "$app_path" 2>&1 || warn "Gatekeeper assessment may require notarization"
  info "Done. App signed with: $IDENTITY"
}

# --- Main ---
case "${1:-help}" in
  install-cert) shift; cmd_install_cert "$@" ;;
  export-p12)   shift; cmd_export_p12 "$@" ;;
  base64-p12)   shift; cmd_base64_p12 "$@" ;;
  verify)       cmd_verify ;;
  sign-local)   cmd_sign_local ;;
  *)
    echo "Usage: $0 <command> [args]"
    echo ""
    echo "Commands:"
    echo "  install-cert <.cer>           Install Developer ID cert + Apple intermediate"
    echo "  export-p12 <output> <pass>    Export signing identity as .p12"
    echo "  base64-p12 <.p12>             Base64 encode .p12 and copy to clipboard"
    echo "  verify                        Check installed signing identities"
    echo "  sign-local                    Build and sign the app locally"
    echo ""
    echo "Team ID: $TEAM_ID"
    echo "Identity: $IDENTITY"
    ;;
esac
