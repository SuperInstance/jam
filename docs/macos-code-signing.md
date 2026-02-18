# macOS Code Signing & Notarization

## Overview

Jam is distributed outside the Mac App Store via GitHub Releases. This requires:
1. **Code Signing** — with a Developer ID Application certificate
2. **Notarization** — Apple scans the app and issues a ticket so Gatekeeper allows it

Without both, users get "app is damaged" or "unidentified developer" warnings.

## Apple Developer Account

- **Account**: gadshalev7@gmail.com
- **Team ID**: `A28U83VJ4V`
- **Identity**: `Developer ID Application: Gad Shalev (A28U83VJ4V)`
- **App ID**: `dev.jam.app` (configured in electron-builder)

## Certificate Setup (One-time)

### What was created in Apple Developer Portal

| Portal Section | Item | Purpose |
|---|---|---|
| **Certificates** | Developer ID Application (G2 Sub-CA) | Signs the .app binary |
| **Keys** | App Store Connect API Key | Notarization via `notarytool` |

Identifiers, Devices, Profiles, Services — **not needed** for Developer ID distribution.

### Local Setup

```bash
# 1. Generate CSR (already done)
# Keychain Access → Certificate Assistant → Request Certificate from CA
# Save to disk as .certSigningRequest

# 2. Install cert + Apple intermediate
./scripts/codesign-setup.sh install-cert path/to/developerID_application.cer

# 3. Verify identity
./scripts/codesign-setup.sh verify

# 4. Export as .p12 for CI
./scripts/codesign-setup.sh export-p12 jam-cert.p12 <password>

# 5. Base64 for GitHub secret
./scripts/codesign-setup.sh base64-p12 jam-cert.p12
```

### Important: Apple Intermediate Certificate

The Developer ID G2 intermediate cert **must** be installed for the identity to be valid.
The `codesign-setup.sh` script handles this automatically. If doing it manually:

```bash
curl -sL https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer -o /tmp/DeveloperIDG2CA.cer
security import /tmp/DeveloperIDG2CA.cer -k ~/Library/Keychains/login.keychain-db
```

## GitHub Secrets

| Secret | Description | How to get |
|---|---|---|
| `CSC_LINK` | Base64-encoded .p12 certificate | `base64 -i jam-cert.p12 \| pbcopy` |
| `CSC_KEY_PASSWORD` | Password for the .p12 file | Set during export |
| `APPLE_API_KEY` | Base64-encoded .p8 API key | From App Store Connect → Keys |
| `APPLE_API_KEY_ID` | Key ID: `423BZ3U8CJ` | Shown in App Store Connect |
| `APPLE_API_ISSUER` | Issuer ID: `00e87972-423c-4225-90c3-ae2570b9a395` | Top of App Store Connect Keys page |
| `APPLE_TEAM_ID` | Team ID: `A28U83VJ4V` | Apple Developer → Membership |

## How It Works in CI

1. **electron-builder** signs the .app using the .p12 certificate (`CSC_LINK` + `CSC_KEY_PASSWORD`)
2. **electron-builder** notarizes via App Store Connect API key (writes .p8 to disk, calls `notarytool`)
3. **electron-builder** staples the notarization ticket to the .app
4. DMG is created from the signed + notarized .app

### Entitlements

Located at `apps/desktop/build/entitlements.mac.plist`:
- `com.apple.security.cs.allow-jit` — needed for Electron/V8
- `com.apple.security.cs.allow-unsigned-executable-memory` — needed for Electron/V8
- `com.apple.security.cs.disable-library-validation` — needed for node-pty native module
- `com.apple.security.network.client` — API calls to AI providers
- `com.apple.security.network.server` — Electron dev server
- `com.apple.security.device.audio-input` — Voice/microphone access

## Local Signing & Testing

```bash
# Build + sign locally
./scripts/codesign-setup.sh sign-local

# Verify a signed app
codesign --verify --deep --strict apps/desktop/release/mac-arm64/Jam.app
spctl --assess --type execute apps/desktop/release/mac-arm64/Jam.app
```

## Troubleshooting

### "0 valid identities found"
Missing the Apple intermediate certificate. Run:
```bash
./scripts/codesign-setup.sh install-cert path/to/developerID_application.cer
```

### Certificate not pairing with private key
The private key is created when generating the CSR. It must be in the **same keychain** as the certificate. Check Keychain Access → My Certificates.

### "app is damaged and can't be opened"
The app isn't notarized. Ensure the `APPLE_API_*` secrets are set in GitHub Actions.

### Duplicate certificates in Keychain
Delete all, then re-import once with the setup script.
