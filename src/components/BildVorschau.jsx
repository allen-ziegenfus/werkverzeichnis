import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { kuenstler, KUENSTLER } from "./firebaseClient.js";

/**
 * Die Bilder eines Werks mit Vorschau (#259). Die Bildfunktion (gcf/process.js)
 * trägt je Objektpfad unter pfade/ die MD5 ein und unter medien/<md5>, was sie
 * erzeugt hat; die Webversionen liefert die Seite schon vor dem Veröffentlichen
 * unter /bilder aus. Bis die Einträge da sind, „wird verarbeitet…“.
 */
export default function BildListe({ bilder }) {
  return (
    <ul className="flex flex-wrap gap-3">
      {bilder.map(p => <Bild key={p} pfad={p} />)}
    </ul>
  );
}

function Bild({ pfad }) {
  const [id, setId] = useState();           // MD5 des Originals
  const [medium, setMedium] = useState();   // undefined: lädt, null: noch kein Eintrag, { lesefehler } beim Lesen
  // Kennung wie pfadSchluessel in gcf/process.js.
  useEffect(() => onSnapshot(doc(kuenstler, "pfade", encodeURIComponent(pfad)), d => {
    setId(d.get("medium"));
    if (!d.exists()) setMedium(null);
  }, e => setMedium({ lesefehler: e.message })), [pfad]);
  useEffect(() => id && onSnapshot(doc(kuenstler, "medien", id),
    d => setMedium(d.exists() ? { id, ...d.data() } : null),
    e => setMedium({ lesefehler: e.message })), [id]);
  const name = pfad.split("/").pop();
  const basis = medium && `/bilder/${KUENSTLER}/${medium.id}`;
  return (
    <li className="w-28 text-xs space-y-1">
      {medium?.art === "bild" ? (
        <a href={`${basis}-${medium.breiten.at(-1)}.webp`} target="_blank" rel="noopener" title="Groß ansehen">
          <img src={`${basis}-${medium.breiten[0]}.webp`} alt={name} loading="lazy"
               className="w-28 h-28 object-contain bg-gray-100 rounded border" />
        </a>
      ) : (
        <div className="w-28 h-28 bg-gray-100 rounded border flex items-center justify-center text-center p-1 text-gray-600">
          {medium === undefined ? "" : medium === null ? "wird verarbeitet…"
            : medium.lesefehler ? "Vorschau nicht verfügbar" : medium.art === "video" ? "Video" : medium.art === "fehler" ? "nicht lesbar" : "nicht unterstützt"}
        </div>
      )}
      <div className="break-all" title={medium?.fehler ?? medium?.lesefehler}>{name}</div>
    </li>
  );
}
