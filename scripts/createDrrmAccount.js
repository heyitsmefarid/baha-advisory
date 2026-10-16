/**
 * One-off admin script for creating DRRM staff accounts — run locally,
 * never deployed. Keeps Bahadvisory entirely on Firebase's free Spark
 * plan (Cloud Functions import Blaze; this script doesn't).
 *
 * Setup (one time):
 *   1. Firebase Console → Project Settings → Service Accounts →
 *      "Generate new private key" → save as serviceAccountKey.json in the
 *      project root. This file is already in .gitignore — never commit it.
 *   2. npm install firebase-admin   (at the project root, not functions/)
 *
 * Usage:
 *   node scripts/createDrrmAccount.js --name "Full Name" --email user@example.com --role drrm_editor --area "Calapan City"
 *
 * Run it once per new DRRM editor/admin. It:
 *   - creates the Firebase Auth user with a random temp password
 *   - sets the role/assignedArea custom claims (the ONLY place these can
 *     be set — the client SDK cannot set its own claims)
 *   - writes the directory doc to users/{uid} so it shows up in the
 *     admin Users page
 *   - prints a password-reset link to send to the person so they set their own password
 */

import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let serviceAccount;
try {
  serviceAccount = require(path.join(__dirname, "..", "serviceAccountKey.json"));
} catch {
  console.error(
    "\nMissing serviceAccountKey.json in the project root.\n" +
      "Firebase Console → Project Settings → Service Accounts → Generate new private key.\n"
  );
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const auth = getAuth();
const firestore = getFirestore();

async function createDrrmAccount({ name, email, role, assignedArea }) {
  if (!["drrm_editor", "admin"].includes(role)) {
    throw new Error(`role must be "drrm_editor" or "admin", got "${role}"`);
  }

  const tempPassword = Math.random().toString(36).slice(-10) + "A1!";

  const userRecord = await auth.createUser({
    email,
    password: tempPassword,
    displayName: name,
  });

  await auth.setCustomUserClaims(userRecord.uid, { role, assignedArea });

  await firestore.doc(`users/${userRecord.uid}`).set({
    name,
    email,
    role,
    assignedArea,
    active: true,
  });

  let resetLink = null;
  try {
    resetLink = await auth.generatePasswordResetLink(email);
  } catch (e) {
    console.warn("Could not generate a password reset link:", e.message);
  }

  console.log(`\nCreated ${role} account for ${email}`);
  console.log(`  uid: ${userRecord.uid}`);
  console.log(`  temp password: ${tempPassword}  (share securely, or use the reset link below instead)`);
  if (resetLink) console.log(`  password reset link: ${resetLink}`);
  console.log("");
}

// ---------------------------------------------------------------------
// Pass the account details on the command line (previously they were
// edited into this file):
//   node scripts/createDrrmAccount.js --name "Juan dela Cruz" --email juan@lgu.gov.ph --role drrm_editor --area "Calapan City"
// For the multi-tenant roles (lgu_admin, business_admin, super_admin, ...)
// use `npm run create-account` (scripts/createAccount.ts) instead.
// ---------------------------------------------------------------------
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const account = {
  name: arg("name"),
  email: arg("email"),
  role: arg("role") ?? "drrm_editor",
  assignedArea: arg("area"),
};

if (!account.name || !account.email || !account.assignedArea) {
  console.error(
    '\nUsage: node scripts/createDrrmAccount.js --name "Full Name" --email user@example.com --role drrm_editor|admin --area "Area"\n'
  );
  process.exit(1);
}

createDrrmAccount(account)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nFailed to create account:", err.message);
    process.exit(1);
  });