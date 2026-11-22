import { useEffect, useMemo, useState } from "react";
import Zugang from "./Zugang.jsx";
import ImportZuordnung from "./ImportZuordnung.jsx";
import { client, SCHLUESSEL, useKuenstler, useWerkgruppen } from "./abfragen.js";
import { felderVon } from "../werkverzeichnis/felder.js";
import { blaetterLesen, buchstabe, HOECHSTENS, kopfzeileRaten, tabelle, zuGross } from "../werkverzeichnis/tabelle.js";
import { bereinigen, gruppenSpalteVorschlagen, vorschlagen, zieleVon } from "../werkverzeichnis/zuordnung.js";

/**
 * Import von Werken aus einer Tabelle (#239): Datei wählen, im Browser lesen,
 * Blatt und Kopfzeile wählen, Vorschau (#348); Spalten den Feldern zuordnen
 * und die Werkgruppe wählen (#349). Geschrieben wird noch nichts (#350).
 */

const VORSCHAU = 10;
const KOPF_AUSWAHL = 20;   // Die Kopfzeile steht unter den ersten so vielen nicht leeren Zeilen.

export default function ImportSeite() {
  return <Zugang berechtigung="werke.bearbeiten" kinder={() => <Import />} />;
}

function Import() {
  const [datei, setDatei] = useState();       // { name, blaetter }
  const [blatt, setBlatt] = useState(0);
  const [kopf, setKopf] = useState(0);
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState();

  async function waehlen(e) {
    const f = e.target.files?.[0];
    // Sonst löst dieselbe Datei noch einmal (geändert oder nach einem Fehler) nichts aus.
    e.target.value = "";
    if (!f) return;
    setFehler(undefined); setDatei(undefined);
    if (zuGross(f.size)) { setFehler(zuGross(f.size)); return; }
    setLaedt(true);
    try {
      const blaetter = await blaetterLesen(f.name, await f.arrayBuffer());
      // Das erste Blatt mit Inhalt; Excel legt oft leere „Tabelle2“, „Tabelle3“ an.
      const b = Math.max(0, blaetter.findIndex(x => x.zeilen.some(z => z.some(c => c))));
      setDatei({ name: f.name, blaetter }); setBlatt(b); setKopf(kopfzeileRaten(blaetter[b]?.zeilen ?? []));
    } catch (e) {
      setFehler(`Die Datei ließ sich nicht lesen: ${e.message}`);
    } finally {
      setLaedt(false);
    }
  }

  const zeilen = datei?.blaetter[blatt]?.zeilen ?? [];
  const ergebnis = useMemo(() => {
    if (!datei) return undefined;
    if (datei.blaetter[blatt]?.zeilenAus === "zu lang") return { fehler: `Mehr als ${HOECHSTENS.zeilen} Zeilen; bitte aufteilen.` };
    try { return { t: tabelle(zeilen, kopf) }; } catch (e) { return { fehler: e.message }; }
  }, [datei, blatt, kopf]);
  const t = ergebnis?.t;

  // Feldliste und Werkgruppen; zurück aus einem anderen Tab (Feld angelegt) neu laden.
  const { data: kuenstlerDaten, error: kuenstlerFehler } = useKuenstler();
  const { data: gruppen, error: gruppenFehler } = useWerkgruppen();
  useEffect(() => {
    const zurueck = () => {
      client.invalidateQueries({ queryKey: SCHLUESSEL.kuenstler });
      client.invalidateQueries({ queryKey: SCHLUESSEL.werkgruppen });
    };
    addEventListener("focus", zurueck);
    return () => removeEventListener("focus", zurueck);
  }, []);
  const felder = useMemo(() => kuenstlerDaten && felderVon(kuenstlerDaten), [kuenstlerDaten]);

  // Die Zuordnung gehört zu einer Tabelle (Datei, Blatt, Kopfzeile); für eine
  // andere gilt wieder der Vorschlag nach Namen.
  const fuer = datei && `${blatt}:${kopf}`;
  const vorschlag = useMemo(() => {
    if (!t || !felder || !gruppen) return undefined;
    const spalte = gruppenSpalteVorschlagen(t.spalten, t.daten, gruppen);
    return {
      ziele: vorschlagen(t.spalten, felder),
      gruppe: { art: spalte !== undefined ? "spalte" : "fest", spalte: spalte ?? "", fest: gruppen.length === 1 ? gruppen[0].id : "" },
    };
  }, [t, felder, gruppen]);
  const [gewaehlt, setGewaehlt] = useState();   // { datei, fuer, zuordnung }
  const roh = gewaehlt && gewaehlt.datei === datei && gewaehlt.fuer === fuer ? gewaehlt.zuordnung : vorschlag;
  // Gegen den heutigen Stand: archivierte Felder, gelöschte Werkgruppen.
  const zuordnung = useMemo(() => roh && t && felder && gruppen && bereinigen(roh, t, felder, gruppen),
    [roh, t, felder, gruppen]);
  const zielName = new Map((felder ? zieleVon(felder) : []).map(z => [z.ziel, z.name]));

  return (
    <div className="space-y-4">
      <p className="text-gray-600">
        Werke aus einer Tabelle übernehmen: CSV, XLS oder XLSX, eine Zeile je Werk, oben eine Zeile mit den
        Spaltennamen. Die Datei wird nur hier im Browser gelesen; hier wird noch nichts gespeichert.
      </p>

      <label className="block">
        <span className="block font-semibold mb-1">Datei</span>
        <input type="file" accept=".csv,.xls,.xlsx" onChange={waehlen} disabled={laedt}
               className="block text-sm file:mr-3 file:rounded file:border file:border-gray-400 file:bg-white file:px-3 file:py-1 file:shadow-sm" />
      </label>
      <p role="status" className={laedt ? "" : "sr-only"}>{laedt ? "Liest…" : datei ? `${datei.name} gelesen.` : ""}</p>
      {fehler && <p className="text-red-700" role="alert">{fehler}</p>}

      {datei && (
        <div className="flex flex-wrap gap-x-6 gap-y-2 items-end">
          {datei.blaetter.length > 1 && (
            <label>
              <span className="block text-sm text-gray-600">Blatt</span>
              <select className="border border-gray-400 rounded px-2 py-1" value={blatt}
                      onChange={e => { const b = Number(e.target.value); setBlatt(b); setKopf(kopfzeileRaten(datei.blaetter[b].zeilen)); }}>
                {datei.blaetter.map((b, i) => (
                  <option key={i} value={i}>{b.name} ({b.zeilen.filter(z => z.some(c => c)).length} Zeilen)</option>
                ))}
              </select>
            </label>
          )}
          <label className="min-w-0 max-w-full">
            <span className="block text-sm text-gray-600">Spaltennamen in</span>
            <select className="border border-gray-400 rounded px-2 py-1 max-w-full" value={kopf}
                    onChange={e => setKopf(Number(e.target.value))}>
              {zeilen.map((z, i) => [z, i]).filter(([z]) => z.some(c => c)).slice(0, KOPF_AUSWAHL).map(([z, i]) => (
                <option key={i} value={i}>Zeile {i + 1}: {z.filter(c => c).slice(0, 4).join(", ").slice(0, 60)}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      {datei?.blaetter[blatt]?.abgeschnitten && (
        <p className="text-amber-800">Nur die ersten {HOECHSTENS.spalten} Spalten werden gelesen.</p>
      )}
      {datei?.blaetter[blatt]?.zeilenAus === "ende" && (
        <p className="text-amber-800">
          Gelesen bis Zeile {datei.blaetter[blatt].gelesen}; laut Datei reicht das Blatt bis Zeile {datei.blaetter[blatt].bis}.
          Meist sind das nur formatierte leere Zellen. Stehen dort weitere Werke, bitte die Datei aufteilen.
        </p>
      )}
      {ergebnis?.fehler && <p className="text-red-700" role="alert">{ergebnis.fehler}</p>}
      {t && (t.daten.length === 0 ? (
        <p>Unter den Spaltennamen stehen keine Zeilen.</p>
      ) : (
        <div className="space-y-2">
          <p>
            <span className="font-semibold">{datei.name}</span>: {t.daten.length} {t.daten.length === 1 ? "Zeile" : "Zeilen"},{" "}
            {t.spalten.length} {t.spalten.length === 1 ? "Spalte" : "Spalten"}
            {t.daten.length > VORSCHAU && <span className="text-gray-600">; hier die ersten {VORSCHAU}</span>}.
          </p>
          <div className="overflow-x-auto border border-gray-200 rounded" tabIndex={0} role="region" aria-label="Vorschau der Tabelle">
            <table className="text-sm border-collapse">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-1 text-right text-gray-500 font-normal">Zeile</th>
                  {t.spalten.map(s => (
                    <th key={s.index} className="px-2 py-1 text-left align-bottom whitespace-nowrap">
                      <span className="block text-xs text-gray-500 font-normal">{buchstabe(s.index)}</span>{s.name}
                      {zuordnung && (
                        <span className={"block text-xs font-normal " + (zuordnung.ziele[s.index] ? "text-blue-800" : "text-gray-400")}>
                          {zuordnung.ziele[s.index] ? `→ ${zielName.get(zuordnung.ziele[s.index])}` : "nicht übernommen"}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.daten.slice(0, VORSCHAU).map(z => (
                  <tr key={z.nr} className="border-t border-gray-200 align-top">
                    <td className="px-2 py-1 text-right text-gray-500">{z.nr}</td>
                    {z.werte.map((w, i) => (
                      <td key={i} className="px-2 py-1 max-w-[16rem] truncate" title={w}>{w}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(kuenstlerFehler || gruppenFehler) && (
            <p className="text-red-700" role="alert">Feldliste oder Werkgruppen ließen sich nicht laden: {(kuenstlerFehler ?? gruppenFehler).message}</p>
          )}
          {zuordnung && (
            <ImportZuordnung t={t} felder={felder} gruppen={gruppen} zuordnung={zuordnung}
                             aendern={neu => setGewaehlt({ datei, fuer, zuordnung: neu })} />
          )}
        </div>
      ))}
    </div>
  );
}
