import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { getDoc } from "firebase/firestore";
import { darf } from "../werkverzeichnis/permissions.js";
import { auth, kuenstler, KUENSTLER } from "./firebaseClient.js";
import { HOECHSTENS, useVeroeffentlichung } from "./Veroeffentlichen.jsx";

/**
 * Die feste Leiste unten für angemeldete Bearbeiter:innen, auf jeder Seite:
 * Werk bearbeiten, Verwaltung, Stand der Veröffentlichung, Abmelden. Das Layout
 * lädt sie nur, wenn sich auf diesem Gerät schon jemand angemeldet hat.
 * Hellgrau auch im dunklen Modus, damit sie sich von der Seite abhebt.
 */

export function anzeigen(el) {
  createRoot(el).render(<Werkzeugleiste werkKennung={el.dataset.werk} />);
}

const link = "underline hover:no-underline";
const knopf = "px-2 py-0.5 border border-gray-400 rounded bg-white disabled:opacity-40";

function Werkzeugleiste({ werkKennung }) {
  const [nutzer, setNutzer] = useState(undefined);
  const [wer, setWer] = useState();  // { superAdmin, rolle }, oder null ohne Zugriff

  useEffect(() => onAuthStateChanged(auth, setNutzer), []);

  useEffect(() => {
    if (!nutzer) return setWer(undefined);
    (async () => {
      const superAdmin = (await nutzer.getIdTokenResult()).claims.superAdmin === true;
      let rolle;
      try {
        rolle = (await getDoc(kuenstler)).get("roles")?.[nutzer.email];
      } catch { /* ohne Rolle darf man das Dokument nicht lesen */ }
      setWer(superAdmin || rolle ? { superAdmin, rolle } : null);
    })();
  }, [nutzer]);

  if (!nutzer || wer === undefined) return null;

  return (
    <>
      <div className="h-16 sm:h-12" />
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-400 bg-gray-200 text-black text-sm">
        <div className="max-w-6xl mx-auto px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {wer && werkKennung && darf(wer, "werke.bearbeiten") && (
            <a className={link} href={`/verwaltung/werke/?werk=${encodeURIComponent(werkKennung)}`}>
              ✎ <span className="hidden sm:inline">Dieses </span>Werk bearbeiten
            </a>
          )}
          <a className={link} href="/verwaltung/">Verwaltung</a>
          {wer && darf(wer, "lesen") && <Stand ich={nutzer.email} erlaubt={darf(wer, "veroeffentlichen")} />}
          <span className="ml-auto text-gray-600">
            <span className="hidden sm:inline">{nutzer.email} · </span>
            {wer === null && "Kein Zugriff · "}
            <button className={link} onClick={() => signOut(auth)}>Abmelden</button>
          </span>
        </div>
      </div>
    </>
  );
}

function Stand({ ich, erlaubt }) {
  const { liste, aenderungen, fehler, beschaeftigt, veroeffentlichen } = useVeroeffentlichung(KUENSTLER, ich);
  const n = aenderungen && aenderungen.history.length + aenderungen.seiten.length + aenderungen.werkgruppen.length;
  const letzte = liste?.[0];

  return (
    <span className="flex items-center gap-2 order-last w-full sm:order-none sm:w-auto">
      {fehler ? <span className="text-red-700">{fehler}</span>
        : beschaeftigt ? <span>Veröffentlichung läuft …</span>
        : letzte?.status === "fehler" ? <span className="text-red-700">Letzte Veröffentlichung fehlgeschlagen</span>
        : n === undefined ? <span>…</span>
        : n === 0 ? <span className="text-green-700">Alles veröffentlicht</span>
        : <span>● {n > HOECHSTENS ? `über ${HOECHSTENS}` : n} offene Änderung{n === 1 ? "" : "en"}</span>}
      {erlaubt && (
        <button className={knopf} onClick={veroeffentlichen} disabled={!liste}>Veröffentlichen</button>
      )}
    </span>
  );
}
