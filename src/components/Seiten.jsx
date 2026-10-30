import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { slugify } from "../werkverzeichnis/slugify";
import { darf } from "../werkverzeichnis/permissions.js";
import { useQuery } from "@tanstack/react-query";
import { client, SCHLUESSEL, zielSuchen } from "./abfragen.js";
import { db, KUENSTLER } from "./firebaseClient.js";
import Skelett from "./Skelett.jsx";
import { useUngespeichert, verlassen } from "./ungespeichert.js";
import VerlaufListe, { wann } from "./VerlaufListe.jsx";
import Zugang from "./Zugang.jsx";
import { seitenUnterschiede, SEITENFELDER } from "./Veroeffentlichen.jsx";

// Der Editor ist groß; erst laden, wenn eine Seite geöffnet wird.
const MarkdownEditor = lazy(() => import("./MarkdownEditor.jsx"));

/**
 * Die Inhaltsseiten (Einführung, Impressum, …) einer Künstler:in: eine Liste und
 * ein Formular mit dem Markdown-Editor. firestore.rules setzt die Berechtigung
 * `seiten.bearbeiten` durch. Jedes Speichern und Löschen schreibt einen Eintrag
 * in `seitenverlauf` mit der ganzen Fassung davor und danach (#41); daraus
 * kommen frühere Fassungen und gelöschte Seiten zurück.
 */
const KATEGORIEN = { Header: "Kopfzeile", Footer: "Fußzeile" };
const knopf = "px-3 py-1 border rounded disabled:opacity-40";
const zuKennung = s => slugify(s, { lower: true }).replace(/[^a-z0-9-]/g, "").slice(0, 60);
const meldung = e => e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message;
const ordnung = (a, b) => a.kategorie.localeCompare(b.kategorie) * -1 || a.reihenfolge - b.reihenfolge;
const fassung = ({ titel, kategorie, reihenfolge, text }) => ({ titel, kategorie, reihenfolge, text });
const alsZahl = f => ({ ...f, reihenfolge: Number(f.reihenfolge) });
// Für VerlaufListe: ein Eintrag mit den geänderten Feldern, und der Vergleich je Feld.
const einheitlich = e => ({ id: e.id, by: e.by, at: e.at, rueckgaengig: e.rueckgaengig,
  art: !e.vorher ? "angelegt" : !e.nachher ? "gelöscht" : "geändert",
  felder: e.vorher && e.nachher
    ? Object.fromEntries(seitenUnterschiede(e.vorher, e.nachher).map(k => [k, { von: e.vorher[k], zu: e.nachher[k] }])) : {} });
const gleich = (k, a, b) => !seitenUnterschiede({ [k]: a }, { [k]: b }).length;
const neuesteZuerst = (a, b) => (b.at?.toMillis() ?? 0) - (a.at?.toMillis() ?? 0);

export default function SeitenSeite() {
  return <Zugang berechtigung="seiten.bearbeiten" kinder={({ nutzer, wer }) =>
    <Seiten kuenstlerId={KUENSTLER} ich={nutzer.email} bearbeitbar={darf(wer, "seiten.bearbeiten")} />} />;
}

function Seiten({ kuenstlerId, ich, bearbeitbar }) {
  const sammlung = collection(db, "artists", kuenstlerId, "seiten");
  const verlauf = collection(db, "artists", kuenstlerId, "seitenverlauf");
  // seiten: die Seiten; geloescht: je gelöschte Seite der letzte Löscheintrag.
  const abfrage = useQuery({
    queryKey: SCHLUESSEL.seiten,
    queryFn: async () => {
      const [snap, weg] = await Promise.all([getDocs(sammlung), getDocs(query(verlauf, where("nachher", "==", null)))]);
      const seiten = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(ordnung);
      const geloescht = weg.docs.map(d => ({ id: d.id, ...d.data() })).sort(neuesteZuerst)
        .filter((e, i, alle) => !seiten.some(s => s.id === e.seite) && alle.findIndex(x => x.seite === e.seite) === i);
      return { seiten, geloescht };
    },
  });
  const { data, error } = abfrage;
  const seiten = data?.seiten;
  const geloescht = data?.geloescht ?? [];
  const fehler = error && meldung(error);
  const [offen, setOffen] = useState();   // eine Seite, oder { id: "" } für eine neue
  const laden = () => client.invalidateQueries({ queryKey: SCHLUESSEL.seiten });

  // ?seite=<Kennung> (aus der Werkzeugleiste) öffnet diese Seite direkt, einmal.
  const ziel = useRef(new URLSearchParams(location.search).get("seite"));
  useEffect(() => zielSuchen(ziel, abfrage, d => d.seiten.find(x => x.id === ziel.current), setOffen),
    [seiten, abfrage.isFetching]);

  if (offen) return (
    <Seite sammlung={sammlung} verlauf={verlauf} ich={ich} seite={offen} bearbeitbar={bearbeitbar} seiten={seiten}
           onSchliessen={() => { setOffen(undefined); laden(); }} />
  );

  return (
    <div className="space-y-2">
      {fehler && <p className="text-red-700 text-sm">{fehler}</p>}
      {!seiten && !fehler && <Skelett />}
      <ul className="divide-y text-sm">
        {(seiten ?? []).map(s => (
          <li key={s.id}>
            <button className="w-full text-left py-1 hover:bg-gray-100" onClick={() => setOffen(s)}>
              {s.titel}
              <span className="text-gray-600"> · {KATEGORIEN[s.kategorie]} {s.reihenfolge}</span>
            </button>
          </li>
        ))}
      </ul>
      {bearbeitbar && <button className={knopf} onClick={() => setOffen({ id: "" })}>Neue Seite</button>}
      {bearbeitbar && geloescht.length > 0 && (
        <div className="pt-4">
          <h3 className="font-bold text-sm">Gelöschte Seiten</h3>
          <ul className="divide-y text-sm">
            {geloescht.map(e => (
              <li key={e.id} className="py-1 flex gap-2 items-center flex-wrap">
                <span className="flex-1">
                  {e.vorher?.titel ?? e.seite}
                  <span className="text-gray-600"> · gelöscht {wann(e.at)} von {e.by}</span>
                </span>
                <button className={knopf} onClick={() => setOffen({ id: "", wiederherstellen: { id: e.seite, ...e.vorher } })}>
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

function Seite({ sammlung, verlauf, ich, seite, bearbeitbar, seiten, onSchliessen }) {
  const istNeu = seite.id === "";
  const alt = seite.wiederherstellen;   // eine gelöschte Seite, mit ihrer Kennung
  const [entwurf, setEntwurf] = useState(() => alt ? fassung(alt)
    : istNeu ? { titel: "", kategorie: "Header", text: "",
        reihenfolge: Math.max(0, ...seiten.filter(s => s.kategorie === "Header").map(s => s.reihenfolge)) + 1 }
    : fassung(seite));
  const [geladen, setGeladen] = useState(0);   // zählt geladene Fassungen; der Editor liest sein Markdown nur einmal
  const [geladenAm, setGeladenAm] = useState(seite.updatedAt);
  // Die gespeicherte Fassung, gegen die das Formular als geändert gilt.
  const [gespeichert, setGespeichert] = useState(() => istNeu ? null : fassung(seite));
  const geaendert = !gespeichert || seitenUnterschiede(alsZahl(entwurf), gespeichert).length > 0;
  // Zum Warnen: Eine neue Seite ist erst ungespeichert, wenn etwas eingetragen ist.
  const anfang = useRef(entwurf);
  useUngespeichert(bearbeitbar && (gespeichert ? geaendert : seitenUnterschiede(alsZahl(entwurf), alsZahl(anfang.current)).length > 0));
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState();
  const [hinweis, setHinweis] = useState();
  const setze = (k, v) => setEntwurf(e => ({ ...e, [k]: v }));
  const aktuellerEntwurf = useRef(entwurf);   // für Schreibvorgänge, die länger dauern
  aktuellerEntwurf.current = entwurf;
  const id = alt ? alt.id : istNeu ? zuKennung(entwurf.titel) : seite.id;

  // Frühere Fassungen dieser Seite, neueste zuerst.
  const [eintraege, setEintraege] = useState();
  async function verlaufLaden() {
    const snap = await getDocs(query(verlauf, where("seite", "==", seite.id)));
    setEintraege(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(neuesteZuerst));
  }
  useEffect(() => { if (!istNeu) verlaufLaden().catch(e => setFehler(meldung(e))); }, [seite.id]);

  function fassungLaden(f, t) {
    setEntwurf(fassung(f));
    setGeladen(n => n + 1);
    setFehler(undefined);
    setHinweis(`Fassung vom ${wann(t)} geladen; Speichern stellt sie wieder her.`);
  }

  function verwerfen() {
    setEntwurf(gespeichert);
    setGeladen(n => n + 1);
    setFehler(undefined); setHinweis(undefined);
  }

  const speichern = () =>
    schreiben(fassung({ ...entwurf, reihenfolge: Math.trunc(Number(entwurf.reihenfolge)) }), {}, "Gespeichert.");

  /**
   * Schreibt die Fassung `neu` mit einem Verlaufseintrag; `extra` kommt in den
   * Eintrag (etwa `rueckgaengig`).
   */
  async function schreiben(neu, extra, text) {
    const start = entwurf;
    setSpeichert(true); setFehler(undefined); setHinweis(undefined);
    const ref = doc(sammlung, id);
    const eintrag = doc(verlauf);
    try {
      await runTransaction(db, async tx => {
        const jetzt = await tx.get(ref);
        if (istNeu && jetzt.exists()) throw new Error(`„${id}“ gibt es schon.`);
        // Jemand anderes hat gespeichert, seit dieses Formular geöffnet wurde.
        if (!istNeu && jetzt.data()?.updatedAt?.toMillis() !== geladenAm?.toMillis()) {
          throw new Error("Inzwischen von jemand anderem geändert. Bitte neu öffnen.");
        }
        tx.set(eintrag, { seite: id, by: ich, at: serverTimestamp(),
          vorher: jetzt.exists() ? fassung(jetzt.data()) : null, nachher: neu, ...extra });
        tx.set(ref, { ...neu, updatedAt: serverTimestamp(), lastChange: eintrag.id });
      });
      if (istNeu) return onSchliessen();
      client.invalidateQueries({ queryKey: SCHLUESSEL.seiten });
      const frisch = (await getDoc(ref)).data();
      setGeladenAm(frisch.updatedAt);
      setGespeichert(neu);
      // Das Formular zeigt danach die neue Fassung, außer jemand hat inzwischen
      // darin weitergearbeitet; dann bleibt das und gilt als ungespeichert.
      if (extra.rueckgaengig && aktuellerEntwurf.current === start) { setEntwurf(neu); setGeladen(n => n + 1); }
      setHinweis(text);
      await verlaufLaden();
    } catch (e) {
      setFehler(meldung(e));
    } finally {
      setSpeichert(false);
    }
  }

  /**
   * Nimmt einen Verlaufseintrag zurück, als neue Änderung (der Verlauf bleibt
   * vollständig), wie bei Werken: nur Felder, die seitdem niemand mehr geändert
   * hat; die anderen bleiben, wie sie sind.
   */
  function rueckgaengig(e) {
    const { zurueck, geblieben } = zuruecksetzbar(e, gespeichert);
    const text = [
      "Zurücksetzen:",
      ...zurueck.map(k => k === "text" ? "  Text: auf die Fassung davor"
        : `  ${SEITENFELDER[k]}: „${e.nachher[k]}“ → „${e.vorher[k]}“`),
      ...(geblieben.length ? ["", "Bleibt (inzwischen erneut geändert): " + geblieben.map(k => SEITENFELDER[k]).join(", ")] : []),
    ].join("\n");
    if (!window.confirm(text)) return;
    const neu = { ...gespeichert, ...Object.fromEntries(zurueck.map(k => [k, e.vorher[k]])) };
    schreiben(neu, { rueckgaengig: e.id }, `Rückgängig gemacht (${zurueck.map(k => SEITENFELDER[k]).join(", ")}).`);
  }

  /** Felder einer Gruppe aus VerlaufListe auf den Stand davor (#204). */
  function zuruecknehmen(g, felder) {
    const text = felder.map(k => k === "text" ? "  Text: auf den Stand davor"
      : `  ${SEITENFELDER[k]}: „${g.felder[k].zu}“ → „${g.felder[k].von}“`);
    if (!window.confirm(["Zurücksetzen:", ...text].join("\n"))) return;
    schreiben({ ...gespeichert, ...Object.fromEntries(felder.map(k => [k, g.felder[k].von])) }, { rueckgaengig: g.ids[0] },
      `Zurückgenommen (${felder.map(k => SEITENFELDER[k]).join(", ")}).`);
  }

  async function loeschen() {
    if (!confirm(`Die ganze Seite „${seite.titel}“ löschen? Sie verschwindet beim nächsten Veröffentlichen `
      + "von der Website; unter „Gelöschte Seiten“ lässt sie sich wiederherstellen.")) return;
    const ref = doc(sammlung, seite.id);
    try {
      await runTransaction(db, async tx => {
        const jetzt = await tx.get(ref);
        if (!jetzt.exists()) return;
        // Feste Kennung, damit die Regeln den Eintrag zum Löschen finden.
        const eintrag = doc(verlauf, "geloescht-" + (jetzt.get("lastChange") ?? seite.id));
        tx.set(eintrag, { seite: seite.id, by: ich, at: serverTimestamp(), vorher: fassung(jetzt.data()), nachher: null });
        tx.delete(ref);
      });
      onSchliessen();
    } catch (e) {
      setFehler(meldung(e));
    }
  }

  const feld = "border p-1 disabled:bg-gray-100";
  return (
    <div className="pt-4 space-y-3">
      <button className="underline text-sm" onClick={() => verlassen() && onSchliessen()}>← Zurück zu den Seiten</button>
      <div className="flex gap-2 flex-wrap items-end">
        <label className="flex-1 min-w-[12rem]">
          <span className="block text-sm text-gray-600">Titel</span>
          <input className={feld + " w-full"} value={entwurf.titel} disabled={!bearbeitbar}
                 onChange={e => setze("titel", e.target.value)} />
        </label>
        <label>
          <span className="block text-sm text-gray-600">Ort</span>
          <select className={feld} value={entwurf.kategorie} disabled={!bearbeitbar}
                  onChange={e => setze("kategorie", e.target.value)}>
            {Object.entries(KATEGORIEN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label>
          <span className="block text-sm text-gray-600">Reihe</span>
          <input type="number" className={feld + " w-16"} value={entwurf.reihenfolge} disabled={!bearbeitbar}
                 onChange={e => setze("reihenfolge", e.target.value)} />
        </label>
      </div>
      {istNeu && <p className="text-xs text-gray-600 font-mono">/allgemein/{id || "…"}</p>}
      {alt && <p className="text-sm">Gelöschte Seite; „Anlegen“ stellt sie unter derselben Adresse wieder her.</p>}

      <Suspense fallback={<p className="text-sm text-gray-600">Editor wird geladen…</p>}>
        <MarkdownEditor key={`${seite.id}-${geladen}`} markdown={entwurf.text} nurLesen={!bearbeitbar}
                        onAenderung={text => setze("text", text)} />
      </Suspense>

      {bearbeitbar && (
        <div className="flex gap-2 items-center">
          <button className={knopf} disabled={speichert || !geaendert || !entwurf.titel.trim() || !id} onClick={speichern}>
            {speichert ? "Speichere…" : istNeu ? "Anlegen" : "Speichern"}
          </button>
          {gespeichert && <button className={knopf} disabled={speichert || !geaendert} onClick={verwerfen}>Verwerfen</button>}
          {hinweis && <span className="text-green-700 text-sm">{hinweis}</span>}
          {fehler && <span className="text-red-700 text-sm">{fehler}</span>}
        </div>
      )}
      {!bearbeitbar && fehler && <p className="text-red-700 text-sm">{fehler}</p>}

      {!istNeu && <Fassungen eintraege={eintraege} bearbeitbar={bearbeitbar} laden={fassungLaden}
                             gespeichert={gespeichert} gesperrt={speichert || geaendert} rueckgaengig={rueckgaengig}
                             zuruecknehmen={zuruecknehmen}
                             sperrGrund={speichert ? "Speichert…" : geaendert ? "Erst speichern oder verwerfen." : undefined} />}

      {bearbeitbar && !istNeu && (
        <div className="pt-6 mt-6 border-t">
          <button className={knopf + " border-red-700 text-red-700"} disabled={speichert} onClick={loeschen}>Seite löschen</button>
        </div>
      )}
    </div>
  );
}

/**
 * Welche Felder eines Verlaufseintrags sich zurücknehmen lassen: geändert im
 * Eintrag und seitdem unverändert (`ist` ist die gespeicherte Fassung).
 */
function zuruecksetzbar(e, ist) {
  if (!e.vorher || !e.nachher || !ist) return { zurueck: [], geblieben: [] };
  const seitdem = seitenUnterschiede(ist, e.nachher);
  const felder = seitenUnterschiede(e.vorher, e.nachher);
  return { zurueck: felder.filter(k => !seitdem.includes(k)), geblieben: felder.filter(k => seitdem.includes(k)) };
}

/**
 * Der Verlauf einer Seite, wie bei Werken: wann, wer, was sich geändert hat, mit
 * „Rückgängig“ je Eintrag (#133); jede Fassung lässt sich auch ganz ins Formular
 * laden. Ganz unten der Stand vor dem ersten Eintrag, falls die Seite älter ist
 * als der Verlauf.
 */
function Fassungen({ eintraege, bearbeitbar, laden, gespeichert, gesperrt, rueckgaengig, zuruecknehmen, sperrGrund }) {
  const [alles, setAlles] = useState(false);
  const einheitliche = useMemo(() => eintraege?.map(einheitlich), [eintraege]);
  if (!eintraege) return <p className="text-sm text-gray-600">Verlauf lädt…</p>;
  const aeltester = eintraege.at(-1);
  return (
    <div className="pt-4">
      <div className="flex gap-2 items-baseline">
        <h3 className="font-bold text-sm flex-1">Verlauf</h3>
        {eintraege.length > 0 && <button className="underline text-sm" onClick={() => setAlles(!alles)}>
          {alles ? "Zusammengefasst zeigen" : "Alles zeigen"}</button>}
      </div>
      {!eintraege.length ? <p className="text-sm text-gray-600">Noch keine Änderungen; der Verlauf beginnt mit dem nächsten Speichern.</p>
      : !alles ? (
        <VerlaufListe eintraege={einheitliche} ist={gespeichert} gleich={gleich} name={k => SEITENFELDER[k]}
                      lang={k => k === "text"} bearbeitbar={bearbeitbar} zuruecknehmen={zuruecknehmen}
                      gesperrt={sperrGrund} />
      ) : (
        <ul className="divide-y text-sm">
          {eintraege.map((e, i) => {
            const felder = e.vorher && e.nachher ? seitenUnterschiede(e.vorher, e.nachher) : [];
            const kannZurueck = zuruecksetzbar(e, gespeichert).zurueck.length > 0;
            const ursprung = e.rueckgaengig && eintraege.find(x => x.id === e.rueckgaengig);
            return (
              <li key={e.id} className="py-1.5 space-y-0.5">
                <div className="flex gap-2 items-center flex-wrap">
                  <span className="flex-1">
                    <span className="text-gray-600">{wann(e.at)} · {e.by}</span>
                    {" "}· {!e.vorher ? "angelegt" : !e.nachher ? "gelöscht"
                      : felder.map(k => SEITENFELDER[k]).join(", ") || "nichts geändert"}
                    {i === 0 && e.nachher && <span className="text-gray-600"> (aktuell)</span>}
                    {e.rueckgaengig && <span className="text-gray-600">
                      {" "}· ↶ macht {ursprung ? `die Änderung vom ${wann(ursprung.at)}` : "eine Änderung"} rückgängig</span>}
                    {eintraege.some(x => x.rueckgaengig === e.id) && <span className="text-gray-600"> · rückgängig gemacht</span>}
                  </span>
                  {bearbeitbar && felder.length > 0 && (
                    <button className={knopf} disabled={gesperrt || !kannZurueck}
                            title={gesperrt ? "Erst speichern oder verwerfen."
                              : !kannZurueck ? "Alle Felder wurden inzwischen erneut geändert." : undefined}
                            onClick={() => rueckgaengig(e)}>Rückgängig</button>
                  )}
                  {bearbeitbar && e.nachher && i > 0 && (
                    <button className={knopf} onClick={() => laden(e.nachher, e.at)}>Laden</button>
                  )}
                </div>
                {felder.filter(k => k !== "text").map(k => (
                  <div key={k} className="pl-3">
                    <b>{SEITENFELDER[k]}</b>: <s className="text-gray-500">{String(e.vorher[k] ?? "∅")}</s> → {String(e.nachher[k] ?? "∅")}
                  </div>
                ))}
              </li>
            );
          })}
          {aeltester?.vorher && (
            <li className="py-1 flex gap-2 items-center flex-wrap">
              <span className="flex-1 text-gray-600">Stand vor dem {wann(aeltester.at)}</span>
              {bearbeitbar && <button className={knopf} onClick={() => laden(aeltester.vorher, aeltester.at)}>Laden</button>}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
