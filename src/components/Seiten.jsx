import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { slugify } from "../werkverzeichnis/slugify";
import { darf } from "../werkverzeichnis/permissions.js";
import { useQuery } from "@tanstack/react-query";
import { client, SCHLUESSEL } from "./abfragen.js";
import { db, KUENSTLER } from "./firebaseClient.js";
import Skelett from "./Skelett.jsx";
import Zugang from "./Zugang.jsx";

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
const neuesteZuerst = (a, b) => (b.at?.toMillis() ?? 0) - (a.at?.toMillis() ?? 0);
const wann = t => t?.toDate().toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) ?? "gerade eben";
const FELDER = { titel: "Titel", kategorie: "Ort", reihenfolge: "Reihe", text: "Text" };

export default function SeitenSeite() {
  return <Zugang berechtigung="seiten.bearbeiten" kinder={({ nutzer, wer }) =>
    <Seiten kuenstlerId={KUENSTLER} ich={nutzer.email} bearbeitbar={darf(wer, "seiten.bearbeiten")} />} />;
}

function Seiten({ kuenstlerId, ich, bearbeitbar }) {
  const sammlung = collection(db, "artists", kuenstlerId, "seiten");
  const verlauf = collection(db, "artists", kuenstlerId, "seitenverlauf");
  // seiten: die Seiten; geloescht: je gelöschte Seite der letzte Löscheintrag.
  const { data, error } = useQuery({
    queryKey: SCHLUESSEL.seiten,
    queryFn: async () => {
      const [snap, weg] = await Promise.all([getDocs(sammlung), getDocs(query(verlauf, where("nachher", "==", null)))]);
      const seiten = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(ordnung);
      const geloescht = weg.docs.map(d => ({ id: d.id, ...d.data() })).sort(neuesteZuerst)
        .filter((e, i, alle) => !seiten.some(s => s.id === e.seite) && alle.findIndex(x => x.seite === e.seite) === i);
      return { seiten, geloescht };
    },
  });
  const seiten = data?.seiten;
  const geloescht = data?.geloescht ?? [];
  const fehler = error && meldung(error);
  const [offen, setOffen] = useState();   // eine Seite, oder { id: "" } für eine neue
  const laden = () => client.invalidateQueries({ queryKey: SCHLUESSEL.seiten });

  // ?seite=<Kennung> (aus der Werkzeugleiste) öffnet diese Seite direkt, einmal.
  const ziel = useRef(new URLSearchParams(location.search).get("seite"));
  useEffect(() => {
    if (!ziel.current || !seiten) return;
    const s = seiten.find(x => x.id === ziel.current);
    ziel.current = null;
    if (s) setOffen(s);
  }, [seiten]);

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
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState();
  const [hinweis, setHinweis] = useState();
  const setze = (k, v) => setEntwurf(e => ({ ...e, [k]: v }));
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

  async function speichern() {
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
        const neu = fassung({ ...entwurf, reihenfolge: Math.trunc(Number(entwurf.reihenfolge)) });
        tx.set(eintrag, { seite: id, by: ich, at: serverTimestamp(),
          vorher: jetzt.exists() ? fassung(jetzt.data()) : null, nachher: neu });
        tx.set(ref, { ...neu, updatedAt: serverTimestamp(), lastChange: eintrag.id });
      });
      if (istNeu) return onSchliessen();
      client.invalidateQueries({ queryKey: SCHLUESSEL.seiten });
      const frisch = (await getDoc(ref)).data();
      setGeladenAm(frisch.updatedAt);
      setHinweis("Gespeichert.");
      await verlaufLaden();
    } catch (e) {
      setFehler(meldung(e));
    } finally {
      setSpeichert(false);
    }
  }

  async function loeschen() {
    if (!confirm(`Seite „${seite.titel}“ löschen?`)) return;
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
      <button className="underline text-sm" onClick={onSchliessen}>← Zurück zu den Seiten</button>
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
          <button className={knopf} disabled={speichert || !entwurf.titel.trim() || !id} onClick={speichern}>
            {speichert ? "Speichere…" : istNeu ? "Anlegen" : "Speichern"}
          </button>
          {!istNeu && <button className={knopf + " text-red-700"} onClick={loeschen}>Löschen</button>}
          {hinweis && <span className="text-green-700 text-sm">{hinweis}</span>}
          {fehler && <span className="text-red-700 text-sm">{fehler}</span>}
        </div>
      )}
      {!bearbeitbar && fehler && <p className="text-red-700 text-sm">{fehler}</p>}

      {!istNeu && <Fassungen eintraege={eintraege} bearbeitbar={bearbeitbar} laden={fassungLaden} />}
    </div>
  );
}

/**
 * Die Einträge einer Seite: wann, wer, was sich geändert hat; jede Fassung lässt
 * sich ins Formular laden. Ganz unten der Stand vor dem ersten Eintrag, falls die
 * Seite älter ist als der Verlauf.
 */
function Fassungen({ eintraege, bearbeitbar, laden }) {
  if (!eintraege) return <p className="text-sm text-gray-600">Verlauf lädt…</p>;
  const aeltester = eintraege.at(-1);
  return (
    <div className="pt-4">
      <h3 className="font-bold text-sm">Frühere Fassungen</h3>
      {!eintraege.length ? <p className="text-sm text-gray-600">Noch keine; der Verlauf beginnt mit dem nächsten Speichern.</p> : (
        <ul className="divide-y text-sm">
          {eintraege.map((e, i) => (
            <li key={e.id} className="py-1 flex gap-2 items-center flex-wrap">
              <span className="flex-1">
                <span className="text-gray-600">{wann(e.at)}</span> · {e.by} ·{" "}
                {!e.vorher ? "angelegt"
                  : !e.nachher ? "gelöscht"
                  : Object.keys(FELDER).filter(k => e.vorher[k] !== e.nachher[k]).map(k => FELDER[k]).join(", ") || "nichts geändert"}
                {i === 0 && e.nachher && <span className="text-gray-600"> (aktuell)</span>}
              </span>
              {bearbeitbar && e.nachher && i > 0 && (
                <button className={knopf} onClick={() => laden(e.nachher, e.at)}>Laden</button>
              )}
            </li>
          ))}
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
