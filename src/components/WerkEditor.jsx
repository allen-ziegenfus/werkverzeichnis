import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection, deleteField, doc, getDoc, getDocFromServer, getDocs, query, runTransaction, serverTimestamp, where,
} from "firebase/firestore";
import { client, SCHLUESSEL, useVeroeffentlicht, useWerke, useWerkgruppen, zielSuchen } from "./abfragen.js";
import { useAbgleich } from "./Abgleich.jsx";
import { kuenstler, db } from "./firebaseClient.js";
import BildListe from "./BildVorschau.jsx";
import Skelett from "./Skelett.jsx";
import { useUngespeichert, verlassen } from "./ungespeichert.js";
import VerlaufListe, { wann } from "./VerlaufListe.jsx";
import WerkTabelle from "./WerkTabelle.jsx";
import { werkFeld, werkWert } from "./werkFeld.js";
import { ANNEHMEN, ablehnen, hochladen } from "./hochladen.js";
import Zugang from "./Zugang.jsx";
import { hauptknopf, knopf } from "./knoepfe.js";

/**
 * Der Werk-Editor (Firestore): bearbeiten und anlegen (#179), eine Künstler:in.
 *
 * Wer was darf, entscheidet firestore.rules, nicht diese Datei: die Berechtigung
 * werke.bearbeiten, die Inv. Nr. bleibt, und jede Änderung muss ihren
 * Verlaufseintrag mitbringen.
 */

// Die Felder, die der Editor zeigt, in dieser Reihenfolge. Alles andere am
// Dokument (werkgruppe, images, updatedAt, lastChange, ausgeblendet) wird verwaltet, nicht bearbeitet.
// Der Freitext „Werkgruppe“ heißt hier „Art“ (#189): Die Website zeigt als Werkgruppe
// deren Namen, den Freitext als Art, wenn er abweicht.
const FELDER = ["InvNr", "Titel", "Werkgruppe", "Jahr", "Maße", "Material", "Technik",
  "Beschreibung", "Zustand", "Standort", "Signatur", "Auflage", "Anzahl", "Foto",
  "Ausstellung", "Literatur", "Bibliographie"];
const BEARBEITBAR = FELDER.filter(f => f !== "InvNr");
const LANG = ["Beschreibung", "Ausstellung", "Literatur", "Bibliographie", "Material"];

// Bilder (#180) sind Listen: nach Inhalt vergleichen, nicht nach Objekt.
const gleicherWert = (a, b) => Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a) === JSON.stringify(b) : a === b;

/**
 * Was sich von einem Verlaufseintrag zurücksetzen lässt: Felder, deren heutiger
 * Wert noch der damals gespeicherte ist. Die anderen hat jemand seitdem
 * erneut geändert; die bleiben.
 */
function zuruecksetzbar(v, daten) {
  // Die Inv. Nr. ändert sich nie; beim Anlegen steht sie mit from: null im Verlauf (#179).
  const felder = Object.entries(v.changes ?? {}).filter(([f]) => f !== "InvNr");
  const gleich = ([f, c]) => gleicherWert(daten[f] ?? null, c.to ?? null);
  return { zurueck: felder.filter(gleich), geblieben: felder.filter(x => !gleich(x)).map(([f]) => f) };
}

// Für VerlaufListe (#204): ein Eintrag mit den geänderten Feldern, und der Vergleich je Feld.
const einheitlich = v => ({ id: v.id, by: v.by, at: v.at, rueckgaengig: v.rueckgaengig, zurueckgesetzt: v.zurueckgesetzt,
  art: v.changes?.InvNr && v.changes.InvNr.from == null ? "angelegt" : "geändert",
  felder: Object.fromEntries(Object.entries(v.changes ?? {}).filter(([f]) => f !== "InvNr")
    .map(([f, c]) => [f, { von: c.from ?? null, zu: c.to ?? null }])) });
const gleich = (f, a, b) => gleicherWert(a ?? "", b ?? "");

// Die zuletzt gewählte Werkgruppe, für die Rückkehr aus einem anderen Bereich.
let letzteGruppe = "";

export default function WerkEditorSeite() {
  return <Zugang berechtigung="werke.bearbeiten" kinder={({ nutzer }) => <WerkEditor nutzer={nutzer} />} />;
}


/**
 * Die nächste freie Inv. Nr. nach `invNr` (#240): die letzte Zahl darin
 * hochgezählt, führende Nullen bleiben (AZ-009 → AZ-010, OB1359 → OB1360).
 * Schon vergebene in `werke` werden übersprungen; ohne Zahl leer.
 */
export function naechsteInvNr(invNr, werke) {
  const teile = String(invNr ?? "").match(/^(.*?)(\d+)(\D*)$/);
  if (!teile) return "";
  const [, vorn, zahl, hinten] = teile;
  const vergeben = new Set(werke.map(w => w.id));
  for (let n = Number(zahl) + 1, i = 0; i < 1000; n++, i++) {
    const neu = `${vorn}${String(n).padStart(zahl.length, "0")}${hinten}`;
    if (!vergeben.has(neu.toLowerCase())) return neu;
  }
  return "";
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
  const { data: veroeffentlicht } = useVeroeffentlicht();
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
  const [laedt, setLaedt] = useState();     // { name, anteil, von, bis } beim Hochladen (#180)
  const [bildFehler, setBildFehler] = useState(); // beim Knopf, nicht oben auf der Seite
  const [nichtAngehaengt, setNichtAngehaengt] = useState(); // { pfad, name }: im Bucket, aber nicht am Werk
  const [bildHinweis, setBildHinweis] = useState(); // im Abschnitt Bilder, nicht beim Speichern-Knopf
  const [ziehen, setZiehen] = useState(false);       // Dateien werden über den Abschnitt Bilder gezogen (#270)
  const [ziehGrund, setZiehGrund] = useState();     // warum gerade nicht abgelegt werden kann, nur beim Ziehen
  const zieht = useRef(0);                           // dragenter minus dragleave: relatedTarget fehlt in manchen Browsern
  // Daneben fallen gelassene Dateien öffnete der Browser selbst und verließe die Verwaltung.
  // Der Abschnitt Bilder hat dann schon preventDefault gerufen; sonst „hier nicht ablegen“.
  useEffect(() => {
    if (!werk) return;
    const nicht = e => {
      if (e.type === "drop") { zieht.current = 0; setZiehen(false); setZiehGrund(undefined); }
      if (e.defaultPrevented || ![...(e.dataTransfer?.types ?? [])].includes("Files")) return;
      e.preventDefault();
      if (e.type === "dragover") e.dataTransfer.dropEffect = "none";
    };
    addEventListener("dragover", nicht); addEventListener("drop", nicht);
    return () => { removeEventListener("dragover", nicht); removeEventListener("drop", nicht); };
  }, [!!werk]);
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
    // Ein anderes Werk: Upload-Fehler und nicht angehängte Datei des vorigen gehören nicht dazu.
    if (offen.current !== w.id) { setBildFehler(undefined); setNichtAngehaengt(undefined); setBildHinweis(undefined); }
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
    felder: BEARBEITBAR, gleich, name: werkFeld,
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
    gesperrt: !!laedt,
  });
  // Ein laufender Upload zählt mit: Tab zu bricht ihn ab, ein anderes Werk nähme die Ansicht weg (#180).
  // Eine nicht angehängte Datei auch: Weg damit läge sie verwaist im Bucket.
  useUngespeichert(geaendert.length > 0 || !!laedt || !!(werk && nichtAngehaengt) || !!(neu && (neu.InvNr.trim() || neu.Titel.trim())));

  /**
   * `neu` kann auch eine Funktion des Stands auf dem Server sein (Bilder anhängen, #180).
   * Schreibt `neu` ({ Feld: Wert }, null entfernt das Feld) mit einem
   * Verlaufseintrag; `extra` kommt in den Eintrag (etwa `rueckgaengig`).
   * `pruefen: false` für Felder außerhalb des Formulars (ausgeblendet): kein
   * Konflikt mit fremdem Speichern, der Verlauf nimmt den Wert davor vom Server.
   */
  async function schreiben(neu, extra, meldung, { pruefen = true } = {}) {
    setSpeichert(true); setFehler(undefined); setHinweis(undefined);
    if (meldung) setBildHinweis(undefined);   // nicht zwei grüne Meldungen; das Anhängen bringt keine mit
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
        const werte = typeof neu === "function" ? neu(davor) : neu;
        const felder = Object.entries(werte).filter(([f, wert]) => pruefen || (davor[f] ?? null) !== (wert ?? null));
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
      // Vom Server: Mit dem Listener in useAbgleich käme sonst der Stand vor dieser Transaktion (#270).
      const frisch = await getDocFromServer(ref).catch(() => getDoc(ref));
      const w = { id: werk.id, data: frisch.data() };
      client.setQueryData(SCHLUESSEL.werke(gruppe), ws => ws?.map(x => x.id === w.id ? w : x));
      await oeffnen(w);
      setHinweis(meldung); abgleich.gespeichert();
      return true;
    } catch (e) {
      if (e.code === "konflikt") await abgleich.nachKonflikt({ ruecknahme: !!extra.rueckgaengig }).catch(e => setFehler(e.message));
      else setFehler(e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message);
      return false;
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
      const w = { id, data: (await getDocFromServer(ref).catch(() => getDoc(ref))).data() };
      client.invalidateQueries({ queryKey: SCHLUESSEL.werke(gruppe) });
      setNeu(undefined);
      const hier = aktuelleGruppe.current === startGruppe && offen.current === startOffen;
      if (hier) await oeffnen(w);
      setHinweis(`Angelegt (${invNr}).${hier ? " Die weiteren Felder hier eintragen und speichern." : ""}`);
    } catch (e) {
      setFehler(e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message);
    } finally {
      setSpeichert(false);
    }
  }

  /**
   * Bilder hochladen (#180), nacheinander; jedes kommt gleich ans Werk, mit
   * Verlaufseintrag. Hängt an, was auf dem Server steht, nicht an den Stand
   * beim Öffnen: Wer gleichzeitig ein Bild anhängt, verliert es nicht. Steht der
   * Pfad schon dort (geschrieben, nur das Nachladen scheiterte), nicht noch einmal.
   */
  async function anhaengen(pfad, namen) {
    const ok = await schreiben(davor => ({ images: davor.images?.includes(pfad)
      ? davor.images : [...(davor.images ?? []), pfad] }), {}, undefined, { pruefen: false });
    if (ok) setBildHinweis(`Hochgeladen und gespeichert (${namen.join(", ")}). Auf der Website nach dem nächsten Veröffentlichen.`);
    return ok;
  }

  async function bilderHochladen(dateien) {
    const abgelehnt = dateien.map(ablehnen).filter(Boolean);
    if (abgelehnt.length) { setBildFehler(abgelehnt.join(" ")); return; }
    setBildFehler(undefined); setNichtAngehaengt(undefined); setHinweis(undefined); setBildHinweis(undefined);
    const fertig = [];
    try {
      for (const [i, datei] of dateien.entries()) {
        setLaedt({ name: datei.name, anteil: 0, von: i + 1, bis: dateien.length });
        const pfad = await hochladen({ werk: werk.id, datei, von: nutzer.email,
          fortschritt: anteil => setLaedt(l => l && { ...l, anteil }) });
        // Scheitert das Anhängen, liegt die Datei schon im Bucket: nur das Anhängen wiederholen.
        if (!await anhaengen(pfad, [...fertig, datei.name])) {
          setNichtAngehaengt({ pfad, name: datei.name, fertig });
          break;
        }
        fertig.push(datei.name);
      }
    } catch (e) {
      setBildFehler(e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message);
    } finally {
      setLaedt(undefined);
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
      ...zurueck.map(([f, c]) => `  ${werkFeld(f)}: „${werkWert(c.to)}“ → „${werkWert(c.from)}“`),
      ...(geblieben.length ? ["", "Bleibt (inzwischen erneut geändert): " + geblieben.map(werkFeld).join(", ")] : []),
    ].join("\n");
    if (!window.confirm(text)) return;
    schreiben(Object.fromEntries(zurueck.map(([f, c]) => [f, c.from])), { rueckgaengig: v.id },
      `Rückgängig gemacht (${zurueck.map(([f]) => werkFeld(f)).join(", ")}).`);
  }

  /** Felder einer Gruppe aus VerlaufListe auf den Stand davor (#204). */
  function zuruecknehmen(g, felder) {
    const text = felder.map(f => `  ${werkFeld(f)}: „${werkWert(g.felder[f].zu)}“ → „${werkWert(g.felder[f].von)}“`);
    if (!window.confirm(["Zurücksetzen:", ...text].join("\n"))) return;
    schreiben(Object.fromEntries(felder.map(f => [f, g.felder[f].von])), { rueckgaengig: g.ids[0] },
      `Zurückgenommen (${felder.join(", ")}).`);
  }

  const alleTreffer = (werke ?? []).filter(w => {
    const q = suche.trim().toLowerCase();
    return !q || w.data.InvNr.toLowerCase().includes(q) || (w.data.Titel ?? "").toLowerCase().includes(q);
  });
  const treffer = alleTreffer.slice(0, 50);

  const gruppenTitel = gruppen?.find(g => g.id === gruppe)?.titel;
  // Aus der Suche übernommen (#232): Sieht der Text aus wie eine Inv. Nr. (ein
  // Wort mit Ziffer, erlaubte Zeichen wie in anlegen()), kommt er dorthin, sonst
  // in den Titel. Die Suche leert sich, sonst steht „keine Werke“ darunter.
  const gesucht = suche.trim();
  const alsInvNr = /\d/.test(gesucht) && /^[A-Za-z0-9.]+(-[A-Za-z0-9.]+)*$/.test(gesucht);
  // Nach einem Werk gleich das nächste (#240): die Inv. Nr. hochgezählt vorgeschlagen.
  const naechstesWerk = () => {
    if (!verlassen()) return;
    setWerk(undefined); setSuche(""); setFehler(undefined); setHinweis(undefined);
    setNeu({ InvNr: naechsteInvNr(werk.data.InvNr, werke ?? []), Titel: "" });
  };
  const neuesWerk = (text = "") => {
    setNeu(alsInvNr && text ? { InvNr: text, Titel: "" } : { InvNr: "", Titel: text });
    setFehler(undefined);
    if (text) setSuche("");
  };

  return (
    <div className="space-y-4">
      {fehler && <p className="text-red-700">{fehler}</p>}
      {ladefehler && <p className="text-red-700">{ladefehler.code === "permission-denied"
        ? `Kein Zugriff mit ${nutzer.email}.` : ladefehler.message}</p>}

      {!gruppen && !ladefehler && <Skelett zeilen={1} />}
      {gruppen && (
        <select className="border p-1 w-full" value={gruppe} disabled={speichert || !!laedt}
                onChange={e => { if (verlassen()) { setGruppe(e.target.value); setWerk(undefined); setNeu(undefined); setSuche(""); } }}>
          <option value="">Werkgruppe wählen…</option>
          {gruppen.map(g => <option key={g.id} value={g.id}>{g.titel}</option>)}
        </select>
      )}

      {gruppe && !werke && !ladefehler && <Skelett />}
      {werke && !werk && (
        <>
          {neu && (
            <form className="border rounded p-3 bg-gray-50"
                  onSubmit={e => { e.preventDefault(); if (!speichert && neu.InvNr.trim()) anlegen(); }}>
              <fieldset className="space-y-2">
                <legend className="px-1 font-semibold">Neues Werk{gruppenTitel && ` in ${gruppenTitel}`}</legend>
                <div className="flex gap-2 flex-wrap items-end">
                  <label className="text-sm">Inv. Nr.
                    <input className="block border p-1 w-32 bg-white" autoFocus value={neu.InvNr}
                           onChange={e => setNeu({ ...neu, InvNr: e.target.value })} />
                  </label>
                  <label className="text-sm flex-1 min-w-40">Titel (optional)
                    <input className="block border p-1 w-full bg-white" value={neu.Titel}
                           onChange={e => setNeu({ ...neu, Titel: e.target.value })} />
                  </label>
                  <button className={hauptknopf} disabled={speichert || !neu.InvNr.trim()}>
                    {speichert ? "Lege an…" : "Anlegen"}
                  </button>
                  <button type="button" className={knopf} disabled={speichert} onClick={() => setNeu(undefined)}>Abbrechen</button>
                </div>
                <p className="text-sm text-gray-600">Die weiteren Felder (Jahr, Maße, …) nach dem Anlegen im Werk.</p>
              </fieldset>
            </form>
          )}
          {/* Suche links, Anlegen rechts in einer Zeile: zwei verschiedene Dinge (#232). */}
          {(werke.length > 0 || !neu) && (
            <div className="flex gap-2 items-end flex-wrap">
              {werke.length > 0 ? (
                <label className="text-sm flex-1 min-w-48">Suchen ({werke.length} {werke.length === 1 ? "Werk" : "Werke"})
                  <input type="search" className="block border p-1 w-full" placeholder="Inv. Nr. oder Titel"
                         value={suche} onChange={e => setSuche(e.target.value)} />
                </label>
              ) : <p className="flex-1 self-center text-sm text-gray-600">Noch keine Werke in dieser Werkgruppe.</p>}
              {!neu && <button className={hauptknopf + " ml-auto"} onClick={() => neuesWerk()}>+ Neues Werk</button>}
            </div>
          )}
          {werke.length > 0 && gesucht && treffer.length === 0 && (
            <p className="text-sm text-gray-600" role="status">
              Keine Werke zu „{gesucht}“.{" "}
              {!neu && <button className="underline" onClick={() => neuesWerk(gesucht)}>
                Neues Werk mit {alsInvNr ? "Inv. Nr." : "Titel"} „{gesucht}“ anlegen</button>}
            </p>
          )}
          {treffer.length > 0 && (
            <WerkTabelle werke={treffer} veroeffentlicht={veroeffentlicht} gruppen={gruppen}
                         onOeffnen={w => verlassen() && (setNeu(undefined), oeffnen(w))}
                         onVerlauf={async w => {
                           if (!verlassen()) return;
                           setNeu(undefined);
                           await oeffnen(w);
                           // Nach dem Zeichnen des Werks; vorher gibt es die Überschrift nicht.
                           setTimeout(() => document.getElementById("werk-verlauf")?.scrollIntoView({ block: "start" }));
                         }} />
          )}
          {alleTreffer.length > treffer.length && (
            <p className="text-sm text-gray-600">{treffer.length} von {alleTreffer.length}; die Suche grenzt ein.</p>
          )}
        </>
      )}

      {werk && (
        <div className="space-y-3">
          {/* Gesperrt während des Speicherns und Hochladens: danach öffnet schreiben() das Werk neu (#213, #180). */}
          <div className="flex gap-2 items-center">
            <button className="underline text-sm disabled:opacity-40" disabled={speichert || !!laedt}
                    onClick={() => verlassen() && setWerk(undefined)}>← Zurück zur Liste</button>
            <button className={knopf + " ml-auto"} disabled={speichert || !!laedt} onClick={naechstesWerk}
                    title="Neues Werk in dieser Werkgruppe, Inv. Nr. hochgezählt">+ Neues Werk</button>
          </div>
          {abgleich.hinweise}
          {werk.data.ausgeblendet && (
            <p className="border border-gray-400 bg-gray-100 rounded p-2 text-sm">Ausgeblendet: steht nicht auf der Website.</p>
          )}
          {/* Während des Hochladens gesperrt: Das Anhängen lädt das Werk neu und nähme Eingaben mit (#180). */}
          {FELDER.map(f => (
            <label key={f} className="block">
              <span className="text-sm text-gray-600">{werkFeld(f)}</span>
              {f === "InvNr" ? (
                <input className="border p-1 w-full bg-gray-100" value={entwurf[f] ?? ""} readOnly />
              ) : LANG.includes(f) || String(entwurf[f] ?? "").length > 80 ? (
                <textarea className="border p-1 w-full disabled:bg-gray-100" rows={3} value={entwurf[f] ?? ""} disabled={!!laedt}
                          onChange={e => setEntwurf({ ...entwurf, [f]: e.target.value })} />
              ) : (
                <input className="border p-1 w-full disabled:bg-gray-100" value={entwurf[f] ?? ""} disabled={!!laedt}
                       onChange={e => setEntwurf({ ...entwurf, [f]: e.target.value })} />
              )}
            </label>
          ))}
          <div className="flex gap-2 items-center">
            <button className={hauptknopf} disabled={!geaendert.length || speichert || abgleich.konflikte.length > 0} onClick={speichern}>
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

          {/* Eigener Abschnitt, nicht im Formular: Hochladen speichert gleich, ohne „Speichern“ (#259). */}
          {/* Dateien lassen sich auch hierher ziehen, unter denselben Bedingungen wie der Knopf (#270). */}
          <section className={"space-y-2 pt-4 mt-4 border-t rounded" + (ziehen ? " outline-dashed outline-2 outline-blue-500 bg-blue-50" : "")}
                   aria-labelledby="werk-bilder"
                   onDragEnter={e => { if ([...e.dataTransfer.types].includes("Files")) zieht.current++; }}
                   onDragOver={e => {
                     if (![...e.dataTransfer.types].includes("Files")) return;
                     e.preventDefault();
                     // Gesperrt: Der Browser lässt dann nicht ablegen, darum den Grund schon jetzt zeigen.
                     const grund = laedt ? "Lädt gerade hoch; weitere Dateien danach."
                       : nichtAngehaengt ? "Erst die hochgeladene Datei anhängen."
                       : geaendert.length ? "Erst speichern oder verwerfen, dann Bilder hochladen."
                       : speichert ? "Speichert gerade." : undefined;
                     e.dataTransfer.dropEffect = grund ? "none" : "copy";
                     setZiehGrund(grund);
                     setZiehen(!grund);
                   }}
                   onDragLeave={() => { if (--zieht.current <= 0) { zieht.current = 0; setZiehen(false); setZiehGrund(undefined); } }}
                   onDrop={e => {
                     if (![...e.dataTransfer.types].includes("Files")) return;
                     e.preventDefault(); zieht.current = 0; setZiehen(false); setZiehGrund(undefined);
                     if (laedt || speichert || nichtAngehaengt || geaendert.length) return;
                     const d = [...e.dataTransfer.files];
                     if (d.length) bilderHochladen(d);
                   }}>
            <h3 id="werk-bilder" className="text-lg">Bilder</h3>
            {werk.data.images?.length > 0 ? (
              <BildListe bilder={werk.data.images} />
            ) : <p className="text-sm text-gray-600">Noch keine Bilder.</p>}
            <div className="flex gap-2 items-center flex-wrap">
              {/* Ein Label als Knopf: Das Dateifeld selbst lässt sich nicht gestalten. */}
              <label className={knopf + (laedt || speichert || geaendert.length || nichtAngehaengt ? " opacity-40 cursor-not-allowed" : " cursor-pointer")}
                     title={nichtAngehaengt ? "Erst die hochgeladene Datei anhängen." : geaendert.length ? "Erst speichern oder verwerfen." : undefined}>
                Bilder hochladen…
                <input type="file" className="sr-only" accept={ANNEHMEN} multiple
                       disabled={!!laedt || speichert || geaendert.length > 0 || !!nichtAngehaengt}
                       onChange={e => { const d = [...e.target.files]; e.target.value = ""; if (d.length) bilderHochladen(d); }} />
              </label>
              {laedt ? (
                <span className="text-sm" role="status">
                  Lade {laedt.bis > 1 && `${laedt.von}/${laedt.bis} `}„{laedt.name}“ hoch… {Math.round(laedt.anteil * 100)} %
                </span>
              ) : <span className="text-sm text-gray-600">oder Dateien hierher ziehen. JPEG, PNG, WebP, GIF, TIFF oder PDF, bis 50 MB je Datei. Wird gleich gespeichert.</span>}
            </div>
            {bildHinweis && <p className="text-sm text-green-700" role="status">{bildHinweis}</p>}
            {ziehGrund && <p className="text-sm text-red-700" role="status">{ziehGrund}</p>}
            {bildFehler && <p className="text-sm text-red-700" role="alert">{bildFehler}</p>}
            {nichtAngehaengt && (
              <p className="text-sm text-red-700" role="alert">
                „{nichtAngehaengt.name}“ ist hochgeladen, aber nicht am Werk.{" "}
                <button className="underline disabled:opacity-40" disabled={speichert || geaendert.length > 0}
                        title={geaendert.length ? "Erst speichern oder verwerfen." : undefined}
                        onClick={async () => { if (await anhaengen(nichtAngehaengt.pfad, [...nichtAngehaengt.fertig, nichtAngehaengt.name])) setNichtAngehaengt(undefined); }}>
                  Nochmal anhängen</button>
              </p>
            )}
          </section>

          <div id="werk-verlauf" className="flex gap-2 items-baseline pt-4 scroll-mt-4">
            <h3 className="text-lg flex-1">Verlauf</h3>
            {verlauf?.length > 0 && <button className="underline text-sm" onClick={() => setAlles(!alles)}>
              {alles ? "Zusammengefasst zeigen" : "Alles zeigen"}</button>}
          </div>
          {!verlauf && <p className="text-sm text-gray-600">Lädt…</p>}
          {verlauf?.length === 0 && <p className="text-sm text-gray-600">Noch keine Änderungen.</p>}
          {verlauf?.length > 0 && !alles && (
            <VerlaufListe eintraege={einheitliche} ist={werk.data} gleich={gleich} name={werkFeld}
                          lang={f => LANG.includes(f)} bearbeitbar zuruecknehmen={zuruecknehmen}
                          gesperrt={speichert ? "Speichert…" : laedt ? "Lädt hoch…" : geaendert.length ? "Erst speichern oder verwerfen." : undefined} />
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
                          disabled={speichert || !!laedt || geaendert.length > 0 || !kannZurueck}
                          title={laedt ? "Lädt hoch…" : geaendert.length ? "Erst speichern oder verwerfen."
                            : !kannZurueck ? "Alle Felder wurden inzwischen erneut geändert." : undefined}
                          onClick={() => rueckgaengig(v)}>
                    Rückgängig
                  </button>
                  {Object.entries(v.changes).map(([f, c]) => (
                    <div key={f} className="pl-3">
                      <b>{werkFeld(f)}</b>: <s className="text-gray-500">{werkWert(c.from)}</s> → {werkWert(c.to)}
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
