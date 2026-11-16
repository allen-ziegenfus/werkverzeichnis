import { useState } from "react";
import { neuerSchluessel } from "../werkverzeichnis/felder.js";
import { knopf, knopfKlein } from "./knoepfe.js";

/**
 * Die Felder der Werke bearbeiten (#256): umbenennen, ordnen, neu anlegen,
 * mehrzeilig, öffentlich oder intern, archivieren. Gespeichert wird mit den
 * übrigen Einstellungen. Archivieren entfernt nichts: Die Werte bleiben am Werk
 * und kommen mit „Wiederherstellen“ zurück.
 */

/** Was am Entwurf nicht stimmt, sonst undefined. */
export function felderFehler(felder) {
  const namen = felder.map(f => f.name.trim().toLowerCase());
  if (namen.some(n => !n)) return "Jedes Feld braucht einen Namen.";
  const doppelt = namen.find((n, i) => namen.indexOf(n) !== i);
  if (doppelt) return `Den Namen „${felder.find(f => f.name.trim().toLowerCase() === doppelt).name.trim()}“ gibt es zweimal.`;
}

/** `gespeichert`: die Schlüssel der gespeicherten Liste; ein Feld, das noch nicht drin ist, lässt sich ganz entfernen. */
export default function FelderBearbeiten({ felder, setFelder, gespeichert, gesperrt }) {
  const [neu, setNeu] = useState("");
  const aendern = (schluessel, werte) => setFelder(felder.map(f => f.schluessel === schluessel ? { ...f, ...werte } : f));
  const aktiv = felder.filter(f => !f.archiviert);
  const archiviert = felder.filter(f => f.archiviert);

  // Mit dem nächsten nicht archivierten Feld davor bzw. danach tauschen.
  function schieben(schluessel, richtung) {
    const i = aktiv.findIndex(f => f.schluessel === schluessel);
    const anderes = aktiv[i + richtung];
    if (!anderes) return;
    const a = felder.findIndex(f => f.schluessel === schluessel), b = felder.indexOf(anderes);
    const liste = [...felder];
    [liste[a], liste[b]] = [liste[b], liste[a]];
    setFelder(liste);
  }

  function anlegen() {
    const name = neu.trim();
    if (!name) return;
    setFelder([...felder, { schluessel: neuerSchluessel(name, felder), name, lang: false, oeffentlich: false, archiviert: false }]);
    setNeu("");
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-600">
        Inv. Nr. und Titel hat jedes Werk. Umbenennen ändert nur die Beschriftung, die Werte bleiben.
      </p>
      <ol className="divide-y border rounded">
        {aktiv.map((f, i) => (
          <li key={f.schluessel} className="p-2 flex flex-wrap items-center gap-x-2 sm:gap-x-3 gap-y-1">
            {/* Auf dem Handy Pfeile und Name eine Zeile, die Schalter darunter. */}
            <div className="flex gap-2 items-start w-full sm:w-auto sm:flex-1">
              <span className="flex gap-1 pt-1">
                <button className={knopfKlein} disabled={gesperrt || i === 0} onClick={() => schieben(f.schluessel, -1)}
                        aria-label={`${f.name} nach oben`} title="Nach oben">↑</button>
                <button className={knopfKlein} disabled={gesperrt || i === aktiv.length - 1} onClick={() => schieben(f.schluessel, 1)}
                        aria-label={`${f.name} nach unten`} title="Nach unten">↓</button>
              </span>
              <label className="flex-1 min-w-0">
                <span className="sr-only">Name</span>
                <input className="border p-1 w-full disabled:bg-gray-100" value={f.name} disabled={gesperrt}
                       onChange={e => aendern(f.schluessel, { name: e.target.value })} />
                {f.name.trim() !== f.schluessel && (
                  <span className="block text-xs text-gray-500">gespeichert als {f.schluessel}</span>
                )}
              </label>
            </div>
            <label className="text-sm flex items-center gap-1">
              <input type="checkbox" checked={f.lang} disabled={gesperrt}
                     onChange={e => aendern(f.schluessel, { lang: e.target.checked })} />
              mehrzeilig
            </label>
            <label className="text-sm flex items-center gap-1">
              <input type="checkbox" checked={f.oeffentlich} disabled={gesperrt}
                     onChange={e => aendern(f.schluessel, { oeffentlich: e.target.checked })} />
              auf der Website
            </label>
            {gespeichert.has(f.schluessel) ? (
              <button className={knopfKlein + " ml-auto text-sm"} disabled={gesperrt} onClick={() => aendern(f.schluessel, { archiviert: true })}>
                Archivieren
              </button>
            ) : (
              <button className={knopfKlein + " ml-auto text-sm"} disabled={gesperrt}
                      onClick={() => setFelder(felder.filter(x => x.schluessel !== f.schluessel))}>Entfernen</button>
            )}
          </li>
        ))}
      </ol>

      <div className="flex gap-2">
        <label className="flex-1">
          <span className="sr-only">Name des neuen Felds</span>
          <input className="border p-1 w-full disabled:bg-gray-100" placeholder="Name des neuen Felds" value={neu} disabled={gesperrt}
                 onChange={e => setNeu(e.target.value)} onKeyDown={e => { if (e.key === "Enter") anlegen(); }} />
        </label>
        <button className={knopf} disabled={gesperrt || !neu.trim()} onClick={anlegen}>+ Feld</button>
      </div>

      {archiviert.length > 0 && (
        <div className="pt-2">
          <h3 className="text-sm font-semibold">Archiviert</h3>
          <p className="text-sm text-gray-600">Nicht im Formular und nicht auf der Website; die Werte bleiben an den Werken.</p>
          <ul className="divide-y border rounded mt-1">
            {archiviert.map(f => (
              <li key={f.schluessel} className="p-2 flex items-center gap-3">
                <span className="flex-1 text-gray-600">{f.name}</span>
                <button className={knopfKlein} disabled={gesperrt} onClick={() => aendern(f.schluessel, { archiviert: false })}>
                  Wiederherstellen
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
