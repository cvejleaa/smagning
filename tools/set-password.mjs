// Sætter en ny adgangskode for en bruger via Firebase Admin SDK.
// Bruges af GitHub Actions-workflowet "Sæt adgangskode for bruger" (workflow_dispatch),
// hvor GOOGLE_APPLICATION_CREDENTIALS peger på servicekontoens nøgle.
// Lokalt mod emulatoren: FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node tools/set-password.mjs bo@test.dk nykode123
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const [email, password] = process.argv.slice(2);
if (!email || !password) { console.error("Brug: node tools/set-password.mjs <e-mail> <ny adgangskode>"); process.exit(2); }
if (password.length < 6) { console.error("Adgangskoden skal være mindst 6 tegn."); process.exit(2); }

const options = { projectId: process.env.GCLOUD_PROJECT || "smagning-286ed" };
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) options.credential = applicationDefault();
initializeApp(options);
const auth = getAuth();
try {
  const user = await auth.getUserByEmail(email.trim());
  await auth.updateUser(user.uid, { password });
  // Log alle andre enheder ud, så den gamle adgangskode ikke længere giver adgang
  await auth.revokeRefreshTokens(user.uid);
  console.log(`Ny adgangskode sat for ${user.email} (${user.displayName || "uden navn"}). Brugeren logges ud på alle enheder.`);
} catch (e) {
  if (e?.code === "auth/user-not-found") { console.error(`Ingen bruger med e-mailen ${email}.`); process.exit(1); }
  console.error("Fejl:", e?.message || e); process.exit(1);
}
