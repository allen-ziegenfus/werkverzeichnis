/**
 * Das Datenmodell des Werkverzeichnisses, gelesen aus Firestore
 * (artists/{artist} und seine Sammlungen werkgruppen, works, seiten, medien).
 */
import { slugify } from "./slugify.js";
import { felderVon } from "./felder.js";

/** Einstellungen der Seite, aus dem Künstler-Dokument (bearbeitet in der Verwaltungsseite). */
export interface Kuenstler {
  titel: string;
  websiteTitel: string;
  titelZeile1: string;
  titelZeile2: string;
  copyright: string;
}

export interface Werkgruppe {
  slug: string;
  titel: string;
  kurztitel?: string;
  reihenfolge: number;
  /** Titelbild in Cloud Storage (Objektpfad). */
  cover?: string;
}

/** Ein Feld der Werke aus der Feldliste der Künstler:in (felder.js, #255). */
export interface Feld {
  schluessel: string;
  name: string;
  lang: boolean;
  oeffentlich: boolean;
  archiviert: boolean;
}

export type Werk = {
  slug: string; werkgruppe: string; InvNr: string; Titel?: string;
  /** Bilder in Cloud Storage (Objektpfade), in Reihenfolge; das erste ist das Vorschaubild. */
  images?: string[];
  /** In der Verwaltung ausgeblendet (#181); der Bau lässt es aus. */
  ausgeblendet?: true;
  /** Die Werte der Felder aus der Feldliste, auch interner; was davon ins JSON geht, entscheidet der Bau. */
  werte: Record<string, string>;
};

export interface Seite {
  slug: string;
  titel: string;
  kategorie: "Header" | "Footer";
  reihenfolge: number;
  /** Markdown. */
  text: string;
}

/**
 * Die Webversionen eines Originals, erzeugt von der Bildfunktion (gcf/process.js),
 * unter der MD5 des Originals. Dateien: <artist>/<md5>-<breite>.<format> in R2.
 */
export interface Medium {
  art: "bild" | "video" | "nicht unterstützt" | "fehler";
  breite?: number;
  hoehe?: number;
  breiten?: number[];
  formate?: string[];
  vorschau?: string;
  fehler?: string;
}

export interface Katalog {
  kuenstler: Kuenstler;
  /** Die Feldliste (#256), ohne gespeicherte die Standardfelder. */
  felder: Feld[];
  werkgruppen: Werkgruppe[];
  werke: Werk[];
  seiten: Seite[];
  /** Webversionen nach Fingerabdruck (MD5). */
  medien: Map<string, Medium>;
  /** Beim Lesen gefundene Datenprobleme; der Build meldet sie. */
  probleme: string[];
  /** Der Zeitpunkt, zu dem alles gelesen wurde (ISO), wenn aus Firestore. */
  gelesen?: string;
}

/** Eine leere Zeichenkette gilt als nicht vorhanden; Zahlen (z. B. aus einem Import) als Text. */
const wert = (v: unknown) => typeof v === "number" ? String(v) : typeof v === "string" && v.trim() !== "" ? v : undefined;

/** Die vorhandenen Werte eines Werk-Dokuments zu den Feldern der Liste. */
export function werteVon(d: Record<string, unknown>, felder: Feld[]): Record<string, string> {
  return Object.fromEntries(felder.map(f => [f.schluessel, wert(d[f.schluessel])])
    .filter((e): e is [string, string] => e[1] !== undefined));
}

/**
 * Läuft mit den Google-Zugangsdaten des Builds, für die die Sicherheitsregeln
 * nicht gelten (das Build-Servicekonto darf nur lesen).
 */
export async function firestoreKatalog(projekt: string, datenbank: string, kuenstlerId: string): Promise<Katalog> {
  const { Firestore, Timestamp } = await import("@google-cloud/firestore");
  const db = new Firestore({ projectId: projekt, databaseId: datenbank });
  const kuenstlerRef = db.collection("artists").doc(kuenstlerId);
  const probleme: string[] = [];

  // Alles zum selben Zeitpunkt lesen (eine Sekunde zurück, damit er sicher nicht
  // in der Zukunft des Servers liegt). Veröffentlichen vergleicht Änderungen mit
  // ihm, nicht mit dem Start des Builds (#67).
  const gelesen = Timestamp.fromMillis(Date.now() - 1000);
  const [k, wg, ws, ss, ms] = await db.runTransaction(t => Promise.all([t.get(kuenstlerRef),
    ...["werkgruppen", "works", "seiten", "medien"].map(c => t.get(kuenstlerRef.collection(c)))]),
    { readOnly: true, readTime: gelesen });
  if (!k.exists) throw new Error(`artist "${kuenstlerId}" not in Firestore`);
  const { titel, websiteTitel, titelZeile1, titelZeile2, copyright } = k.data()!;
  const kuenstler = { titel, websiteTitel, titelZeile1, titelZeile2, copyright };
  const felder: Feld[] = felderVon(k.data());
  const medien = new Map(ms.docs.map(d => [d.id, d.data() as Medium]));

  const werkgruppen: Werkgruppe[] = wg.docs.map(d => {
    const g = d.data();
    return {
      slug: d.id, titel: g.titel, kurztitel: g.kurztitel ?? undefined,
      reihenfolge: g.reihenfolge, cover: g.cover ?? undefined,
    };
  }).sort((a, b) => a.reihenfolge - b.reihenfolge);

  const bekannt = new Set(werkgruppen.map(g => g.slug));
  const werke: Werk[] = [];
  for (const d of ws.docs) {
    const w = d.data();
    if (!bekannt.has(w.werkgruppe)) {
      probleme.push(`work ${d.id}: unknown Werkgruppe "${w.werkgruppe}"`);
      continue;
    }
    if (d.id !== slugify(w.InvNr ?? "", { lower: true })) {
      probleme.push(`work ${d.id}: id does not match its Inv. Nr. "${w.InvNr}"`);
    }
    werke.push({ InvNr: w.InvNr, Titel: wert(w.Titel), slug: d.id, werkgruppe: w.werkgruppe, images: w.images,
      werte: werteVon(w, felder), ...(w.ausgeblendet === true && { ausgeblendet: true }) });
  }

  const seiten: Seite[] = ss.docs.map(d => {
    const s = d.data();
    return { slug: d.id, titel: s.titel, kategorie: s.kategorie, reihenfolge: s.reihenfolge, text: s.text };
  }).sort((a, b) => a.reihenfolge - b.reihenfolge);

  return { kuenstler, felder, werkgruppen, werke, seiten, medien, probleme, gelesen: gelesen.toDate().toISOString() };
}
