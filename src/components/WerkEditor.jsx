import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection, deleteField, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where,
} from "firebase/firestore";
import { client, SCHLUESSEL, useWerke, useWerkgruppen, zielSuchen } from "./abfragen.js";
import { useAbgleich } from "./Abgleich.jsx";
import { kuenstler, db } from "./firebaseClient.js";
import Skelett from "./Skelett.jsx";
import { useUngespeichert, verlassen } from "./ungespeichert.js";
import VerlaufListe, { wann } from "./VerlaufListe.jsx";
import { werkFeld } from "./werkFeld.js";
import Zugang from "./Zugang.jsx";

/**
 * Der Werk-Editor (Firestore): bearbeiten und anlegen (#179), eine Künstler:in.
 *
 * Wer was darf, entscheidet firestore.rules, nicht diese Datei: die Berechtigung
 * werke.bearbeiten, die Inv. Nr. bleibt, und jede Änderung muss ihren
 * Verlaufseintrag mitbringen.
 */

// Die Felder, die der Editor zeigt, in dieser Reihenfolge. Alles andere am
// Dokument (werkgruppe, images, updatedAt, lastChange, ausgeblendet) wird verwaltet, nicht bearbeitet.
const FELDER = ["InvNr", "Titel", "Werkgruppe", "Jahr", "Maße", "Material", "Technik",
  "Beschreibung", "Zustand", "Standort", "Signatur", "Auflage", "Anzahl", "Foto",
  "Ausstellung", "Literatur", "Bibliographie"];
const BEARBEITBAR = FELDER.filter(f => f !== "InvNr");
const LANG = ["Beschreibung", "Ausstellung", "Literatur", "Bibliographie", "Material"];

/**
 * Was sich von einem Verlaufseintrag zurücksetzen lässt: Felder, deren heutiger
 * Wert noch der damals gespeicherte ist. Die anderen hat jemand seitdem
 * erneut geändert; die bleiben.
 */
function zuruecksetzbar(v, daten) {
  // Die Inv. Nr. ändert sich nie; beim Anlegen steht sie mit from: null im Verlauf (#179).
  const felder = Object.entries(v.changes ?? {}).filter(([f]) => f !== "InvNr");
  const gleich = ([f, c]) => (daten[f] ?? null) === (c.to ?? null);
  return { zurueck: felder.filter(gleich), geblieben: felder.filter(x => !gleich(x)).map(([f]) => f) };
}

// Für VerlaufListe (#204): ein Eintrag mit den geänderten Feldern, und der Vergleich je Feld.
const einheitlich = v => ({ id: v.id, by: v.by, at: v.at, rueckgaengig: v.rueckgaengig, zurueckgesetzt: v.zurueckgesetzt,
  art: v.changes?.InvNr && v.changes.InvNr.from == null ? "angelegt" : "geändert",
  felder: Object.fromEntries(Object.entries(v.changes ?? {}).filter(([f]) => f !== "InvNr")
    .map(([f, c]) => [f, { von: c.from ?? null, zu: c.to ?? null }])) });
const gleich = (f, a, b) => (a ?? "") === (b ?? "");

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
  const aktuelleGruppe = useRef(gruppe);
  const setGruppe = g => { letzteGruppe = g; aktuelleGruppe.current = g; setGruppeRoh(g); };
  const { data: gruppen, error: gruppenFehler } = useWerkgruppen();
  const werkeAbfrage = useWerke(gruppe);
  const { data: werke, error: werkeFehler } = werkeAbfrage;
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
  const [alles, setAlles] = useState(false);   // im Verlauf jeden Eintrag einzeln
  const einheitliche = useMemo(() => verlauf?.map(einheitlich), [verlauf]);
  const [neu, setNeu] = useState();   // { InvNr, Titel }, solange das Formular für ein neues Werk offen ist

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
  useEffect(() => zielSuchen(ziel, werkeAbfrage, ws => ws.find(x => x.id === ziel.current), oeffnen),
    [werke, werkeAbfrage.isFetching]);

  async function oeffnen(w) {
    offen.current = w.id;
    setWerk(w); setEntwurf({ ...w.data }); setHinweis(undefined); setFehler(undefined); setVerlauf(undefined);
    const v = await getDocs(query(collection(kuenstler, "history"), where("work", "==", w.id)));
    if (offen.current !== w.id) return;
    setVerlauf(v.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.at?.toMillis() - a.at?.toMillis()));
  }

  const geaendert = useMemo(() => werk
    ? FELDER.filter(f => (entwurf[f] ?? "") !== (werk.data[f] ?? "")) : [], [entwurf, werk]);
  // Entwurf im Browser, Speichern anderer live, Zusammenführen (#203).
  const abgleich = useAbgleich({
    art: "werk", id: werk?.id, ich: nutzer.email, aktiv: !!werk, ref: werk ? doc(kuenstler, "works", werk.id) : null,
    felder: BEARBEITBAR, gleich,
    stand: werk?.data ?? {},
    entwurf: useMemo(() => Object.fromEntries(BEARBEITBAR.map(f => [f, entwurf[f] ?? null])), [entwurf]),
    geaendert: geaendert.length > 0,
    uebernehmen: (d, e) => {
      const w = { id: werk.id, data: d };
      client.setQueryData(SCHLUESSEL.werke(gruppe), ws => ws?.map(x => x.id === w.id ? w : x));
      oeffnen(w);
      if (e) setEntwurf({ ...d, ...e });
    },
    setzeFeld: (f, v) => setEntwurf(e => ({ ...e, [f]: v })),
    wer: async l => (await getDoc(doc(collection(kuenstler, "history"), l))).get("by"),
  });
  useUngespeichert(geaendert.length > 0 || !!(neu && (neu.InvNr.trim() || neu.Titel.trim())));

  /**
   * Schreibt `neu` ({ Feld: Wert }, null entfernt das Feld) mit einem
   * Verlaufseintrag; `extra` kommt in den Eintrag (etwa `rueckgaengig`).
   * `pruefen: false` für Felder außerhalb des Formulars (ausgeblendet): kein
   * Konflikt mit fremdem Speichern, der Verlauf nimmt den Wert davor vom Server.
   */
  async function schreiben(neu, extra, meldung, { pruefen = true } = {}) {
    setSpeichert(true); setFehler(undefined); setHinweis(undefined);
    const ref = doc(kuenstler, "works", werk.id);
    const eintrag = doc(collection(kuenstler, "history"));
    abgleich.eigene.current.add(eintrag.id);
    try {
      await runTransaction(db, async (tx) => {
        // Eine echte Konfliktprüfung ohne Sperre: Die Transaktion wiederholt sich
        // oder scheitert, wenn sich das Dokument darunter ändert, und updatedAt
        // zeigt, ob jemand gespeichert hat, seit dieses Formular geöffnet wurde.
        const jetzt = await tx.get(ref);
        if (pruefen && jetzt.data()?.updatedAt?.toMillis() !== werk.data.updatedAt?.toMillis()) {
          throw Object.assign(new Error("Inzwischen woanders gespeichert."), { code: "konflikt" });
        }
        const davor = pruefen ? werk.data : jetzt.data() ?? {};
        // Ohne Prüfung nur, was sich auf dem Server wirklich ändert.
        const felder = Object.entries(neu).filter(([f, wert]) => pruefen || (davor[f] ?? null) !== (wert ?? null));
        if (!felder.length) return;
        const changes = Object.fromEntries(felder.map(([f, wert]) =>
          [f, { from: davor[f] ?? null, to: wert ?? null }]));
        tx.set(eintrag, { work: werk.id, by: nutzer.email, at: serverTimestamp(), changes, ...extra });
        tx.update(ref, {
          ...Object.fromEntries(felder.map(([f, wert]) => [f, wert ?? deleteField()])),
          updatedAt: serverTimestamp(),
          lastChange: eintrag.id,
        });
      });
      const frisch = await getDoc(ref);
      const w = { id: werk.id, data: frisch.data() };
      client.setQueryData(SCHLUESSEL.werke(gruppe), ws => ws?.map(x => x.id === w.id ? w : x));
      await oeffnen(w);
      setHinweis(meldung); abgleich.gespeichert();
    } catch (e) {
      if (e.code === "konflikt") await abgleich.nachKonflikt({ ruecknahme: !!extra.rueckgaengig }).catch(e => setFehler(e.message));
      else setFehler(e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message);
    } finally {
      setSpeichert(false);
    }
  }

  /**
   * Legt ein Werk in der gewählten Werkgruppe an, mit Verlaufseintrag wie jede
   * Änderung. Die Kennung kommt aus der Inv. Nr., wie beim Import (catalog.ts).
   */
  async function anlegen() {
    const invNr = neu.InvNr.trim(), titel = neu.Titel.trim();
    // Wie die Regeln: Kennung = Inv. Nr. klein; dann stimmt sie auch mit slugify (catalog.ts).
    // Bindestriche nur einzeln und innen: slugify fasst sie sonst zusammen oder kürzt sie.
    if (invNr.length > 100 || !/^[A-Za-z0-9.]+(-[A-Za-z0-9.]+)*$/.test(invNr)) {
      setFehler("Die Inv. Nr. darf nur Buchstaben, Ziffern, Punkt und einzelne Bindestriche (nicht am Anfang oder Ende) enthalten.");
      return;
    }
    const id = invNr.toLowerCase();
    // Wohin die Ansicht während des Anlegens wechselt, soll nicht überschrieben werden.
    const startGruppe = gruppe, startOffen = offen.current;
    setSpeichert(true); setFehler(undefined); setHinweis(undefined);
    const ref = doc(kuenstler, "works", id);
    const eintrag = doc(collection(kuenstler, "history"));
    const felder = { InvNr: invNr, ...(titel && { Titel: titel }) };
    try {
      await runTransaction(db, async (tx) => {
        const da = await tx.get(ref);
        // Auch ausgeblendete Werke behalten ihre Inv. Nr. (#181).
        if (da.exists()) throw new Error(`Die Inv. Nr. „${invNr}“ gibt es schon`
          + (da.get("ausgeblendet") ? ` (ausgeblendet, in der Werkgruppe ${da.get("werkgruppe")}).` : "."));
        tx.set(eintrag, { work: id, by: nutzer.email, at: serverTimestamp(),
          changes: Object.fromEntries(Object.entries(felder).map(([f, wert]) => [f, { from: null, to: wert }])) });
        tx.set(ref, { ...felder, werkgruppe: gruppe, updatedAt: serverTimestamp(), lastChange: eintrag.id });
      });
      const w = { id, data: (await getDoc(ref)).data() };
      client.invalidateQueries({ queryKey: SCHLUESSEL.werke(gruppe) });
      setNeu(undefined);
      if (aktuelleGruppe.current === startGruppe && offen.current === startOffen) await oeffnen(w);
      setHinweis(`Angelegt (${invNr}).`);
    } catch (e) {
      setFehler(e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message);
    } finally {
      setSpeichert(false);
    }
  }

  const speichern = () => schreiben(Object.fromEntries(geaendert.map(f => [f, entwurf[f]])), {},
    `Gespeichert (${geaendert.join(", ")}).`);

  /**
   * Ausblenden statt löschen (#181): Das Werk bleibt mit Inv. Nr., Bildern und
   * Verlauf in der Verwaltung, die Website zeigt es nach der nächsten
   * Veröffentlichung nicht mehr. Steht im Verlauf und lässt sich zurücknehmen.
   */
  function ausblenden(an) {
    if (an && !window.confirm(`Werk ${werk.data.InvNr} auf der Website ausblenden?\n\n`
      + "Es bleibt in der Verwaltung und lässt sich wieder einblenden. Von der Website verschwindet es mit der nächsten Veröffentlichung; "
      + "Links darauf, etwa in Seitentexten, führen dann ins Leere. Die Bilder bleiben unter ihren Adressen erreichbar.")) return;
    schreiben({ ausgeblendet: an || null }, {}, an ? "Ausgeblendet; von der Website verschwindet es mit der nächsten Veröffentlichung."
      : "Eingeblendet; auf der Website erscheint es mit der nächsten Veröffentlichung.", { pruefen: false });
  }

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

  /** Felder einer Gruppe aus VerlaufListe auf den Stand davor (#204). */
  function zuruecknehmen(g, felder) {
    const text = felder.map(f => `  ${f}: „${g.felder[f].zu ?? "∅"}“ → „${g.felder[f].von ?? "∅"}“`);
    if (!window.confirm(["Zurücksetzen:", ...text].join("\n"))) return;
    schreiben(Object.fromEntries(felder.map(f => [f, g.felder[f].von])), { rueckgaengig: g.ids[0] },
      `Zurückgenommen (${felder.join(", ")}).`);
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
        <select className="border p-1 w-full" value={gruppe} disabled={speichert}
                onChange={e => { if (verlassen()) { setGruppe(e.target.value); setWerk(undefined); setNeu(undefined); } }}>
          <option value="">Werkgruppe wählen…</option>
          {gruppen.map(g => <option key={g.id} value={g.id}>{g.titel}</option>)}
        </select>
      )}

      {gruppe && !werke && !ladefehler && <Skelett />}
      {werke && !werk && (
        <>
          {neu ? (
            <div className="flex gap-2 flex-wrap items-center">
              <input className="border p-1 w-32" placeholder="Inv. Nr." autoFocus value={neu.InvNr}
                     onChange={e => setNeu({ ...neu, InvNr: e.target.value })} />
              <input className="border p-1 flex-1 min-w-40" placeholder="Titel" value={neu.Titel}
                     onChange={e => setNeu({ ...neu, Titel: e.target.value })}
                     onKeyDown={e => e.key === "Enter" && neu.InvNr.trim() && anlegen()} />
              <button className={knopf} disabled={speichert || !neu.InvNr.trim()} onClick={anlegen}>
                {speichert ? "Lege an…" : "Anlegen"}
              </button>
              <button className={knopf} disabled={speichert} onClick={() => setNeu(undefined)}>Abbrechen</button>
            </div>
          ) : (
            <button className={knopf} onClick={() => { setNeu({ InvNr: "", Titel: "" }); setFehler(undefined); }}>Neues Werk</button>
          )}
          {werke.length === 0 && !neu && <p className="text-sm text-gray-600">Noch keine Werke in dieser Werkgruppe.</p>}
          <input className="border p-1 w-full" placeholder="Inv. Nr. oder Titel"
                 value={suche} onChange={e => setSuche(e.target.value)} />
          <ul className="divide-y">
            {treffer.map(w => (
              <li key={w.id}>
                <button className="w-full text-left py-1 hover:bg-gray-100" onClick={() => verlassen() && (setNeu(undefined), oeffnen(w))}>
                  <span className={w.data.ausgeblendet ? "text-gray-500" : ""}>
                    <span className="font-mono">{w.data.InvNr}</span> {w.data.Titel}
                    {w.data.ausgeblendet && <span className="text-sm"> · ausgeblendet</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {werk && (
        <div className="space-y-3">
          {/* Gesperrt während des Speicherns: danach öffnet schreiben() das Werk neu (#213). */}
          <button className="underline text-sm disabled:opacity-40" disabled={speichert}
                  onClick={() => verlassen() && setWerk(undefined)}>← Zurück zur Liste</button>
          {abgleich.hinweise}
          {werk.data.ausgeblendet && (
            <p className="border border-gray-400 bg-gray-100 rounded p-2 text-sm">Ausgeblendet: steht nicht auf der Website.</p>
          )}
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
            <button className={knopf} disabled={!geaendert.length || speichert || abgleich.konflikte.length > 0} onClick={speichern}>
              {speichert ? "Speichere…" : "Speichern"}
            </button>
            <button className={knopf} disabled={!geaendert.length || speichert}
                    onClick={() => { setEntwurf({ ...werk.data }); abgleich.verworfen(); }}>Verwerfen</button>
            {hinweis && <span className="text-green-700 text-sm">{hinweis}</span>}
            <button className={knopf + " ml-auto"} disabled={speichert || geaendert.length > 0}
                    title={geaendert.length ? "Erst speichern oder verwerfen." : undefined}
                    onClick={() => ausblenden(!werk.data.ausgeblendet)}>
              {werk.data.ausgeblendet ? "Einblenden" : "Ausblenden"}
            </button>
          </div>

          <div className="flex gap-2 items-baseline pt-4">
            <h3 className="text-lg flex-1">Verlauf</h3>
            {verlauf?.length > 0 && <button className="underline text-sm" onClick={() => setAlles(!alles)}>
              {alles ? "Zusammengefasst zeigen" : "Alles zeigen"}</button>}
          </div>
          {!verlauf && <p className="text-sm text-gray-600">Lädt…</p>}
          {verlauf?.length === 0 && <p className="text-sm text-gray-600">Noch keine Änderungen.</p>}
          {verlauf?.length > 0 && !alles && (
            <VerlaufListe eintraege={einheitliche} ist={werk.data} gleich={gleich} name={werkFeld}
                          lang={f => LANG.includes(f)} bearbeitbar zuruecknehmen={zuruecknehmen}
                          gesperrt={speichert ? "Speichert…" : geaendert.length ? "Erst speichern oder verwerfen." : undefined} />
          )}
          {alles && <ul className="text-sm space-y-2">
            {(verlauf ?? []).map(v => {
              const kannZurueck = zuruecksetzbar(v, werk.data).zurueck.length > 0;
              const ursprung = v.rueckgaengig && verlauf.find(x => x.id === v.rueckgaengig);
              return (
                <li key={v.id}>
                  <span className="text-gray-600">{wann(v.at)} · {v.by}</span>
                  {v.rueckgaengig && (
                    <span className="text-gray-600">
                      {" "}· ↶ macht {ursprung ? `die Änderung vom ${wann(ursprung.at)}` : "eine Änderung"} rückgängig
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
          </ul>}
        </div>
      )}
    </div>
  );
}
