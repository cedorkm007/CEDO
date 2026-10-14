// scripts/generate-vapid-keys.mjs — makes the pair of keys web push needs ("VAPID keys"). Nothing is sent anywhere; run it on your own computer:
//
//     node scripts/generate-vapid-keys.mjs
//
// It prints a PUBLIC key (goes in the website's environment as VITE_VAPID_PUBLIC_KEY, safe to be seen) and a PRIVATE key (a secret: only
// the push-sender function gets it, never the website, never git). Make the pair ONCE and keep it: if it changes, every device has to
// turn notifications on again.
import crypto from "node:crypto";

const b64url = buf => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const ecdh = crypto.createECDH("prime256v1");
ecdh.generateKeys();
const publicKey = b64url(ecdh.getPublicKey());      // 65 bytes, uncompressed point
const privateKey = b64url(ecdh.getPrivateKey());    // 32 bytes

console.log("\nVAPID keys (made just now on this computer)\n");
console.log("PUBLIC  (website setting  VITE_VAPID_PUBLIC_KEY, and function secret VAPID_PUBLIC_KEY):");
console.log("  " + publicKey + "\n");
console.log("PRIVATE (function secret VAPID_PRIVATE_KEY only — keep it secret):");
console.log("  " + privateKey + "\n");
console.log("Then:  supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:<an office address> PUSH_SENDER_SECRET=<a long random text>");
console.log("       supabase functions deploy push-sender --no-verify-jwt\n");
