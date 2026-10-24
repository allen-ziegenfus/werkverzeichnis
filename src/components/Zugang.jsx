import { useEffect, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup } from "firebase/auth";
import { getDoc } from "firebase/firestore";
import { darf } from "../werkverzeichnis/permissions.js";
import { auth, kuenstler } from "./firebaseClient.js";

/**
 * Wer angemeldet ist und was er bei der Künstler:in dieser Website darf.
 * `nutzer`: undefined solange unbekannt, sonst null oder der Firebase-Nutzer.
 * `wer`: undefined solange unbekannt, null ohne Rolle, sonst { superAdmin, rolle }
 * für darf() aus permissions.js. `fehler`: Das Laden scheiterte (etwa offline);
 * `erneut()` versucht es noch einmal.
 */
export function useZugang() {
  const [nutzer, setNutzer] = useState(undefined);
  const [wer, setWer] = useState();
  const [fehler, setFehler] = useState();
  const [versuch, setVersuch] = useState(0);

  useEffect(() => onAuthStateChanged(auth, setNutzer), []);

  useEffect(() => {
    setWer(undefined);
    setFehler(undefined);
    if (!nutzer) return;
    let aktuell = true;
    (async () => {
      const superAdmin = (await nutzer.getIdTokenResult()).claims.superAdmin === true;
      let rolle;
      try {
        rolle = (await getDoc(kuenstler)).get("roles")?.[nutzer.email];
      } catch (e) {
        // Ohne Rolle darf man das Dokument nicht lesen; alles andere ist ein Fehler.
        if (e.code !== "permission-denied") throw e;
      }
      if (aktuell) setWer(superAdmin || rolle ? { superAdmin, rolle } : null);
    })().catch(e => { if (aktuell) setFehler(e.message); });
    return () => { aktuell = false; };
  }, [nutzer, versuch]);

  return { nutzer, wer, fehler, erneut: () => setVersuch(v => v + 1) };
}

const knopf = "px-3 py-1 border rounded disabled:opacity-40";

/**
 * Rahmen jeder Verwaltungsseite: Anmeldung, dann `kinder({ nutzer, wer })`, wenn
 * `berechtigung` erlaubt ist. Durchgesetzt wird das von firestore.rules; dies
 * blendet nur aus, was man ohnehin nicht dürfte.
 */
export default function Zugang({ berechtigung = "lesen", kinder }) {
  const { nutzer, wer, fehler: ladefehler, erneut } = useZugang();
  const [fehler, setFehler] = useState();

  if (nutzer && ladefehler) return (
    <div className="space-y-2">
      <p className="text-red-700">Anmeldung konnte nicht geprüft werden: {ladefehler}</p>
      <button className={knopf} onClick={erneut}>Erneut versuchen</button>
    </div>
  );

  if (nutzer === undefined || (nutzer && wer === undefined)) return <p>…</p>;

  if (!nutzer) return (
    <div className="space-y-2">
      {fehler && <p className="text-red-700">{fehler}</p>}
      <button className={knopf} onClick={() =>
        signInWithPopup(auth, new GoogleAuthProvider()).catch(e => setFehler(e.message))}>
        Mit Google anmelden
      </button>
    </div>
  );

  if (!wer || !darf(wer, berechtigung)) return (
    <p>Kein Zugriff: {nutzer.email} darf das bei dieser Website nicht.</p>
  );

  return kinder({ nutzer, wer });
}
