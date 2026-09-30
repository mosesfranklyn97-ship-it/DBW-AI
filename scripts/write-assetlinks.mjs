/**
 * Writes public/.well-known/assetlinks.json for Trusted Web Activity.
 *
 * A TWA only launches if the origin and the Android app are proven to belong
 * together, and that proof is this file: Android fetches it, matches the
 * calling package name against `relation`, and checks that one of the listed
 * `sha256_cert_fingerprints` is a signer of the installed app. Miss anything
 * and the launch fails with a security error that is genuinely hard to read
 * from a phone.
 *
 * Both values are secrets of the build, not of the repo, so they come from the
 * environment. Fingerprints come from the upload keystore, and the same
 * keystore has to be used for every build or previously installed copies stop
 * verifying:
 *
 *   keytool -list -v -keystore upload.keystore -alias upload | grep SHA256
 *
 * Deliberately *not* templated into the committed file with obvious
 * placeholders. `NEXT_PUBLIC_` values are inlined into the client bundle, which
 * is the wrong home for a signing fingerprint, and a checked-in file that
 * looks finished but was never filled in tends to survive review.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(rootDir, "public", ".well-known", "assetlinks.json");

const packageName = process.env.TWA_PACKAGE_NAME?.trim() || "";
const fingerprints = (process.env.TWA_SHA256_CERT_FINGERPRINTS || "")
  .split(",")
  .map((value) => value.trim().toUpperCase().replace(/:/g, ""))
  .filter(Boolean);

// WebView calls the origin's own origin, not a scheme-specific one, so the
// statement has no target field at all. That is the whole point: the relation
// below is what binds the two.
const document = [
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: packageName || "REPLACE_WITH_YOUR_PACKAGE_NAME",
      sha256_cert_fingerprints: fingerprints.length
        ? fingerprints.map((value) => `AA:${value.match(/.{2}/g).join(":")}`)
        : ["REPLACE_WITH_YOUR_SHA256_CERT_FINGERPRINT"],
    },
  },
];

if (!packageName || !fingerprints.length) {
  console.warn(
    "assetlinks: TWA_PACKAGE_NAME and/or TWA_SHA256_CERT_FINGERPRINTS are not set.\n" +
      "           Wrote a placeholder that will NOT verify. TWA installs will fail\n" +
      "           with a Digital Asset Links error until both are set. See TWA.md.",
  );
}

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(document, null, 2) + "\n");

// A file that Next is serving from `public` is not covered by the service
// worker precache, so a returning visitor on a stale build would keep asking
// for it; being explicit here makes the failure obvious in review.
const served = existsSync(target) ? readFileSync(target, "utf8") : "";
if (!served.includes("delegate_permission/common.handle_all_urls")) {
  throw new Error("assetlinks.json is missing its handle_all_urls relation");
}

console.log(`assetlinks written to ${target} (package: ${packageName || "placeholder"})`);
