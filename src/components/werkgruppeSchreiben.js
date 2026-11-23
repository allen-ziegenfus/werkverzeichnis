import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { db, KUENSTLER } from "./firebaseClient.js";

/** Was der Verlauf je Werkgruppe festhält, wie werkgruppenFassung() in firestore.rules. */
export const werkgruppenFassung = d => d && ({ titel: d.titel, kurztitel: d.kurztitel ?? null,
  reihenfolge: d.reihenfolge, cover: d.cover ?? null });

/**
 * Felder einer Werkgruppe ändern, mit Eintrag in `werkgruppenverlauf` (#106), in
 * einer Transaktion auf dem Stand des Servers. Für die Seite Werkgruppen und
 * das hochgeladene Titelbild (#380).
 */
export async function werkgruppeAendern(id, aenderungen, ich) {
  const ref = doc(db, "artists", KUENSTLER, "werkgruppen", id);
  const verlauf = collection(db, "artists", KUENSTLER, "werkgruppenverlauf");
  await runTransaction(db, async tx => {
    const jetzt = (await tx.get(ref)).data();
    const eintrag = doc(verlauf);
    tx.set(eintrag, { werkgruppe: id, by: ich, at: serverTimestamp(),
      vorher: werkgruppenFassung(jetzt), nachher: werkgruppenFassung({ ...jetzt, ...aenderungen }) });
    tx.update(ref, { ...aenderungen, updatedAt: serverTimestamp(), lastChange: eintrag.id });
  });
}
