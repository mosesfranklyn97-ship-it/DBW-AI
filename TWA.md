# Trusted Web Activity

A TWA puts the site in a real Chrome WebView with a native Android shell, so it
installs like an app from the Play Store while still being the same deployment
as the website.

## Why TWA and not Capacitor

DBW AI identifies anonymous visitors by a `dbw-workspace` cookie and signs people
in with Supabase sessions held in cookies. Both live in the browser profile. A
TWA shares the WebView's cookie store with the site, so an existing session, an
existing anonymous workspace and anything already in the tab keep working.
Capacitor would give the app its own storage and its own origin, which means a
second session model to maintain and a sign-in prompt for people who were
already signed in on the web.

It is also much smaller: no bundled WebView, no native bridge, no second copy
of the app's JavaScript.

## Status

Configuration only. **Nothing has been built or installed.** This machine has no
Java runtime, no Android SDK and no device, so the following are outstanding:

- the generated `android/` project
- the upload keystore
- the real signing fingerprint in `assetlinks.json`
- Play signing, an AAB upload and a device test

Until the fingerprint is set, `public/.well-known/assetlinks.json` contains
placeholders. That fails closed, so nothing is insecure, but a TWA build will
refuse to launch until it is replaced.

## Files

| File | Purpose |
| --- | --- |
| `twa-manifest.json` | Bubblewrap input. Package ID, host, colours, icon. |
| `public/.well-known/assetlinks.json` | Digital Asset Links proof. Generated at build time, not hand-edited. |
| `scripts/write-assetlinks.mjs` | Writes the file above from the environment. |

## Before the first build

### 1. Install the toolchain

```bash
# JDK 17+ and the Android SDK (platform-tools, platforms;android-34, build-tools)
npm i -D @bubblewrap/cli
```

### 2. Choose a package ID and keep it

`ai.dbw.app` is used in `twa-manifest.json`. Once an app is published the ID is
permanent: changing it means a new Play listing, and any install of the old one
stops verifying against this site.

If you want a different ID, change it in `twa-manifest.json` and set the same
value in `TWA_PACKAGE_NAME`.

### 3. Create the upload keystore and record its fingerprint

```bash
keytool -genkey -v -keystore upload.keystore -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000

keytool -list -v -keystore upload.keystore -alias upload | grep SHA256
```

Back this keystore up somewhere that is not this laptop. Losing it means losing
the ability to update the listing; letting anyone else hold it means anyone else
can ship an "update" to the app.

The `SHA256` line is the fingerprint. Set it, plus the package name:

```bash
# .env.local, and the same two names in the Vercel project settings
TWA_PACKAGE_NAME=ai.dbw.app
TWA_SHA256_CERT_FINGERPRINTS=AB:CD:EF:...
```

`npm run assets:assetlinks` runs automatically on `dev` and `build`, so the file
regenerates with the real values. Colons are optional in the env var; the script
normalises the format.

Never prefix the fingerprint with `NEXT_PUBLIC_`. Those values are inlined into
the client bundle, and a signing fingerprint does not belong in shipped
JavaScript.

### 4. Verify the link before building anything

Deploy, then check the served file:

```bash
curl -s https://dbw-ai.vercel.app/.well-known/assetlinks.json
```

It must show the real package name and a fingerprint that is not a placeholder.
Android checks this file itself at launch, and it is worth confirming with
`adb shell am start -a android.intent.action.VIEW -d <url>` before spending time
on a release build.

### 5. Build

```bash
npx @bubblewrap/cli init --manifest twa-manifest.json
npx @bubblewrap/cli build
```

`build` produces an AAB for the Play Console. Local testing uses `npx
@bubblewrap/cli update --manifest twa-manifest.json`, which prints an install
command for a connected device.

### 6. Play Console

Create the app with the same package name, upload the AAB, and let Play App
Signing generate its own signing key. The assetlinks entry must list the
fingerprint of the key that actually signs the installed APK, which after Play
App Signing is the **app signing key**, not the upload key. Find it under
Release > Setup > App signing > App integrity.

Add both fingerprints while both are relevant. A Play-signed install is what
users get, but sideloaded debug builds sign with the upload key, and listing
only one of the two makes one of them fail to launch.

## Ongoing

Changing anything in `twa-manifest.json` means re-running `build`. The Play
listing is versioned separately from the site: the web app can ship as often as
it likes and the shell picks it up, because it loads the live origin.
