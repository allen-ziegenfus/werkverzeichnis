import { useEffect, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup } from "firebase/auth";
import { getDoc } from "firebase/firestore";
import { darf } from "../werkverzeichnis/permissions.js";
import { auth, kuenstler } from "./firebaseClient.js";

/**
 * Wer angemeldet ist und was er bei der Künstler:in dieser Website darf.
 * `nutzer`: undefined solange unbekannt, sonst null oder der Firebase-Nutzer.
 * `wer`: undefined solange unbekannt, null ohne Rolle, sonst { superAdmin, rolle }
 * für darf() aus permissions.js.
 */
export function useZugang() {
  const [nutzer, setNutzer] = useState(undefined);
  const [wer, setWer] = useState();

  useEffect(() => onAuthStateChanged(auth, setNutzer), []);

  useEffect(() => {
    setWer(undefined);
    if (!nutzer) return;
    let aktuell = true;
    (async () => {
      const superAdmin = (await nutzer.getIdTokenResult()).claims.superAdmin === true;
      let rolle;
      try {
        rolle = (await getDoc(kuenstler)).get("roles")?.[nutzer.email];
      } catch { /* ohne Rolle darf man das Dokument nicht lesen */ }
      if (aktuell) setWer(superAdmin || rolle ? { superAdmin, rolle } : null);
    })();
    return () => { aktuell = false; };
  }, [nutzer]);

  return { nutzer, wer };
}

const knopf = "px-3 py-1 border rounded disabled:opacity-40";

/**
 * Rahmen jeder Verwaltungsseite: Anmeldung, dann `kinder({ nutzer, wer })`, wenn
 * `berechtigung` erlaubt ist. Durchgesetzt wird das von firestore.rules; dies
 * blendet nur aus, was man ohnehin nicht dürfte.
 */
export default function Zugang({ berechtigung = "lesen", kinder }) {
  const { nutzer, wer } = useZugang();
  const [fehler, setFehler] = useState();

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
