import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection, deleteField, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where,
} from "firebase/firestore";
import { client, SCHLUESSEL, useWerke, useWerkgruppen } from "./abfragen.js";
import { kuenstler, db } from "./firebaseClient.js";
import Skelett from "./Skelett.jsx";
import Zugang from "./Zugang.jsx";

/**
 * Der Werk-Editor (Firestore). Nur bearbeiten, eine Künstler:in.
 *
 * Wer was darf, entscheidet firestore.rules, nicht diese Datei: die Berechtigung
 * werke.bearbeiten, die Inv. Nr. bleibt, und jede Änderung muss ihren
 * Verlaufseintrag mitbringen.
 */

// Die Felder, die der Editor zeigt, in dieser Reihenfolge. Alles andere am
// Dokument (werkgruppe, images, updatedAt, lastChange) wird verwaltet, nicht bearbeitet.
const FELDER = ["InvNr", "Titel", "Werkgruppe", "Jahr", "Maße", "Material", "Technik",
  "Beschreibung", "Zustand", "Standort", "Signatur", "Auflage", "Anzahl", "Foto",
  "Ausstellung", "Literatur", "Bibliographie"];
const LANG = ["Beschreibung", "Ausstellung", "Literatur", "Bibliographie", "Material"];

/**
 * Was sich von einem Verlaufseintrag zurücksetzen lässt: Felder, deren heutiger
 * Wert noch der damals gespeicherte ist. Die anderen hat jemand seitdem
 * erneut geändert; die bleiben.
 */
function zuruecksetzbar(v, daten) {
  const felder = Object.entries(v.changes ?? {});
  const gleich = ([f, c]) => (daten[f] ?? null) === (c.to ?? null);
  return { zurueck: felder.filter(gleich), geblieben: felder.filter(x => !gleich(x)).map(([f]) => f) };
}

// Die zuletzt gewählte Werkgruppe, für die Rückkehr aus einem anderen Bereich.
let letzteGruppe = "";

export default function WerkEditorSeite() {
  return <Zugang berechtigung="werke.bearbeiten" kinder={({ nutzer }) => <WerkEditor nutzer={nutzer} />} />;
}

function WerkEditor({ nutzer }) {
  const [fehler, setFehler] = useState();
  // ?werk=<Kennung> (aus der Werkzeugleiste) öffnet dieses Werk direkt.
  const ziel = useRef(new URLSearchParams(location.search).get("werk"));
  const [gruppe, setGruppeRoh] = useState(() => ziel.current ? "" : letzteGruppe);
  const setGruppe = g => { letzteGruppe = g; setGruppeRoh(g); };
  const { data: gruppen, error: gruppenFehler } = useWerkgruppen();
  const { data: werke, error: werkeFehler } = useWerke(gruppe);
  const ladefehler = gruppenFehler ?? werkeFehler;
  const [suche, setSuche] = useState("");
  const [werk, setWerk] = useState();               // {id, data} wie geladen
  const [entwurf, setEntwurf] = useState({});
  const [verlauf, setVerlauf] = useState();      // undefined, solange er lädt
  // Welches Werk zuletzt geöffnet wurde: Ein langsamer Verlauf eines vorher
  // geöffneten Werks darf den des aktuellen nicht überschreiben.
  const offen = useRef();
  const [speichert, setSpeichert] = useState(false);
  const [hinweis, setHinweis] = useState();

  // Das Werk aus ?werk=: erst seine Werkgruppe wählen, dann öffnen, sobald sie geladen ist.
  useEffect(() => {
    if (!ziel.current || gruppe) return;
    getDoc(doc(kuenstler, "works", ziel.current))
      .then(w => {
        if (w.exists()) setGruppe(w.get("werkgruppe"));
        else { setFehler(`Werk „${ziel.current}“ nicht gefunden.`); ziel.current = null; }
      })
      .catch(e => setFehler(e.message));
  }, []);
  useEffect(() => {
    if (!ziel.current || !werke) return;
    const w = werke.find(x => x.id === ziel.current);
    ziel.current = null;
    if (w) oeffnen(w);
  }, [werke]);

  async function oeffnen(w) {
    offen.current = w.id;
    setWerk(w); setEntwurf({ ...w.data }); setHinweis(undefined); setFehler(undefined); setVerlauf(undefined);
    const v = await getDocs(query(collection(kuenstler, "history"), where("work", "==", w.id)));
    if (offen.current !== w.id) return;
    setVerlauf(v.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.at?.toMillis() - a.at?.toMillis()));
  }

  const geaendert = useMemo(() => werk
    ? FELDER.filter(f => (entwurf[f] ?? "") !== (werk.data[f] ?? "")) : [], [entwurf, werk]);

  /**
   * Schreibt `neu` ({ Feld: Wert }, null entfernt das Feld) mit einem
   * Verlaufseintrag; `extra` kommt in den Eintrag (etwa `rueckgaengig`).
   */
  async function schreiben(neu, extra, meldung) {
    setSpeichert(true); setFehler(undefined); setHinweis(undefined);
    const ref = doc(kuenstler, "works", werk.id);
    const eintrag = doc(collection(kuenstler, "history"));
    try {
      await runTransaction(db, async (tx) => {
        // Eine echte Konfliktprüfung ohne Sperre: Die Transaktion wiederholt sich
        // oder scheitert, wenn sich das Dokument darunter ändert, und updatedAt
        // zeigt, ob jemand gespeichert hat, seit dieses Formular geöffnet wurde.
        const jetzt = await tx.get(ref);
        if (jetzt.data().updatedAt?.toMillis() !== werk.data.updatedAt?.toMillis()) {
          throw new Error("Inzwischen von jemand anderem geändert. Bitte neu öffnen.");
        }
        const changes = Object.fromEntries(Object.entries(neu).map(([f, wert]) =>
          [f, { from: werk.data[f] ?? null, to: wert ?? null }]));
        tx.set(eintrag, { work: werk.id, by: nutzer.email, at: serverTimestamp(), changes, ...extra });
        tx.update(ref, {
          ...Object.fromEntries(Object.entries(neu).map(([f, wert]) => [f, wert ?? deleteField()])),
          updatedAt: serverTimestamp(),
          lastChange: eintrag.id,
        });
      });
      const frisch = await getDoc(ref);
      const w = { id: werk.id, data: frisch.data() };
      client.setQueryData(SCHLUESSEL.werke(gruppe), ws => ws?.map(x => x.id === w.id ? w : x));
      await oeffnen(w);
      setHinweis(meldung);
    } catch (e) {
      setFehler(e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message);
    } finally {
      setSpeichert(false);
    }
  }

  const speichern = () => schreiben(Object.fromEntries(geaendert.map(f => [f, entwurf[f]])), {},
    `Gespeichert (${geaendert.join(", ")}).`);

  /**
   * Setzt die Felder eines Verlaufseintrags auf ihren alten Wert zurück, als neue
   * Änderung (der Verlauf bleibt vollständig). Nur Felder, die seitdem niemand
   * mehr geändert hat; die anderen bleiben, wie sie sind.
   */
  function rueckgaengig(v) {
    if (v.work !== werk.id) return;
    const { zurueck, geblieben } = zuruecksetzbar(v, werk.data);
    const text = [
      "Zurücksetzen:",
      ...zurueck.map(([f, c]) => `  ${f}: „${c.to ?? "∅"}“ → „${c.from ?? "∅"}“`),
      ...(geblieben.length ? ["", "Bleibt (inzwischen erneut geändert): " + geblieben.join(", ")] : []),
    ].join("\n");
    if (!window.confirm(text)) return;
    schreiben(Object.fromEntries(zurueck.map(([f, c]) => [f, c.from])), { rueckgaengig: v.id },
      `Rückgängig gemacht (${zurueck.map(([f]) => f).join(", ")}).`);
  }

  const treffer = (werke ?? []).filter(w => {
    const q = suche.trim().toLowerCase();
    return !q || w.data.InvNr.toLowerCase().includes(q) || (w.data.Titel ?? "").toLowerCase().includes(q);
  }).slice(0, 50);

  const knopf = "px-3 py-1 border rounded disabled:opacity-40";

  return (
    <div className="space-y-4">
      {fehler && <p className="text-red-700">{fehler}</p>}
      {ladefehler && <p className="text-red-700">{ladefehler.code === "permission-denied"
        ? `Kein Zugriff mit ${nutzer.email}.` : ladefehler.message}</p>}

      {!gruppen && !ladefehler && <Skelett zeilen={1} />}
      {gruppen && (
        <select className="border p-1 w-full" value={gruppe}
                onChange={e => { setGruppe(e.target.value); setWerk(undefined); }}>
          <option value="">Werkgruppe wählen…</option>
          {gruppen.map(g => <option key={g.id} value={g.id}>{g.titel}</option>)}
        </select>
      )}

      {gruppe && !werke && !ladefehler && <Skelett />}
      {werke && !werk && (
        <>
          <input className="border p-1 w-full" placeholder="Inv. Nr. oder Titel"
                 value={suche} onChange={e => setSuche(e.target.value)} />
          <ul className="divide-y">
            {treffer.map(w => (
              <li key={w.id}>
                <button className="w-full text-left py-1 hover:bg-gray-100" onClick={() => oeffnen(w)}>
                  <span className="font-mono">{w.data.InvNr}</span> {w.data.Titel}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {werk && (
        <div className="space-y-3">
          <button className="underline text-sm" onClick={() => setWerk(undefined)}>← Zurück zur Liste</button>
          {FELDER.map(f => (
            <label key={f} className="block">
              <span className="text-sm text-gray-600">{f}</span>
              {f === "InvNr" ? (
                <input className="border p-1 w-full bg-gray-100" value={entwurf[f] ?? ""} readOnly />
              ) : LANG.includes(f) || String(entwurf[f] ?? "").length > 80 ? (
                <textarea className="border p-1 w-full" rows={3} value={entwurf[f] ?? ""}
                          onChange={e => setEntwurf({ ...entwurf, [f]: e.target.value })} />
              ) : (
                <input className="border p-1 w-full" value={entwurf[f] ?? ""}
                       onChange={e => setEntwurf({ ...entwurf, [f]: e.target.value })} />
              )}
            </label>
          ))}
          <div className="flex gap-2 items-center">
            <button className={knopf} disabled={!geaendert.length || speichert} onClick={speichern}>
              {speichert ? "Speichere…" : "Speichern"}
            </button>
            <button className={knopf} disabled={!geaendert.length || speichert}
                    onClick={() => setEntwurf({ ...werk.data })}>Verwerfen</button>
            {hinweis && <span className="text-green-700 text-sm">{hinweis}</span>}
          </div>

          <h3 className="text-lg pt-4">Verlauf</h3>
          {!verlauf && <p className="text-sm text-gray-600">Lädt…</p>}
          {verlauf?.length === 0 && <p className="text-sm text-gray-600">Noch keine Änderungen.</p>}
          <ul className="text-sm space-y-2">
            {(verlauf ?? []).map(v => {
              const kannZurueck = zuruecksetzbar(v, werk.data).zurueck.length > 0;
              const ursprung = v.rueckgaengig && verlauf.find(x => x.id === v.rueckgaengig);
              return (
                <li key={v.id}>
                  <span className="text-gray-600">{v.at?.toDate().toLocaleString("de-DE")} · {v.by}</span>
                  {v.rueckgaengig && (
                    <span className="text-gray-600">
                      {" "}· ↶ macht {ursprung ? `die Änderung vom ${ursprung.at?.toDate().toLocaleString("de-DE")}` : "eine Änderung"} rückgängig
                    </span>
                  )}
                  {v.zurueckgesetzt && <span className="text-gray-600"> · ↶ auf den veröffentlichten Stand zurückgesetzt</span>}
                  {verlauf.some(x => x.rueckgaengig === v.id) && <span className="text-gray-600"> · rückgängig gemacht</span>}
                  {" "}
                  <button className="underline disabled:no-underline disabled:opacity-40"
                          disabled={speichert || geaendert.length > 0 || !kannZurueck}
                          title={geaendert.length ? "Erst speichern oder verwerfen."
                            : !kannZurueck ? "Alle Felder wurden inzwischen erneut geändert." : undefined}
                          onClick={() => rueckgaengig(v)}>
                    Rückgängig
                  </button>
                  {Object.entries(v.changes).map(([f, c]) => (
                    <div key={f} className="pl-3">
                      <b>{f}</b>: <s className="text-gray-500">{c.from || "∅"}</s> → {c.to || "∅"}
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
