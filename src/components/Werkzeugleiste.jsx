import { createRoot } from "react-dom/client";
import { signOut } from "firebase/auth";
import { darf } from "../werkverzeichnis/permissions.js";
import { auth, KUENSTLER } from "./firebaseClient.js";
import { Stand } from "./Veroeffentlichen.jsx";
import { useZugang } from "./Zugang.jsx";

/**
 * Die feste Leiste unten auf den Seiten der Website, für angemeldete
 * Bearbeiter:innen: der Weg in die Verwaltung (Werk bearbeiten, Verwaltung),
 * Stand der Veröffentlichung, Abmelden. Das Layout lädt sie nur, wenn sich auf
 * diesem Gerät schon jemand angemeldet hat. Hellgrau auch im dunklen Modus,
 * damit sie sich von der Seite abhebt. In der Verwaltung übernimmt der Kopf
 * (VerwaltungKopf.jsx) ihre Aufgaben.
 */

/** Höchstens einmal je Seite; Layout und Anmeldung rufen es beide auf. */
export function anzeigen(el) {
  if (el.dataset.angezeigt) return;
  el.dataset.angezeigt = "1";
  createRoot(el).render(<Werkzeugleiste werkKennung={el.dataset.werk} />);
}

const link = "underline hover:no-underline";

function Werkzeugleiste({ werkKennung }) {
  const { nutzer, wer } = useZugang();

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
          {wer && <a className={link} href="/verwaltung/">Verwaltung →</a>}
          {wer && darf(wer, "lesen") && (
            <Stand kuenstlerId={KUENSTLER} ich={nutzer.email} erlaubt={darf(wer, "veroeffentlichen")}
                   className="order-last w-full sm:order-none sm:w-auto" />
          )}
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
