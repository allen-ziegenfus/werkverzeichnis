import { useState } from "react";
import { HOECHSTENS_FELDER, neuerSchluessel } from "../werkverzeichnis/felder.js";
import { knopf, knopfKlein } from "./knoepfe.js";
import { useUngespeichert } from "./ungespeichert.js";

/**
 * Die Felder der Werke bearbeiten (#256): umbenennen, ordnen, neu anlegen,
 * mehrzeilig, öffentlich oder intern, archivieren. Gespeichert wird mit den
 * übrigen Einstellungen. Archivieren entfernt nichts: Die Werte bleiben am Werk
 * und kommen mit „Wiederherstellen“ zurück.
 */

/** Was am Entwurf nicht stimmt, sonst undefined. */
export function felderFehler(felder) {
  // Archivierte zählen mit; mehr lehnen die Regeln ab.
  if (felder.length > HOECHSTENS_FELDER) return `Höchstens ${HOECHSTENS_FELDER} Felder, archivierte mitgezählt.`;
  const namen = felder.map(f => f.name.trim().toLowerCase());
  if (namen.some(n => !n)) return "Jedes Feld braucht einen Namen.";
  const doppelt = namen.find((n, i) => namen.indexOf(n) !== i);
  if (!doppelt) return;
  const beide = felder.filter(f => f.name.trim().toLowerCase() === doppelt);
  return `Den Namen „${beide[0].name.trim()}“ gibt es zweimal`
    + (beide.some(f => f.archiviert) ? " (einmal archiviert; lieber wiederherstellen)." : ".");
}

/** „in 3 Werken“ bzw. „leer“; undefined, solange nicht gezählt. */
const werteText = n => n === undefined ? undefined : n === 0 ? "leer" : `in ${n} ${n === 1 ? "Werk" : "Werken"}`;

/**
 * `gespeichert`: die Schlüssel der gespeicherten Liste; ein Feld, das noch
 * nicht drin ist, lässt sich ganz entfernen. `werte`: je gespeichertem Feld die
 * Zahl der Werke mit Wert (#326), undefined, solange gezählt wird, null, wenn das
 * Zählen gescheitert ist; ein
 * gespeichertes Feld ohne Werte lässt sich ebenfalls entfernen.
 */
export default function FelderBearbeiten({ felder, setFelder, gespeichert, werte, gesperrt }) {
  const [neu, setNeu] = useState("");
  useUngespeichert(!!neu.trim());   // eingetippt, aber nicht mit „+ Feld“ angelegt (#324)
  const aendern = (schluessel, werte) => setFelder(felder.map(f => f.schluessel === schluessel ? { ...f, ...werte } : f));
  const aktiv = felder.filter(f => !f.archiviert);
  const archiviert = felder.filter(f => f.archiviert);
  const entfernbar = f => !gespeichert.has(f.schluessel) || werte?.[f.schluessel] === 0;
  const entfernen = f => setFelder(felder.filter(x => x.schluessel !== f.schluessel));
  const entfernenKnopf = (f, klasse = "") => (
    <button className={knopfKlein + klasse} disabled={gesperrt} onClick={() => entfernen(f)}
            title={gespeichert.has(f.schluessel) ? "Kein Werk hat hier einen Wert; der Name wird wieder frei." : undefined}>
      Entfernen
    </button>
  );
  // Unter dem Namen: der gespeicherte Schlüssel, falls anders, und wie viele Werke einen Wert haben.
  const unterzeile = f => [f.name.trim() !== f.schluessel && `gespeichert als ${f.schluessel}`,
    werte !== null && gespeichert.has(f.schluessel) && (werteText(werte?.[f.schluessel]) ?? "wird gezählt…")].filter(Boolean).join(" · ");

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
    if (!name || felder.length >= HOECHSTENS_FELDER) return;
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
              <div className="flex-1 min-w-0">
                <input className="border p-1 w-full disabled:bg-gray-100" value={f.name} disabled={gesperrt}
                       aria-label={`Name des Felds ${f.schluessel}`}
                       aria-describedby={unterzeile(f) ? `feld-${f.schluessel}` : undefined}
                       onChange={e => aendern(f.schluessel, { name: e.target.value })} />
                {unterzeile(f) && (
                  <span id={`feld-${f.schluessel}`} className="block text-xs text-gray-500">{unterzeile(f)}</span>
                )}
              </div>
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
            <span className="ml-auto flex gap-2">
              {gespeichert.has(f.schluessel) && (
                <button className={knopfKlein + " text-sm"} disabled={gesperrt} onClick={() => aendern(f.schluessel, { archiviert: true })}>
                  Archivieren
                </button>
              )}
              {entfernbar(f) && entfernenKnopf(f, " text-sm")}
            </span>
          </li>
        ))}
      </ol>

      <div className="flex gap-2">
        <label className="flex-1">
          <span className="sr-only">Name des neuen Felds</span>
          <input className="border p-1 w-full disabled:bg-gray-100" placeholder="Name des neuen Felds" value={neu} disabled={gesperrt}
                 onChange={e => setNeu(e.target.value)} onKeyDown={e => { if (e.key === "Enter") anlegen(); }} />
        </label>
        <button className={knopf} disabled={gesperrt || !neu.trim() || felder.length >= HOECHSTENS_FELDER} onClick={anlegen}
                title={felder.length >= HOECHSTENS_FELDER ? `Höchstens ${HOECHSTENS_FELDER} Felder, archivierte mitgezählt.` : undefined}>+ Feld</button>
      </div>

      {archiviert.length > 0 && (
        <div className="pt-2">
          <h3 className="text-sm font-semibold">Archiviert</h3>
          <p className="text-sm text-gray-600">Nicht im Formular und nicht auf der Website; die Werte bleiben an den Werken.</p>
          <ul className="divide-y border rounded mt-1">
            {archiviert.map(f => (
              <li key={f.schluessel} className="p-2 flex items-center gap-3">
                <span className="flex-1 text-gray-600">
                  {f.name}
                  {werteText(werte?.[f.schluessel]) && <span className="block text-xs text-gray-500">{werteText(werte[f.schluessel])}</span>}
                </span>
                <button className={knopfKlein} disabled={gesperrt} onClick={() => aendern(f.schluessel, { archiviert: false })}>
                  Wiederherstellen
                </button>
                {entfernbar(f) && entfernenKnopf(f)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
