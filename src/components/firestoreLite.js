import { doc, getDoc, getFirestore } from "firebase/firestore/lite";
import { app, DATENBANK, KUENSTLER } from "./firebaseClient.js";

/**
 * Firestore Lite liest per REST, am Listen-Stream vorbei. Im vollen SDK liest
 * auch getDocFromServer über ihn und hinkt mit Long Polling (firebaseClient.js,
 * #121) so hinterher wie ein Listener (#279). Hängt schon ein Listener am
 * Dokument, antwortet getDocFromServer sofort mit dessen altem Stand, auch
 * direkt nach einer eigenen Transaktion (#287).
 */
const lite = getFirestore(app, DATENBANK);
const kuenstler = doc(lite, "artists", KUENSTLER);

/** Das Dokument unter artists/<k>/<pfad…>, frisch vom Server. */
export const frischLesen = (...pfad) => getDoc(doc(kuenstler, ...pfad));

/** Ein Dokument des vollen SDK (DocumentReference), frisch vom Server. */
export const vomServer = ref => getDoc(doc(lite, ref.path));
