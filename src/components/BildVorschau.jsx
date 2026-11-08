import { useEffect, useState } from "react";
import { doc, getDoc, getDocFromServer, onSnapshot } from "firebase/firestore";
import { useQuery } from "@tanstack/react-query";
import { Lightbox } from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import { kuenstler, KUENSTLER } from "./firebaseClient.js";

/**
 * Vorschau der Bilder in der Verwaltung (#259, #270). Die Bildfunktion
 * (gcf/process.js) trägt je Objektpfad unter pfade/ die MD5 ein und unter
 * medien/<md5>, was sie erzeugt hat; die Webversionen liefert die Seite schon
 * vor dem Veröffentlichen unter /bilder aus.
 */

// Kennung wie pfadSchluessel in gcf/process.js.
const pfadDok = pfad => doc(kuenstler, "pfade", encodeURIComponent(pfad));
const adresse = (medium, breite) => `/bilder/${KUENSTLER}/${medium.id}-${breite}.webp`;
const klein = medium => adresse(medium, medium.breiten[0]);
const gross = medium => adresse(medium, medium.breiten.at(-1));

/** Einmal gelesen, für die Werktabelle: null, solange es noch keinen Eintrag gibt. */
async function mediumLesen(pfad) {
  const id = (await getDoc(pfadDok(pfad))).get("medium");
  if (!id) return null;
  const m = await getDoc(doc(kuenstler, "medien", id));
  return m.exists() ? { id, ...m.data() } : null;
}

/** Wie oft und wie lange nach einem Bild in Arbeit gesehen wird. */
const NACHSEHEN = 3000, HOECHSTENS = 5 * 60 * 1000;

/**
 * Live, für den Editor: undefined lädt, null noch kein Eintrag (wird verarbeitet), { lesefehler }.
 * Neben dem Listener wird beim Server nachgesehen, solange der Eintrag fehlt:
 * Mit Long Polling (firebaseClient.js, #121) meldete der Listener ein neues
 * pfade-Dokument erst beim nächsten eigenen Schreiben (#274). Vom Server, denn
 * getDoc antwortete aus dem Stand des Listeners.
 */
function useMediumLive(pfad) {
  const [id, setId] = useState();
  const [medium, setMedium] = useState();
  useEffect(() => {
    let gefunden = false;
    const ab = onSnapshot(pfadDok(pfad), d => {
      if (d.exists()) { gefunden = true; setId(d.get("medium")); }
      else setMedium(null);
    }, e => setMedium({ lesefehler: e.message }));
    const start = Date.now();
    const takt = setInterval(async () => {
      if (gefunden || Date.now() - start > HOECHSTENS) return clearInterval(takt);
      const d = await getDocFromServer(pfadDok(pfad)).catch(() => null);
      if (d?.exists()) { gefunden = true; setId(d.get("medium")); clearInterval(takt); }
    }, NACHSEHEN);
    return () => { ab(); clearInterval(takt); };
  }, [pfad]);
  useEffect(() => {
    if (!id) return;
    const ref = doc(kuenstler, "medien", id);
    const zeigen = d => d.exists() && setMedium({ id, ...d.data() });
    // Einmal vom Server, falls der Listener auch hier hinterherhinkt (#274).
    getDocFromServer(ref).then(zeigen, () => {});
    return onSnapshot(ref, d => d.exists() ? zeigen(d) : setMedium(null), e => setMedium({ lesefehler: e.message }));
  }, [id]);
  return medium;
}

/** Die Bilder eines Werks im Editor; ein Klick öffnet die Lightbox wie auf der Website. */
export default function BildListe({ bilder }) {
  const [media, setMedia] = useState({});   // Pfad → Medium, für die Lightbox
  const [offen, setOffen] = useState();     // Pfad des geöffneten Bilds
  const fertig = bilder.filter(p => media[p]?.art === "bild");
  const melden = (p, m) => setMedia(alt => alt[p] === m ? alt : { ...alt, [p]: m });
  return (
    <>
      <ul className="flex flex-wrap gap-3">
        {bilder.map(p => <Bild key={p} pfad={p} melden={melden} oeffnen={() => setOffen(p)} />)}
      </ul>
      {/* on.view: offen folgt dem Blättern, sonst springt sie zurück, wenn ein weiteres Bild fertig wird. */}
      <Lightbox open={fertig.includes(offen)} close={() => setOffen(undefined)}
                on={{ view: ({ index }) => fertig[index] && setOffen(fertig[index]) }}
                index={Math.max(0, fertig.indexOf(offen))}
                slides={fertig.map(p => ({ src: gross(media[p]), width: media[p].breite, height: media[p].hoehe,
                  alt: p.split("/").pop() }))} />
    </>
  );
}

function Bild({ pfad, melden, oeffnen }) {
  const medium = useMediumLive(pfad);
  useEffect(() => melden(pfad, medium), [medium]);
  const name = pfad.split("/").pop();
  return (
    <li className="w-28 text-xs space-y-1">
      {medium?.art === "bild" ? (
        <button type="button" onClick={oeffnen} title="Groß ansehen" className="block">
          <img src={klein(medium)} alt={name} loading="lazy"
               className="w-28 h-28 object-contain bg-gray-100 rounded border" />
        </button>
      ) : (
        <div className="w-28 h-28 bg-gray-100 rounded border flex items-center justify-center text-center p-1 text-gray-600">
          {medium === undefined ? "" : medium === null ? "wird verarbeitet…"
            : medium.lesefehler ? "Vorschau nicht verfügbar" : medium.art === "video" ? "Video"
            : medium.art === "fehler" ? "nicht lesbar" : "nicht unterstützt"}
        </div>
      )}
      <div className="break-all" title={medium?.fehler ?? medium?.lesefehler}>{name}</div>
    </li>
  );
}

/** Das erste Bild eines Werks klein, für die Werktabelle; einmal gelesen und zwischengespeichert. */
export function Vorschaubild({ pfad, ersatz }) {
  const { data: medium } = useQuery({
    queryKey: ["medium", pfad], queryFn: () => mediumLesen(pfad), enabled: !!pfad, staleTime: 5 * 60 * 1000,
    // Noch in Arbeit (gerade hochgeladen): zwei Minuten lang nachsehen. Nicht
    // länger: null ist auch ein Original, das nie verarbeitet wurde.
    refetchInterval: q => q.state.data === null && q.state.dataUpdateCount < 24 ? 5000 : false,
  });
  const [kaputt, setKaputt] = useState();   // die Adresse, die nicht lud: ein kaputter Ersatz sperrt nicht das fertige Bild
  // ersatz: das veröffentlichte Bild, solange es keinen Eintrag gibt.
  const src = medium?.art === "bild" ? klein(medium) : medium === null ? ersatz : undefined;
  if (!src || kaputt === src) return <div className="w-12 h-12 bg-gray-100 rounded" />;
  return <img src={src} alt="" loading="lazy" className="w-12 h-12 object-cover rounded"
              onError={() => setKaputt(src)} />;
}
