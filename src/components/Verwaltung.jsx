import { darf } from "../werkverzeichnis/permissions.js";
import { BEREICHE } from "./bereiche.js";
import { KUENSTLER } from "./firebaseClient.js";
import Veroeffentlichen from "./Veroeffentlichen.jsx";
import Zugang from "./Zugang.jsx";

/** Die Startseite der Verwaltung: Kacheln zu den Bereichen, die man darf. */
export default function Verwaltung() {
  return <Zugang kinder={({ nutzer, wer }) => (
    <div className="space-y-6">
      <ul className="grid gap-3 sm:grid-cols-2">
        {BEREICHE.filter(b => darf(wer, b.berechtigung)).map(b => (
          <li key={b.pfad}>
            <a className="block border rounded p-3 hover:bg-gray-100 dark:hover:bg-neutral-800" href={b.pfad}>
              <span className="text-lg">{b.titel}</span>
              <span className="block text-sm text-gray-600 dark:text-gray-400">{b.text}</span>
            </a>
          </li>
        ))}
      </ul>
      <Veroeffentlichen kuenstlerId={KUENSTLER} ich={nutzer.email} erlaubt={darf(wer, "veroeffentlichen")} />
    </div>
  )} />;
}
