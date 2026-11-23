import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection, deleteField, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where,
} from "firebase/firestore";
import { client, SCHLUESSEL, useAnzahlJeGruppe, useKuenstler, useVeroeffentlicht, useWerke, useWerkgruppen, zielSuchen } from "./abfragen.js";
import { useAbgleich } from "./Abgleich.jsx";
import { useHoeheAls } from "./hoehe.js";
import { kuenstler, db } from "./firebaseClient.js";
import { vomServer } from "./firestoreLite.js";
import BildListe, { EIGENES_BILD, lokalMerken, Vorschaubild } from "./BildVorschau.jsx";
import Skelett from "./Skelett.jsx";
import { useEtwasUngespeichert, useUngespeichert, verlassen } from "./ungespeichert.js";
import { adresseSetzen } from "./adresse.js";
import VerlaufListe, { wann } from "./VerlaufListe.jsx";
import WerkTabelle from "./WerkTabelle.jsx";
import { feldNamen, gleicherWert, werkWert } from "./werkFeld.js";
import { felderVon } from "../werkverzeichnis/felder.js";
import { INVNR_MUSTER } from "../werkverzeichnis/importPruefen.js";
import { darf } from "../werkverzeichnis/permissions.js";
import { werkgruppeAendern } from "./werkgruppeSchreiben.js";
import { ANNEHMEN, ablehnen, hochladen } from "./hochladen.js";
import Zugang from "./Zugang.jsx";
import Feldfehler, { fehlerAttribute, fehlerRand } from "./Feldfehler.jsx";
import { hauptknopf, knopf } from "./knoepfe.js";


/**
 * Der Werk-Editor (Firestore): bearbeiten und anlegen (#179), eine Künstler:in.
 *
 * Wer was darf, entscheidet firestore.rules, nicht diese Datei: die Berechtigung
 * werke.bearbeiten, die Inv. Nr. bleibt, und jede Änderung muss ihren
 * Verlaufseintrag mitbringen.
 */

// Die Felder, die der Editor zeigt, in dieser Reihenfolge: Inv. Nr. und Titel,
// dann die nicht archivierten aus der Feldliste der Künstler:in (#257). Alles
// andere am Dokument (werkgruppe, images, updatedAt, lastChange, ausgeblendet,
// archivierte Felder) wird verwaltet bzw. bleibt, nicht bearbeitet.
function editorFelder(liste) {
  const aktiv = liste.filter(f => !f.archiviert);
  const felder = ["InvNr", "Titel", ...aktiv.map(f => f.schluessel)];
  return {
    FELDER: felder, BEARBEITBAR: felder.filter(f => f !== "InvNr"),
    LANG: aktiv.filter(f => f.lang).map(f => f.schluessel),
    INTERN: aktiv.filter(f => !f.oeffentlich).map(f => f.schluessel),
    ARCHIVIERT: liste.filter(f => f.archiviert).map(f => f.schluessel),
    werkFeld: feldNamen(liste),
  };
}

// Bilder (#180) sind Listen: nach Inhalt vergleichen, nicht nach Objekt.

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

// Dateien von außen (zum Hochladen); ein gezogenes eigenes Bild ist keine (#372),
// auch wenn der Browser es als Datei mitgibt.
const dateienVonAussen = e => {
  const typen = [...(e.dataTransfer?.types ?? [])];
  return typen.includes("Files") && !typen.includes(EIGENES_BILD);
};


export default function WerkEditorSeite() {
  return <Zugang berechtigung="werke.bearbeiten" kinder={({ nutzer, wer }) => <WerkEditor nutzer={nutzer} wer={wer} />} />;
}

/**
 * Die nächste freie Inv. Nr. nach `invNr` (#240): die letzte Zahl darin
 * hochgezählt, führende Nullen bleiben (AZ-009 → AZ-010, OB1359 → OB1360).
 * Schon vergebene in `werke` werden übersprungen (nach Kennung und Inv. Nr.: alte
 * Kennungen kommen aus slugify). Ohne Zahl oder ohne gültige Inv. Nr. leer.
 */
export function naechsteInvNr(invNr, werke) {
  const teile = String(invNr ?? "").match(/^(.*?)(\d+)(\D*)$/);
  if (!teile) return "";
  const [, vorn, zahl, hinten] = teile;
  const vergeben = new Set(werke.flatMap(w => [w.id, String(w.data.InvNr ?? "").toLowerCase()]));
  for (let n = Number(zahl) + 1, i = 0; i < 1000; n++, i++) {
    const neu = `${vorn}${String(n).padStart(zahl.length, "0")}${hinten}`;
    // INVNR_MUSTER wie beim Anlegen: sonst schlüge der Vorschlag dort fehl (etwa „OB 1359“).
    if (!INVNR_MUSTER.test(neu)) return "";
    if (!vergeben.has(neu.toLowerCase())) return neu;
  }
  return "";
}

function WerkEditor({ nutzer, wer }) {
  const [fehler, setFehler] = useState();
  // Die Adresse (#281): ?werk=<Kennung> öffnet dieses Werk (auch aus der
  // Werkzeugleiste), ?gruppe=<Kennung> zeigt die Liste dieser Werkgruppe.
  const ziel = useRef(new URLSearchParams(location.search).get("werk"));
  const [gruppe, setGruppeRoh] = useState(() => ziel.current ? ""
    : new URLSearchParams(location.search).get("gruppe") ?? "");   // ohne: die Liste der Werkgruppen (#282)
  const aktuelleGruppe = useRef(gruppe);
  const setGruppe = g => { aktuelleGruppe.current = g; setGruppeRoh(g); };
  const { data: gruppen, error: gruppenFehler } = useWerkgruppen();
  const { data: anzahl } = useAnzahlJeGruppe(gruppen);
  const werkeAbfrage = useWerke(gruppe);
  const { data: werke, error: werkeFehler } = werkeAbfrage;
  const { data: veroeffentlicht } = useVeroeffentlicht();
  // Das Formular wartet auf die Feldliste: Mit den Standardfeldern wären archivierte
  // bearbeitbar, und ein gesicherter Entwurf eigener Felder ginge verloren (Abgleich.jsx).
  const { data: kuenstlerDaten, error: kuenstlerFehler } = useKuenstler();
  const { FELDER: LISTE, BEARBEITBAR: LISTE_BEARBEITBAR, ARCHIVIERT, LANG, INTERN, werkFeld } =
    useMemo(() => editorFelder(felderVon(kuenstlerDaten)), [kuenstlerDaten]);
  const ladefehler = gruppenFehler ?? werkeFehler ?? kuenstlerFehler;
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
  const [leiste, setLeiste] = useState();          // Werkleiste oben, für scroll-padding (#260)
  useHoeheAls("--werkleiste", leiste);
  const zieht = useRef(0);                           // dragenter minus dragleave: relatedTarget fehlt in manchen Browsern
  // Daneben fallen gelassene Dateien öffnete der Browser selbst und verließe die Verwaltung.
  // Der Abschnitt Bilder hat dann schon preventDefault gerufen; sonst „hier nicht ablegen“.
  useEffect(() => {
    if (!werk) return;
    const nicht = e => {
      if (e.type === "drop") { zieht.current = 0; setZiehen(false); setZiehGrund(undefined); }
      if (e.defaultPrevented || !dateienVonAussen(e)) return;
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
        else aufgeben(`Werk „${ziel.current}“ nicht gefunden.`);
      })
      .catch(e => aufgeben(e.message));
  }, []);
  // Nicht gefunden oder nicht lesbar: Meldung, die Liste der Werkgruppen, und die
  // Adresse wird ersetzt (sonst führte Zurück nach dem nächsten Schritt wieder hierher).
  function aufgeben(meldung) {
    setFehler(meldung); ziel.current = null;
    nurErsetzen.current = true; setZielAufgegeben(n => n + 1);
  }
  // Gefunden: ziel ist dann schon leer, das Werk aber erst im nächsten Zeichnen offen.
  const oeffnetAusAdresse = useRef(false);
  // Aufgegeben (nicht in der Liste der Werkgruppe): Die Adresse soll dann die Liste zeigen.
  const [zielAufgegeben, setZielAufgegeben] = useState(0);
  useEffect(() => {
    const vorher = ziel.current;
    zielSuchen(ziel, werkeAbfrage, ws => ws.find(x => x.id === ziel.current),
      w => { oeffnetAusAdresse.current = true; oeffnen(w); });
    if (vorher && !ziel.current && !oeffnetAusAdresse.current) { nurErsetzen.current = true; setZielAufgegeben(n => n + 1); }
  // dataUpdatedAt: Ein schnelles Nachladen mit gleichen Daten ändert sonst nichts, das hier auslöst.
  }, [werke, werkeAbfrage.isFetching, werkeAbfrage.dataUpdatedAt]);

  // Die Adresse folgt dem, was offen ist (#281). Ein Werk oder eine Werkgruppe
  // öffnen oder schließen ist ein Schritt für Zurück/Vor (#282); nur das
  // Nachziehen nach einem aufgegebenen Ziel aus der Adresse ersetzt sie.
  // Zurück/Vor selbst behandelt VerwaltungApp: Es fragt bei Ungespeichertem und
  // baut den Bereich neu auf, der die Adresse dann wie beim Laden liest.
  const adresse = werk ? `?werk=${encodeURIComponent(werk.id)}` : gruppe ? `?gruppe=${encodeURIComponent(gruppe)}` : "";
  const zuletztOffen = useRef(null);   // Kennung des zuletzt offenen Werks, für „Schritt oder ersetzen“
  const zuletztGruppe = useRef(gruppe);   // ebenso die Werkgruppe
  const nurErsetzen = useRef(false);
  useEffect(() => {
    // Ein Werk aus der Adresse wird noch gesucht oder gleich geöffnet: Die Adresse stimmt schon.
    if (ziel.current || (oeffnetAusAdresse.current && !werk)) return;
    oeffnetAusAdresse.current = false;
    const schritt = !nurErsetzen.current
      && ((werk?.id ?? null) !== zuletztOffen.current || gruppe !== zuletztGruppe.current);
    zuletztOffen.current = werk?.id ?? null;
    zuletztGruppe.current = gruppe;
    nurErsetzen.current = false;
    if (location.search === adresse) return;
    adresseSetzen(location.pathname + adresse + location.hash, { schritt });
  }, [adresse, zielAufgegeben]);

  async function oeffnen(w) {
    // Ein anderes Werk: Upload-Fehler und nicht angehängte Datei des vorigen gehören nicht dazu.
    // Dasselbe Werk (nach dem Speichern): Der alte Verlauf bleibt stehen, bis der neue
    // da ist; sonst wird die Seite kurz kürzer und springt (#260).
    const anderes = offen.current !== w.id;
    if (anderes) { setBildFehler(undefined); setNichtAngehaengt(undefined); setBildHinweis(undefined); setVerlauf(undefined); }
    offen.current = w.id;
    setWerk(w); setEntwurf({ ...w.data }); setHinweis(undefined); setFehler(undefined);
    const v = await getDocs(query(collection(kuenstler, "history"), where("work", "==", w.id)));
    if (offen.current !== w.id) return;
    setVerlauf(v.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.at?.toMillis() - a.at?.toMillis()));
  }

  // Inzwischen archiviert, aber hier schon geändert (die Liste lädt neu): bleibt im
  // Formular, bis gespeichert oder verworfen, statt still zu verschwinden.
  const nochGeaendert = werk ? ARCHIVIERT.filter(f => (entwurf[f] ?? "") !== (werk.data[f] ?? "")) : [];
  const FELDER = useMemo(() => [...LISTE, ...nochGeaendert], [LISTE, nochGeaendert.join("\n")]);
  const ABGLEICH = useMemo(() => [...LISTE_BEARBEITBAR, ...ARCHIVIERT], [LISTE_BEARBEITBAR, ARCHIVIERT]);
  const geaendert = useMemo(() => werk
    ? FELDER.filter(f => (entwurf[f] ?? "") !== (werk.data[f] ?? "")) : [], [entwurf, werk, FELDER]);
  // Entwurf im Browser, Speichern anderer live, Zusammenführen (#203).
  const abgleich = useAbgleich({
    art: "werk", id: werk?.id, ich: nutzer.email, aktiv: !!werk && !!kuenstlerDaten, ref: werk ? doc(kuenstler, "works", werk.id) : null,
    // Archivierte mit: Ein gesicherter Entwurf mit Änderungen daran wird so angeboten
    // (dann mit „archiviert“ im Formular), statt verworfen oder beschnitten.
    felder: ABGLEICH, gleich, name: werkFeld,
    stand: werk?.data ?? {},
    entwurf: useMemo(() => Object.fromEntries(ABGLEICH.map(f => [f, entwurf[f] ?? null])), [entwurf, ABGLEICH]),
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
  const ungespeichert = useEtwasUngespeichert();   // für die Leiste oben (#328)
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
        const felder = Object.entries(werte).filter(([f, wert]) => pruefen || !gleicherWert(davor[f] ?? null, wert ?? null));
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
      // Vom Server, mit Lite: Mit dem Listener in useAbgleich käme sonst der Stand vor dieser Transaktion (#270, #287).
      const frisch = await vomServer(ref).catch(() => getDoc(ref));
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

  /** Was an einer neuen Inv. Nr. nicht stimmt (#329), am Feld angezeigt; leer ist noch kein Fehler. */
  const invNrFehler = invNr => invNr && (invNr.length > 100 || !INVNR_MUSTER.test(invNr))
    ? "Nur Buchstaben, Ziffern, Punkt und einzelne Bindestriche (nicht am Anfang oder Ende)." : undefined;

  /**
   * Legt ein Werk in der gewählten Werkgruppe an, mit Verlaufseintrag wie jede
   * Änderung. Die Kennung kommt aus der Inv. Nr., wie beim Import (catalog.ts).
   */
  async function anlegen() {
    const invNr = neu.InvNr.trim(), titel = neu.Titel.trim();
    if (invNrFehler(invNr)) return;   // steht schon am Feld (#329), siehe INVNR_MUSTER
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
      const w = { id, data: (await vomServer(ref).catch(() => getDoc(ref))).data() };
      client.invalidateQueries({ queryKey: SCHLUESSEL.werke(gruppe) });
      client.invalidateQueries({ queryKey: ["werke", "anzahlJeGruppe"] });   // die Zahl in der Liste der Werkgruppen
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

  /**
   * Ordnen und Entfernen (#262), gleich gespeichert mit Verlaufseintrag (im
   * Verlauf zurücknehmbar). Wie beim Anhängen auf dem Stand des Servers: Ein
   * gleichzeitig angehängtes Bild bleibt. Das Original bleibt im Bucket.
   */
  // Sofort sichtbar, was gespeichert wird (#262): Die Transaktion mit Neuladen braucht
  // ein, zwei Sekunden. Danach (oder bei einem Fehler) gilt wieder der gespeicherte Stand.
  const [bilderGleich, setBilderGleich] = useState();
  async function bilderAendern(aendern, meldung) {
    setBildFehler(undefined); setBildHinweis(undefined);
    setBilderGleich(aendern(werk.data.images ?? []));
    let anders = false;   // auf dem Server-Stand; schon so (woanders geändert): nichts geschrieben
    const ok = await schreiben(davor => {
      const neu = aendern(davor.images ?? []);
      anders = !gleicherWert(neu, davor.images ?? []);
      return { images: neu };
    }, {}, undefined, { pruefen: false });
    setBilderGleich(undefined);
    if (ok) setBildHinweis(anders ? meldung : "Nichts geändert: Inzwischen stand es woanders schon so.");
  }
  const bildVerschieben = (pfad, schritt) => bilderAendern(liste => {
    const i = liste.indexOf(pfad), j = i + schritt;
    if (i < 0 || j < 0 || j >= liste.length) return liste;
    const neu = [...liste];
    [neu[i], neu[j]] = [neu[j], neu[i]];
    return neu;
  }, "Reihenfolge gespeichert. Auf der Website nach dem nächsten Veröffentlichen.");
  // Auf ein anderes Bild gezogen (#372): davor bzw. dahinter, je nach Richtung.
  const bildEinordnen = (pfad, auf) => bilderAendern(liste => {
    const i = liste.indexOf(pfad), j = liste.indexOf(auf);
    if (i < 0 || j < 0 || i === j) return liste;
    const neu = liste.filter(p => p !== pfad);
    neu.splice(neu.indexOf(auf) + (i < j ? 1 : 0), 0, pfad);
    return neu;
  }, "Reihenfolge gespeichert. Auf der Website nach dem nächsten Veröffentlichen.");
  // Titelbild der Werkgruppe (#378): nur mit werkgruppen.bearbeiten, mit Eintrag im Werkgruppenverlauf.
  const darfTitelbild = darf(wer, "werkgruppen.bearbeiten");
  const titelbild = gruppen?.find(g => g.id === werk?.data.werkgruppe)?.cover ?? null;
  async function alsTitelbild(pfad) {
    setBildFehler(undefined); setBildHinweis(undefined);
    try {
      await werkgruppeAendern(werk.data.werkgruppe, { cover: pfad }, nutzer.email);
      await client.invalidateQueries({ queryKey: SCHLUESSEL.werkgruppen });
      setBildHinweis(`„${pfad.split("/").pop()}“ ist jetzt das Titelbild der Werkgruppe „${gruppenTitel ?? werk.data.werkgruppe}“. `
        + "Auf der Website nach dem nächsten Veröffentlichen; zurücknehmen unter Werkgruppen im Verlauf.");
    } catch (e) {
      setBildFehler(e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message);
    }
  }
  const bildEntfernen = pfad => {
    const name = pfad.split("/").pop();
    // Titelbild einer Werkgruppe: Das bleibt dort (Werkgruppen), sonst wunderte man sich auf der Startseite.
    const titelbild = gruppen?.filter(g => g.cover === pfad).map(g => `„${g.titel}“`);
    if (!window.confirm(`„${name}“ vom Werk entfernen? Das Original bleibt gespeichert; im Verlauf lässt es sich zurücknehmen.`
      + (titelbild?.length ? `\n\nEs ist auch das Titelbild der Werkgruppe ${titelbild.join(", ")} und bleibt das, bis dort ein anderes gewählt ist.` : ""))) return;
    bilderAendern(liste => liste.filter(p => p !== pfad),
      `„${name}“ entfernt; im Verlauf zurücknehmbar. Auf der Website nach dem nächsten Veröffentlichen.`);
  };

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
        lokalMerken(pfad, datei);
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
    `Gespeichert (${geaendert.map(werkFeld).join(", ")}).`);

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
  // Wort mit Ziffer, erlaubte Zeichen: INVNR_MUSTER), kommt er dorthin, sonst
  // in den Titel. Die Suche leert sich, sonst steht „keine Werke“ darunter.
  const gesucht = suche.trim();
  const alsInvNr = /\d/.test(gesucht) && INVNR_MUSTER.test(gesucht);
  // Nach einem Werk gleich das nächste (#240): die Inv. Nr. hochgezählt vorgeschlagen.
  const gruppenName = gruppenTitel ?? gruppe;
  const gruppeWaehlen = g => {
    if (!verlassen()) return;
    setGruppe(g); setWerk(undefined); setNeu(undefined); setSuche("");
  };
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
      {fehler && !werk && <p className="text-red-700">{fehler}</p>}
      {ladefehler && <p className="text-red-700">{ladefehler.code === "permission-denied"
        ? `Kein Zugriff mit ${nutzer.email}.` : ladefehler.message}</p>}

      {!gruppen && !ladefehler && <Skelett zeilen={1} />}
      {/* Die Werkgruppen als Liste (#282); ein Klick zeigt ihre Werke. */}
      {gruppen && !gruppe && !ziel.current && (
        <ul className="divide-y border rounded" aria-label="Werkgruppen">
          {gruppen.map(g => (
            <li key={g.id}>
              <button type="button" className="w-full flex items-center gap-3 p-2 text-left hover:bg-gray-50"
                      onClick={() => gruppeWaehlen(g.id)}>
                <Vorschaubild key={g.cover} pfad={g.cover} />
                <span className="flex-1 font-medium">{g.titel}</span>
                <span className="text-sm text-gray-600">
                  {anzahl?.[g.id] === undefined ? "" : `${anzahl[g.id]} ${anzahl[g.id] === 1 ? "Werk" : "Werke"}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* Brotkrumen (#282): Werke › Werkgruppe › Werk, jeder Teil eine Ebene zurück. */}
      {gruppen && gruppe && (
        <nav aria-label="Brotkrumen" className="text-sm">
          <ol className="flex flex-wrap gap-x-1 items-center">
            <li><button type="button" className="underline disabled:opacity-40" disabled={speichert || !!laedt}
                        onClick={() => gruppeWaehlen("")}>Werke</button></li>
            <li aria-hidden="true">›</li>
            <li>
              {werk || neu ? (
                <button type="button" className="underline disabled:opacity-40" disabled={speichert || !!laedt}
                        onClick={() => verlassen() && (setWerk(undefined), setNeu(undefined))}>{gruppenName}</button>
              ) : <span aria-current="page" className="font-semibold">{gruppenName}</span>}
            </li>
            {werk && <><li aria-hidden="true">›</li><li aria-current="page" className="font-semibold">{werk.data.InvNr}</li></>}
          </ol>
        </nav>
      )}

      {gruppe && !werke && !ladefehler && <Skelett />}
      {werke && !werk && (
        <>
          {neu && (
            <form className="border rounded p-3 bg-gray-50"
                  onSubmit={e => { e.preventDefault(); if (!speichert && neu.InvNr.trim() && !invNrFehler(neu.InvNr.trim())) anlegen(); }}>
              <fieldset className="space-y-2">
                <legend className="px-1 font-semibold">Neues Werk{gruppenTitel && ` in ${gruppenTitel}`}</legend>
                <div className="flex gap-2 flex-wrap items-end">
                  <label className="text-sm">Inv. Nr.
                    <input className={"block border p-1 w-32 bg-white " + (invNrFehler(neu.InvNr.trim()) ? fehlerRand : "")} autoFocus value={neu.InvNr}
                           {...fehlerAttribute("fehler-invnr", invNrFehler(neu.InvNr.trim()))}
                           onFocus={e => e.target.select()}
                           onChange={e => setNeu({ ...neu, InvNr: e.target.value })} />
                  </label>
                  <label className="text-sm flex-1 min-w-40">Titel (optional)
                    <input className="block border p-1 w-full bg-white" value={neu.Titel}
                           onChange={e => setNeu({ ...neu, Titel: e.target.value })} />
                  </label>
                  <button className={hauptknopf} disabled={speichert || !neu.InvNr.trim() || !!invNrFehler(neu.InvNr.trim())}>
                    {speichert ? "Lege an…" : "Anlegen"}
                  </button>
                  <button type="button" className={knopf} disabled={speichert} onClick={() => setNeu(undefined)}>Abbrechen</button>
                </div>
                {/* Unter der ganzen Zeile: neben dem schmalen Feld bräche die Meldung Wort für Wort um. */}
                <Feldfehler id="fehler-invnr" text={invNrFehler(neu.InvNr.trim())} />
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
                         jahr={FELDER.includes("Jahr") ? werkFeld("Jahr") : null}
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

      {werk && !kuenstlerDaten && !ladefehler && <Skelett />}
      {werk && kuenstlerDaten && (
        <div className="space-y-3">
          {/* Gesperrt während des Speicherns und Hochladens: danach öffnet schreiben() das Werk neu (#213, #180).
              Die Felder darum nur lesbar, solange gespeichert wird (auch Bilder ordnen, #262): Getipptes ginge sonst verloren. */}
          {/* Bleibt beim Scrollen unter dem Kopf stehen: welches Werk offen ist, Speichern (#260). */}
          <div ref={setLeiste} className="sticky top-[var(--kopf-sichtbar,0px)] z-30 -mx-4 px-4 py-2 bg-white border-b flex flex-wrap gap-x-3 gap-y-1 items-center">
            <button className="underline text-sm disabled:opacity-40" disabled={speichert || !!laedt}
                    onClick={() => verlassen() && setWerk(undefined)}>
              ← <span className="sm:hidden">Liste</span><span className="hidden sm:inline">Zurück zur Liste</span>
            </button>
            <span className="order-first w-full sm:order-none sm:w-auto sm:flex-1 min-w-0 truncate font-semibold">
              {werk.data.InvNr}{werk.data.Titel && ` · ${werk.data.Titel}`}
            </span>
            <button className={hauptknopf + " ml-auto sm:ml-0"} disabled={!geaendert.length || speichert || !!laedt || abgleich.konflikte.length > 0} onClick={speichern}>
              {speichert ? "Speichere…" : "Speichern"}
            </button>
            <button className={knopf} disabled={speichert || !!laedt} onClick={naechstesWerk}
                    title="Neues Werk in dieser Werkgruppe, Inv. Nr. hochgezählt">+ Neues Werk</button>
            {/* Rückmeldung zum Speichern hier, wo man sie sieht, egal welcher Knopf (#260); ob etwas ungespeichert ist (#328). */}
            <p role="status" className="w-full text-sm empty:-mt-1">
              {ungespeichert && <span className="text-amber-800 font-medium mr-2 whitespace-nowrap">● Ungespeichert<span className="hidden sm:inline">e Änderungen</span></span>}
              {fehler ? <span className="text-red-700">{fehler}</span> : hinweis && !(ungespeichert && hinweis.startsWith("Gespeichert")) && <span className="text-green-700">{hinweis}</span>}
            </p>
          </div>
          {abgleich.hinweise}
          {werk.data.ausgeblendet && (
            <p className="border border-gray-400 bg-gray-100 rounded p-2 text-sm">Ausgeblendet: steht nicht auf der Website.</p>
          )}
          {/* Während des Hochladens gesperrt: Das Anhängen lädt das Werk neu und nähme Eingaben mit (#180). */}
          {FELDER.map(f => (
            <label key={f} className="block">
              <span className="text-sm text-gray-600">
                {werkFeld(f)}
                {INTERN.includes(f) && <span className="ml-2 text-xs rounded bg-gray-200 px-1" title="Steht nicht auf der Website.">intern</span>}
                {nochGeaendert.includes(f) && <span className="ml-2 text-xs rounded bg-amber-100 px-1" title="Inzwischen in den Einstellungen archiviert.">archiviert</span>}
              </span>
              {f === "InvNr" ? (
                <input className="border p-1 w-full bg-gray-100" value={entwurf[f] ?? ""} readOnly />
              ) : LANG.includes(f) || String(entwurf[f] ?? "").length > 80 ? (
                <textarea className="border p-1 w-full disabled:bg-gray-100" rows={3} value={entwurf[f] ?? ""} disabled={!!laedt} readOnly={speichert}
                          onChange={e => setEntwurf({ ...entwurf, [f]: e.target.value })} />
              ) : (
                <input className="border p-1 w-full disabled:bg-gray-100" value={entwurf[f] ?? ""} disabled={!!laedt} readOnly={speichert}
                       onChange={e => setEntwurf({ ...entwurf, [f]: e.target.value })} />
              )}
            </label>
          ))}
          <div className="flex gap-2 items-center">
            {/* Speichern unten noch einmal: Nach dem letzten Feld sucht man es hier. */}
            <button className={hauptknopf} disabled={!geaendert.length || speichert || !!laedt || abgleich.konflikte.length > 0} onClick={speichern}>
              {speichert ? "Speichere…" : "Speichern"}
            </button>
            <button className={knopf} disabled={!geaendert.length || speichert}
                    onClick={() => { setEntwurf({ ...werk.data }); abgleich.verworfen(); }}>Verwerfen</button>
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
                   onDragEnter={e => { if (dateienVonAussen(e)) zieht.current++; }}
                   onDragOver={e => {
                     if (!dateienVonAussen(e)) return;
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
                     if (!dateienVonAussen(e)) return;
                     e.preventDefault(); zieht.current = 0; setZiehen(false); setZiehGrund(undefined);
                     if (laedt || speichert || nichtAngehaengt || geaendert.length) return;
                     const d = [...e.dataTransfer.files];
                     if (d.length) bilderHochladen(d);
                   }}>
            <h3 id="werk-bilder" className="text-lg">Bilder</h3>
            {(bilderGleich ?? werk.data.images)?.length > 0 ? (
              <BildListe bilder={bilderGleich ?? werk.data.images} verschieben={bildVerschieben} entfernen={bildEntfernen} einordnen={bildEinordnen}
                         titelbild={titelbild} alsTitelbild={darfTitelbild ? alsTitelbild : undefined}
                         gesperrt={laedt ? "Erst das Hochladen abwarten." : speichert ? "Speichert…"
                           : nichtAngehaengt ? "Erst die hochgeladene Datei anhängen."
                           : geaendert.length ? "Erst speichern oder verwerfen." : undefined} />
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
