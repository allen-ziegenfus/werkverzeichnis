import { signOut } from "firebase/auth";
import { darf } from "../werkverzeichnis/permissions.js";
import { BEREICHE } from "./bereiche.js";
import { auth, KUENSTLER } from "./firebaseClient.js";
import { Stand } from "./Veroeffentlichen.jsx";
import { useZugang } from "./Zugang.jsx";

/**
 * Kopf der Verwaltung: Reiter für die Bereiche, die man darf, der Stand der
 * Veröffentlichung, zurück zur Website und Abmelden.
 */

const link = "underline hover:no-underline";

export default function VerwaltungKopf({ kuenstlerName, aktiv }) {
  const { nutzer, wer } = useZugang();
  const bereiche = nutzer && wer ? BEREICHE.filter(b => darf(wer, b.berechtigung)) : [];

  return (
    <header className="border-b border-gray-400 bg-gray-200 text-sm">
      <div className="max-w-5xl mx-auto px-4 pt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <a href="/verwaltung/" className="text-base">
          <b>Verwaltung</b> · {kuenstlerName}
        </a>
        <span className="ml-auto text-gray-600">
          <a className={link} href="/">← Zur Website</a>
          {nutzer && (
            <>
              <span className="hidden sm:inline"> · {nutzer.email}</span>
              {" · "}
              <button className={link} onClick={() => signOut(auth)}>Abmelden</button>
            </>
          )}
        </span>
      </div>
      <div className="max-w-5xl mx-auto px-4 pt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
        <nav className="flex gap-1 overflow-x-auto -mb-px">
          {bereiche.map(b => (
            <a key={b.pfad} href={b.pfad}
               className={"px-3 py-1.5 border border-b-0 rounded-t whitespace-nowrap " + (b.pfad === aktiv
                 ? "bg-white border-gray-400" : "border-transparent hover:bg-gray-100")}>
              {b.titel}
            </a>
          ))}
        </nav>
        {nutzer && wer && darf(wer, "lesen") && (
          <Stand kuenstlerId={KUENSTLER} ich={nutzer.email} erlaubt={darf(wer, "veroeffentlichen")}
                 darfWerke={darf(wer, "werke.bearbeiten")}
                 className="ml-auto pb-1.5" />
        )}
      </div>
      {!bereiche.length && <div className="h-2" />}
    </header>
  );
}
