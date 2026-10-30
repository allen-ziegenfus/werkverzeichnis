/**
 * Der Verlauf von Seiten und Werken, zum Lesen aufbereitet (#204): Speichern
 * derselben Person kurz hintereinander wird eine Gruppe, je Feld vom ersten
 * Stand zum letzten. Eine Rücknahme hängt an der Gruppe, die sie zurücknimmt.
 *
 * Ein Eintrag kommt einheitlich herein:
 * { id, by, at, art: "angelegt" | "geändert" | "gelöscht", felder: { Feld: { von, zu } },
 *   rueckgaengig?, zurueckgesetzt? }
 */

// Zusammen gehört, was höchstens 15 Minuten auseinander liegt, und eine Gruppe
// umfasst höchstens eine Stunde: Langes Arbeiten wird nicht zu einem Eintrag.
const ABSTAND = 15 * 60_000, SPANNE = 60 * 60_000;
const ms = t => t?.toMillis() ?? Date.now();

const gruppierbar = e => e.art === "geändert" && !e.rueckgaengig && !e.zurueckgesetzt;

/**
 * Gruppen, neueste zuerst. `gleich(feld, a, b)` vergleicht zwei Werte eines
 * Felds. Jede Gruppe: { ids, eintraege, by, at, ab, art, felder, rueckgaengig,
 * zurueckgesetzt, zurueckgenommen: { Feld: Rücknahme }, ganzZurueck, verborgen }.
 */
export function gruppieren(eintraege, gleich) {
  const gruppen = [];
  for (const e of eintraege) {   // neueste zuerst
    const g = gruppen.at(-1);
    if (g && gruppierbar(g) && gruppierbar(e) && g.by === e.by
        && ms(g.ab) - ms(e.at) <= ABSTAND && ms(g.at) - ms(e.at) <= SPANNE) {
      g.eintraege.push(e); g.ids.push(e.id); g.ab = e.at;
    } else {
      gruppen.push({ ...e, ids: [e.id], eintraege: [e], ab: e.at, zurueckgenommen: {} });
    }
  }
  for (const g of gruppen) {
    if (g.eintraege.length === 1) continue;
    // Je Feld der älteste Stand davor und der neueste danach; was am Ende gleich ist, entfällt.
    const felder = {};
    for (const e of [...g.eintraege].reverse()) {
      for (const [f, c] of Object.entries(e.felder)) felder[f] = { von: f in felder ? felder[f].von : c.von, zu: c.zu };
    }
    g.felder = Object.fromEntries(Object.entries(felder).filter(([f, c]) => !gleich(f, c.von, c.zu)));
  }
  // Rücknahmen an ihre Gruppe hängen, außer sie wurden selbst zurückgenommen
  // oder kehren die Gruppe nicht genau um (etwa nur einen Eintrag darin); die bleiben sichtbar.
  const zurueckgenommen = new Set(gruppen.map(g => g.rueckgaengig).filter(Boolean));
  for (const u of gruppen) {
    if (!u.rueckgaengig || u.ids.some(id => zurueckgenommen.has(id))) continue;
    const ziel = gruppen.find(g => g !== u && g.ids.includes(u.rueckgaengig));
    // Nur, wenn sie die Gruppe wirklich umkehrt: zurück auf den Stand vor der Gruppe.
    const kehrtUm = f => f in ziel.felder
      && gleich(f, u.felder[f].von, ziel.felder[f].zu) && gleich(f, u.felder[f].zu, ziel.felder[f].von);
    if (!ziel || !Object.keys(u.felder).every(kehrtUm)) continue;
    for (const f of Object.keys(u.felder)) ziel.zurueckgenommen[f] = u;
    u.verborgen = true;
  }
  for (const g of gruppen) {
    const felder = Object.keys(g.felder);
    g.ganzZurueck = felder.length > 0 && felder.every(f => g.zurueckgenommen[f]);
  }
  return gruppen;
}

/**
 * Zeilen von `a` nach `b`: [" " | "-" | "+", Zeile]; gleiche Zeilen weit weg
 * von einer Änderung werden zu ["…"].
 */
export function zeilenUnterschied(a, b, umfeld = 1) {
  const x = (a ?? "").split("\n"), y = (b ?? "").split("\n");
  let zeilen;
  if (x.length * y.length > 250_000) {
    zeilen = [...x.map(t => ["-", t]), ...y.map(t => ["+", t])];
  } else {
    // Längste gemeinsame Teilfolge, von hinten.
    const L = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
    for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) {
      L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
    zeilen = [];
    let i = 0, j = 0;
    while (i < x.length && j < y.length) {
      if (x[i] === y[j]) { zeilen.push([" ", x[i]]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) zeilen.push(["-", x[i++]]);
      else zeilen.push(["+", y[j++]]);
    }
    while (i < x.length) zeilen.push(["-", x[i++]]);
    while (j < y.length) zeilen.push(["+", y[j++]]);
  }
  const nah = zeilen.map((_, k) => zeilen.slice(Math.max(0, k - umfeld), k + umfeld + 1).some(z => z[0] !== " "));
  return zeilen.flatMap((z, k) => nah[k] ? [z] : k > 0 && !nah[k - 1] ? [] : [["…"]]);
}
