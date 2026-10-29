#!/usr/bin/env bash
# Vorschau oder Anwenden für alle Deployments: jede Schicht jeder Seite unter
# infra/sites (sofern es ihre .tfvars gibt), dazu die Zentrale. Läuft in Cloud
# Build (cloudbuild-terraform.yaml, #58): Vorschau bei jedem PR, Anwenden nach
# dem Merge.
#
#   INFRA_PROJECT=<infra-projekt> infra/alle.sh preview|apply [<deployment>]
#
# Anwenden zeigt zuerst die Vorschau und lässt ein Deployment aus, dessen Plan
# etwas löscht oder ersetzt; das bleibt Handarbeit (apply.sh).
#
# Mit <deployment> (z. B. kutscher-gcp oder zentrale) nur dieses; so startet es
# die Zentrale (#60). Dann wendet es nur an, wenn der Plan den Fingerabdruck
# ERWARTET hat (der bestätigte Plan, plan.py), und löscht nur mit LOESCHEN=ja.
set -uo pipefail

befehl=${1:?preview or apply}
nur=${2:-}
hier=$(cd "$(dirname "$0")" && pwd)

ziele=()
for seite in "$hier"/sites/*/; do
  seite=$(basename "$seite")
  for schicht in gcp cloudflare; do
    [ -f "$hier/sites/$seite/$schicht.tfvars" ] && ziele+=("$schicht $seite")
  done
done
ziele+=("zentrale")

if [ -n "$nur" ]; then
  gefunden=""
  for ziel in "${ziele[@]}"; do
    read -r schicht seite <<<"$ziel"
    [ "${seite:+$seite-}$schicht" = "$nur" ] && gefunden=$ziel
  done
  [ -n "$gefunden" ] || { echo "!!! Kein Deployment $nur."; exit 1; }
  if [ "$befehl" = apply ] && [ -z "${ERWARTET:-}" ]; then
    echo "!!! Einzeln anwenden nur mit ERWARTET (Fingerabdruck des bestätigten Plans)."; exit 1
  fi
  ziele=("$gefunden")
else
  # Feste Namen, Bestätigungen und der Plan fürs Build-Ergebnis (plan.py) nur
  # für ein einzelnes Deployment.
  unset VORSCHAU ERWARTET LOESCHEN BUILDER_OUTPUT
fi

# Nacheinander (#131): Gleichzeitige Läufe sperren sich gegenseitig die
# Deployments. Erst warten, bis kein älterer Build der beiden Terraform-Trigger
# mehr läuft; Vorschauen zählen mit, sie sperren auch. Eine Vorschau bricht ab
# (rot, nicht grün: ein Retry kann einen älteren Commit haben, der Check gälte
# sonst ohne Vorschau), wenn für denselben PR schon eine neuere wartet. Ohne
# BUILD_ID (von Hand) oder ohne Leserechte geht es gleich los.
warten() {
  [ -n "${BUILD_ID:-}" ] || return 0
  local region=${INFRA_LOCATION:-europe-west3} zeit='date("%Y-%m-%dT%H:%M:%S.%f")'
  local eigen pr laufend aeltere bis=$((SECONDS + 2700)) gemeldet=""
  local versuch
  for versuch in 1 2 3; do
    eigen=$(gcloud builds describe "$BUILD_ID" --project="$INFRA_PROJECT" --region="$region" \
      --format="csv[no-heading](createTime.$zeit,substitutions._PR_NUMBER)" 2>/dev/null) && break
    sleep 5
  done
  IFS=, read -r eigen pr <<<"$eigen"
  if [ -z "$eigen" ]; then
    echo "Hinweis: Builds nicht lesbar, warte nicht auf ältere Läufe."; return 0
  fi
  while :; do
    if [ "$SECONDS" -ge "$bis" ]; then
      if [ -n "$aeltere" ]; then echo "!!! Seit 45 Minuten laufen noch ältere Terraform-Läufe:"; echo "$aeltere"
      else echo "!!! Seit 45 Minuten sind die Builds nicht lesbar."; fi
      exit 1
    fi
    # Fehler beim Lesen (Netz, Kontingent): später noch einmal, nicht einfach los.
    if ! laufend=$(gcloud builds list --project="$INFRA_PROJECT" --region="$region" --ongoing \
        --format="csv[no-heading](id,createTime.$zeit,substitutions.TRIGGER_NAME,substitutions._PR_NUMBER)" 2>/dev/null); then
      echo "Builds gerade nicht lesbar; neuer Versuch in 20 s."; sleep 20; continue
    fi
    laufend=$(awk -F, -v id="$BUILD_ID" 'NF && $1 != id && ($3 == "terraform-anwenden" || $3 == "terraform-vorschau")' <<<"$laufend")
    local neuere=""
    [ -n "$pr" ] && neuere=$(awk -F, -v e="$eigen" -v pr="$pr" '$2 > e && $3 == "terraform-vorschau" && $4 == pr { print $1 }' <<<"$laufend")
    if [ -n "$neuere" ]; then
      echo "!!! Überholt: Für PR #$pr wartet schon eine neuere Vorschau ($neuere); diese bricht ab."
      exit 1
    fi
    aeltere=$(awk -F, -v e="$eigen" 'NF && $2 < e { print $1 " (" $3 ")" }' <<<"$laufend")
    [ -z "$aeltere" ] && return 0
    if [ "$aeltere" != "$gemeldet" ]; then
      echo "Warte auf ältere Terraform-Läufe:"; echo "$aeltere"; gemeldet=$aeltere
    fi
    sleep 20
  done
}
warten

fehler=0
zusammenfassung=()   # je Deployment eine Zeile fürs Ende (#159)
for ziel in "${ziele[@]}"; do
  echo; echo "=== $ziel ==="
  read -r schicht seite <<<"$ziel"
  dname=${seite:+$seite-}$schicht   # wie das Deployment heißt, z. B. kutscher-gcp
  # shellcheck disable=SC2086 # Schicht und Seite als zwei Argumente
  ausgabe=$("$hier/apply.sh" preview $ziel | tee /dev/stderr)
  ergebnis=$?
  if [ $ergebnis -eq 3 ] && [ -n "$nur" ] && [ "${LOESCHEN:-}" = ja ]; then
    echo "Löschen bestätigt."
  elif [ $ergebnis -eq 3 ]; then
    echo "!!! $ziel löscht oder ersetzt etwas; nicht automatisch anwenden."
    zusammenfassung+=("$dname: ausgelassen, der Plan löscht oder ersetzt etwas")
    fehler=1; continue
  elif [ $ergebnis -eq 4 ]; then
    echo "!!! Der Plan für $ziel hat sich seit der Bestätigung geändert; nicht angewendet."
    zusammenfassung+=("$dname: nicht angewendet, der Plan hat sich seit der Bestätigung geändert")
    fehler=1; continue
  elif [ $ergebnis -ne 0 ]; then
    echo "!!! Vorschau für $ziel gescheitert."
    zusammenfassung+=("$dname: Vorschau gescheitert")
    fehler=1; continue
  fi
  # Ein leerer Plan ohne Importe und geänderte Ausgaben braucht kein Apply (#155); nur wenn
  # das Deployment nach einem gescheiterten Lauf FAILED steht, damit der Status
  # wieder stimmt.
  if [ "$befehl" = apply ] && grep -q "^Plan: 0 anlegen, 0 ändern, 0 löschen" <<<"$ausgabe" \
    && ! grep -q "^Ausgaben ändern sich" <<<"$ausgabe" \
    && ! grep -q "^Importe:" <<<"$ausgabe" \
    && [ "$(gcloud infra-manager deployments describe "$dname" --project="$INFRA_PROJECT" \
         --location="${INFRA_LOCATION:-europe-west3}" --format='value(state)' 2>/dev/null)" = ACTIVE ]; then
    echo "Nichts zu tun."
    zusammenfassung+=("$dname: nichts zu tun")
    continue
  fi
  if [ "$befehl" = apply ]; then
    # shellcheck disable=SC2086
    if "$hier/apply.sh" apply $ziel; then
      zusammenfassung+=("$dname: angewendet")
    else
      echo "!!! Anwenden für $ziel gescheitert."
      zusammenfassung+=("$dname: Anwenden gescheitert, Grund oben")
      fehler=1
    fi
  else
    zusammenfassung+=("$dname: Vorschau in Ordnung")
  fi
done

echo; echo "=== Zusammenfassung ==="
printf '%s\n' "${zusammenfassung[@]}"
exit $fehler
