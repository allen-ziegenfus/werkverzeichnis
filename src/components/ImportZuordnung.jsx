import { useMemo } from "react";
import { buchstabe } from "../werkverzeichnis/tabelle.js";
import { fehlt, unbekannteGruppen, zieleVon } from "../werkverzeichnis/zuordnung.js";

/**
 * Spalten den Feldern zuordnen (#349) und die Werkgruppe wählen. Gesteuert:
 * `zuordnung` wie in zuordnung.js (bereinigen), Änderungen über `aendern(neu)`.
 */
export default function ImportZuordnung({ t, felder, gruppen, zuordnung, aendern }) {
  const ziele = zieleVon(felder);
  const name = new Map(ziele.map(z => [z.ziel, z.name]));
  const spalteVon = new Map(Object.entries(zuordnung.ziele).filter(([, z]) => z).map(([i, z]) => [z, Number(i)]));
  // Je Spalte (nach Position) bis zu drei verschiedene Werte, einmal je Tabelle.
  const beispiele = useMemo(() => t.spalten.map((_, i) => {
    const b = new Set();
    for (const z of t.daten) { if (z.werte[i]) b.add(z.werte[i]); if (b.size === 3) break; }
    return [...b].join(" · ");
  }), [t]);
  const setZiel = (index, ziel) => aendern({ ...zuordnung, ziele: { ...zuordnung.ziele, [index]: ziel } });
  const setGruppe = teil => aendern({ ...zuordnung, gruppe: { ...zuordnung.gruppe, ...teil } });
  const { art, fest, spalte } = zuordnung.gruppe;
  const unbekannt = useMemo(() => art === "spalte" && spalte !== "" ? unbekannteGruppen(spalte, t.spalten, t.daten, gruppen) : [],
    [art, spalte, t, gruppen]);
  const offen = fehlt(zuordnung);
  const auswahl = "border border-gray-400 rounded px-2 py-1 max-w-full";

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Spalten zuordnen</h2>
        <p className="text-gray-600">
          Welche Spalte in welches Feld geht. Vorausgewählt ist, was nach dem Namen passt. Fehlt ein Feld, lässt es
          sich in den <a className="underline" href="/verwaltung/einstellungen/" target="_blank" rel="noreferrer">Einstellungen</a>{" "}
          (neuer Tab) anlegen; zurück hier steht es zur Auswahl.
        </p>
        <ul className="divide-y divide-gray-200 border border-gray-200 rounded">
          {t.spalten.map((s, i) => {
            const ziel = zuordnung.ziele[s.index] ?? "";
            return (
              <li key={s.index} className="px-3 py-2 flex flex-col gap-1 sm:grid sm:grid-cols-[minmax(0,1fr)_16rem] sm:gap-4 sm:items-center">
                <div className="min-w-0">
                  <span className="text-xs text-gray-500 mr-1">{buchstabe(s.index)}</span>
                  <span className="font-semibold">{s.name}</span>
                  <span className="block text-sm text-gray-600 truncate" title={beispiele[i]}>
                    {beispiele[i] || "leer"}
                  </span>
                </div>
                <select className={auswahl + (ziel ? "" : " text-gray-500")} value={ziel}
                        aria-label={`Spalte ${buchstabe(s.index)} „${s.name}“ übernehmen als`}
                        onChange={e => setZiel(s.index, e.target.value)}>
                  <option value="">nicht übernehmen</option>
                  {ziele.map(z => {
                    const belegt = spalteVon.has(z.ziel) && spalteVon.get(z.ziel) !== s.index;
                    return (
                      <option key={z.ziel} value={z.ziel} disabled={belegt}>
                        {z.name}{belegt ? ` (schon Spalte ${buchstabe(spalteVon.get(z.ziel))})` : ""}
                      </option>
                    );
                  })}
                </select>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Werkgruppe</h2>
        <p className="text-gray-600">
          In welche Werkgruppe der Website neue Werke kommen. Vorhandene Werke bleiben in ihrer; steht eines in einer anderen, gilt die Zeile als Fehler.
        </p>
        <fieldset className="space-y-2">
          <legend className="sr-only">Werkgruppe</legend>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" name="gruppe" checked={art === "fest"} onChange={() => setGruppe({ art: "fest" })} />
            <span>Alle in</span>
            <select className={auswahl} value={fest}
                    aria-label="Werkgruppe für alle" onChange={e => setGruppe({ art: "fest", fest: e.target.value })}>
              <option value="">– wählen –</option>
              {gruppen.map(g => <option key={g.id} value={g.id}>{g.titel}</option>)}
            </select>
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <input type="radio" name="gruppe" checked={art === "spalte"} onChange={() => setGruppe({ art: "spalte" })} />
            <span>Aus der Spalte</span>
            <select className={auswahl} value={spalte}
                    aria-label="Spalte mit der Werkgruppe"
                    onChange={e => setGruppe({ art: "spalte", spalte: e.target.value === "" ? "" : Number(e.target.value) })}>
              <option value="">– wählen –</option>
              {t.spalten.map(s => <option key={s.index} value={s.index}>{buchstabe(s.index)}: {s.name}</option>)}
            </select>
            <span className="text-sm text-gray-600">(Titel, Kurztitel oder Kennung der Werkgruppe)</span>
          </label>
        </fieldset>
        {unbekannt.length > 0 && (
          <div className="text-amber-800">
            <p>Keine (eindeutige) Werkgruppe gefunden für:</p>
            <ul className="list-disc pl-6">
              {unbekannt.slice(0, 10).map(u => <li key={u.wert}>„{u.wert}“ ({u.anzahl} {u.anzahl === 1 ? "Zeile" : "Zeilen"})</li>)}
              {unbekannt.length > 10 && <li>und {unbekannt.length - 10} weitere</li>}
            </ul>
            <p>Neue Werke in diesen Zeilen lassen sich so nicht anlegen; Werkgruppen anlegen oder umbenennen geht unter „Werkgruppen“.</p>
          </div>
        )}
      </section>

      {offen.length > 0 && (
        <ul className="text-red-700">{offen.map(f => <li key={f}>{f}</li>)}</ul>
      )}
      <p className="text-sm text-gray-600">
        Übernommen: {[...spalteVon].map(([z, i]) => `${name.get(z)} ← ${buchstabe(i)}`).join(", ") || "nichts"}.
      </p>
    </div>
  );
}
