import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { doc, getFirestore } from "firebase/firestore";

/**
 * Die Firebase-App der Verwaltung und des Editors. Projekt, Schlüssel und
 * Künstler:in setzt der Build (cloudbuild.yaml, aus dem Trigger der Seite, #109);
 * lokal aus .env. Der Schlüssel ist absichtlich öffentlich.
 */
const PROJEKT = import.meta.env.PUBLIC_FIREBASE_PROJECT;
export const app = initializeApp({
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: `${PROJEKT}.firebaseapp.com`,
  projectId: PROJEKT,
});
export const auth = getAuth(app);
export const db = getFirestore(app, "werkverzeichnis");
export const KUENSTLER = import.meta.env.PUBLIC_KUENSTLER;
export const kuenstler = doc(db, "artists", KUENSTLER);

// Merkt sich, ob auf diesem Gerät jemand angemeldet ist; nur dann lädt das
// Layout die Werkzeugleiste. Wer sich erst auf dieser Seite anmeldet, bekommt
// sie sofort.
onAuthStateChanged(auth, n => {
  try {
    if (n) localStorage.setItem("bearbeiter", "1");
    else localStorage.removeItem("bearbeiter");
  } catch {}
  const link = document.getElementById("anmelden");
  if (link) link.hidden = !!n;
  const el = document.getElementById("werkzeugleiste");
  if (n && el) import("./Werkzeugleiste.jsx").then(m => m.anzeigen(el));
});
