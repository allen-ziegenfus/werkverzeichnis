import { useMemo, useState } from "react";
import { gruppieren, zeilenUnterschied } from "./verlaufGruppen.js";
import { wann as zeit } from "./zeit.js";

/**
 * Der Verlauf einer Seite oder eines Werks, zusammengefasst (#204): je Gruppe,
 * wer wann was geändert hat, und je Feld „zurücknehmen“. Zurückgenommenes ist
 * grau und eingeklappt.
 *
 * - eintraege: einheitlich wie in verlaufGruppen.js, neueste zuerst
 * - ist: der gespeicherte Stand; zurücknehmen geht nur, wo er noch dem Stand
 *   nach der Gruppe entspricht
 * - gleich(feld, a, b), name(feld), lang(feld): Vergleich, Anzeige, Text mit Unterschied
 * - zuruecknehmen(gruppe, felder); gesperrt: Grund, warum es gerade nicht geht
 */
export const wann = t => zeit(t, "gerade eben");
const wert = v => v == null || v === "" ? "∅" : v === true ? "ja" : v === false ? "nein" : String(v);

export default function VerlaufListe({ eintraege, ist, gleich, name, lang, bearbeitbar, gesperrt, zuruecknehmen }) {
  // Nur neu, wenn sich der Verlauf ändert, nicht bei jedem Tastendruck im Formular.
  const gruppen = useMemo(() => gruppieren(eintraege, gleich).filter(g => !g.verborgen), [eintraege, gleich]);
  if (!gruppen.length) return <p className="text-sm text-gray-600">Noch keine Änderungen.</p>;
  return (
    <ul className="divide-y text-sm">
      {gruppen.map(g => {
        const felder = Object.keys(g.felder);
        const kopf = (
          <>
            <span className="text-gray-600">{wann(g.at)} · {g.by}</span>
            {" "}· {g.art === "angelegt" ? "angelegt" : g.art === "gelöscht" ? "gelöscht"
              : felder.map(name).join(", ") || "nichts geändert"}
            {g.eintraege.length > 1 && <span className="text-gray-600"> ({g.eintraege.length}× gespeichert)</span>}
            {g.zurueckgesetzt && <span className="text-gray-600"> · ↶ auf den veröffentlichten Stand zurückgesetzt</span>}
          </>
        );
        const inhalt = g.art === "geändert" && felder.map(f => {
          const c = g.felder[f];
          const zurueck = g.zurueckgenommen[f];
          const moeglich = !zurueck && gleich(f, ist?.[f], c.zu);
          return (
            <div key={f} className="pl-3 py-0.5">
              <div className="flex gap-2 items-baseline flex-wrap">
                <b>{name(f)}</b>
                {!lang(f) && <span><s className="text-gray-500">{wert(c.von)}</s> → {wert(c.zu)}</span>}
                {zurueck ? <span className="text-gray-600">zurückgenommen {wann(zurueck.at)} von {zurueck.by}</span>
                  : bearbeitbar && (
                    <button className="underline disabled:no-underline disabled:opacity-40"
                            disabled={!!gesperrt || !moeglich}
                            title={gesperrt || (!moeglich ? "Seitdem erneut geändert." : `${name(f)} auf den Stand davor setzen`)}
                            onClick={() => zuruecknehmen(g, [f])}>zurücknehmen</button>
                  )}
              </div>
              {lang(f) && <Unterschied von={c.von} zu={c.zu} />}
            </div>
          );
        });
        if (g.ganzZurueck) return (
          <li key={g.id} className="py-1 text-gray-500">
            <details>
              <summary className="cursor-pointer">{wann(g.at)} · {g.by} · {felder.map(name).join(", ")} geändert, zurückgenommen</summary>
              {inhalt}
            </details>
          </li>
        );
        return (
          <li key={g.id} className="py-1.5 space-y-0.5">
            <div>{kopf}</div>
            {inhalt}
          </li>
        );
      })}
    </ul>
  );
}

/** Zeilenweise, was sich am Text geändert hat; berechnet erst beim Aufklappen. */
export function Unterschied({ von, zu, beschriftung = "Unterschied zeigen" }) {
  const [offen, setOffen] = useState(false);
  return (
    <details className="mt-0.5" onToggle={e => setOffen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-gray-600">{beschriftung}</summary>
      {offen && <pre className="whitespace-pre-wrap break-words border rounded p-1 mt-1 text-xs font-mono">
        {zeilenUnterschied(von, zu).map(([art, zeile], k) => (
          <div key={k} className={art === "-" ? "bg-red-50 text-red-800 line-through" : art === "+" ? "bg-green-50 text-green-800"
            : art === "…" ? "text-gray-400" : "text-gray-600"}>
            {art === "…" ? "…" : `${art} ${zeile}`}
          </div>
        ))}
      </pre>}
    </details>
  );
}
