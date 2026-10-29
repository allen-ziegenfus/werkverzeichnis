#!/usr/bin/env python3
"""Zeigt den Plan einer Infrastructure-Manager-Vorschau kurz an.

    infra/plan.py projects/<p>/locations/<ort>/previews/<name>

Liest den Plan über :export (signierte URL, JSON) mit dem Token von gcloud.
Exit 0: keine Löschungen; 3: der Plan löscht oder ersetzt etwas; 1: Vorschau
gescheitert. apply.sh und alle.sh nutzen das, damit nichts unbemerkt gelöscht wird.

Der Fingerabdruck fasst zusammen, was der Plan mit welcher Ressource tut
(nicht die einzelnen Werte). Ist ERWARTET gesetzt und der Plan
ein anderer, Exit 4: die Zentrale wendet nur an, was bestätigt wurde (#60).
In Cloud Build geht der Plan kurz nach $BUILDER_OUTPUT/output; die Zentrale
liest ihn aus dem Build (höchstens 4 KB, Löschungen zuerst).
"""
import hashlib
import json
import os
import subprocess
import sys
import urllib.request

API = "https://config.googleapis.com/v1/"


def anfrage(url, token, daten=None):
    req = urllib.request.Request(url, method="POST" if daten is not None else "GET",
                                 data=json.dumps(daten).encode() if daten is not None else None,
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as antwort:
        return json.load(antwort)


def holen(befehl):
    erg = subprocess.run(befehl, capture_output=True, text=True)
    return erg.stdout.strip() if erg.returncode == 0 else ""


def ausgeben(ordner, fingerabdruck, zaehler, zeilen):
    """Der Plan für die Zentrale; was nicht in 4 KB passt, zählt nur noch mit."""
    ergebnis = {"fingerabdruck": fingerabdruck, "zaehler": zaehler, "aenderungen": [], "weitere": 0}
    for z in sorted(zeilen, key=lambda z: ("delete" not in z.split(" ")[0], z)):
        aktionen, adresse = z.split(" ", 1)
        ergebnis["aenderungen"].append([aktionen, adresse])
        if len(json.dumps(ergebnis)) > 3900:
            ergebnis["aenderungen"].pop()
            ergebnis["weitere"] = len(zeilen) - len(ergebnis["aenderungen"])
            break
    with open(os.path.join(ordner, "output"), "w") as datei:
        json.dump(ergebnis, datei)


def main(name):
    token = holen(["gcloud", "auth", "print-access-token"]) \
        or holen(["gcloud", "auth", "application-default", "print-access-token"])
    vorschau = anfrage(API + name, token)
    if vorschau.get("state") != "SUCCEEDED":
        print(f"Vorschau {vorschau.get('state')}: {vorschau.get('errorCode', '')}")
        for f in vorschau.get("tfErrors", []):
            print(f"  {f.get('resourceAddress', '')}: {f.get('errorDescription', '')[:300]}")
        print(f"  Log: {vorschau.get('logs', '')}")
        return 1
    export = anfrage(API + name + ":export", token, {})
    uri = export["result"]["jsonSignedUri"]
    with urllib.request.urlopen(uri if isinstance(uri, str) else uri["signedUri"]) as antwort:
        plan = json.load(antwort)

    zaehler = {"create": 0, "update": 0, "delete": 0}
    loescht = False
    zeilen = []
    for r in plan.get("resource_changes", []):
        aktionen = r["change"]["actions"]
        if aktionen in (["no-op"], ["read"]):
            continue
        for a in aktionen:
            if a in zaehler:
                zaehler[a] += 1
        if "delete" in aktionen:
            loescht = True
        print(f"  {'+'.join(aktionen):15} {r['address']}")
        zeilen.append(f"{'+'.join(aktionen)} {r['address']}")
    print(f"Plan: {zaehler['create']} anlegen, {zaehler['update']} ändern, {zaehler['delete']} löschen")
    # Auch nur geänderte Ausgaben brauchen ein Apply (alle.sh, #155).
    ausgaben = [n for n, o in plan.get("output_changes", {}).items() if o.get("actions") not in (["no-op"], None)]
    if ausgaben:
        print(f"Ausgaben ändern sich: {', '.join(sorted(ausgaben))}")
    fingerabdruck = hashlib.sha256("\n".join(sorted(zeilen)).encode()).hexdigest()[:16]
    print(f"Fingerabdruck: {fingerabdruck}")
    if os.environ.get("BUILDER_OUTPUT"):
        ausgeben(os.environ["BUILDER_OUTPUT"], fingerabdruck, zaehler, zeilen)
    erwartet = os.environ.get("ERWARTET", "")
    if erwartet and erwartet != fingerabdruck:
        print(f"Der Plan ist nicht mehr der bestätigte ({erwartet}).")
        return 4
    if loescht:
        print("Der Plan löscht oder ersetzt etwas.")
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
