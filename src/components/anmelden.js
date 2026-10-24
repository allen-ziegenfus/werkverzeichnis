import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth } from "./firebaseClient.js";

/**
 * Anmelden über den Link im Fuß, ohne die Seite zu verlassen. Danach zeigt
 * firebaseClient.js die Werkzeugleiste. Wirft, wenn der Browser das Fenster
 * blockiert; schließt man es selbst, passiert nichts.
 */
export async function anmelden() {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") throw e;
  }
}
