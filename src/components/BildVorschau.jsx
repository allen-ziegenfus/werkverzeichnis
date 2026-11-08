import { useEffect, useState } from "react";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
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

/** Live, für den Editor: undefined lädt, null noch kein Eintrag (wird verarbeitet), { lesefehler }. */
function useMediumLive(pfad) {
  const [id, setId] = useState();
  const [medium, setMedium] = useState();
  useEffect(() => onSnapshot(pfadDok(pfad), d => {
    if (d.exists()) setId(d.get("medium"));
    else setMedium(null);
  }, e => setMedium({ lesefehler: e.message })), [pfad]);
  useEffect(() => id && onSnapshot(doc(kuenstler, "medien", id),
    d => setMedium(d.exists() ? { id, ...d.data() } : null),
    e => setMedium({ lesefehler: e.message })), [id]);
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
      <Lightbox open={fertig.includes(offen)} close={() => setOffen(undefined)}
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
export function Vorschaubild({ pfad }) {
  const { data: medium } = useQuery({
    queryKey: ["medium", pfad], queryFn: () => mediumLesen(pfad), enabled: !!pfad, staleTime: 5 * 60 * 1000,
    // Noch in Arbeit (gerade hochgeladen): nachsehen, bis es da ist.
    refetchInterval: q => q.state.data === null ? 5000 : false,
  });
  const [kaputt, setKaputt] = useState(false);
  if (medium?.art !== "bild" || kaputt) return <div className="w-12 h-12 bg-gray-100 rounded" />;
  return <img src={klein(medium)} alt="" loading="lazy" className="w-12 h-12 object-cover rounded"
              onError={() => setKaputt(true)} />;
}
