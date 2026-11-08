import { doc, getDoc, getFirestore } from "firebase/firestore/lite";
import { app, DATENBANK, KUENSTLER } from "./firebaseClient.js";

/**
 * Firestore Lite liest per REST, am Listen-Stream vorbei. Im vollen SDK liest
 * auch getDocFromServer über ihn und hinkt mit Long Polling (firebaseClient.js,
 * #121) so hinterher wie ein Listener (#279). Nur zum Lesen von Dokumenten,
 * die andere schreiben (die Bildfunktion); eigene Schreibvorgänge kommen über den Stream.
 */
const kuenstler = doc(getFirestore(app, DATENBANK), "artists", KUENSTLER);

/** Das Dokument unter artists/<k>/<pfad…>, frisch vom Server. */
export const frischLesen = (...pfad) => getDoc(doc(kuenstler, ...pfad));
