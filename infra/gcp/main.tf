# Das Google-Cloud-Projekt einer Seite: Firestore, der Bucket der Originale, die
# Servicekonten und was jedes darf, die Secrets (Werte kommen von Hand) und der
# Cloud-Build-Trigger. Firestore-Regeln, die Funktionen und die Seite selbst
# werden aus dem Repo deployt: die Seite mit cloudbuild.yaml, Regeln und Funktionen
# mit cloudbuild-backend.yaml (#3), jeweils über einen eigenen Trigger.

locals {
  bucket = coalesce(var.bucket, "${var.projekt_id}.firebasestorage.app")
  konten = { for k, v in google_service_account.konto : k => "serviceAccount:${v.email}" }
}

resource "google_project_service" "api" {
  for_each = toset([
    "apikeys", "artifactregistry", "cloudbuild", "cloudfunctions", "eventarc", "firebase", "firebaserules",
    "firestore", "iam", "iamcredentials", "identitytoolkit", "logging", "pubsub", "run",
    "secretmanager", "storage", "sts",
  ])
  service            = "${each.key}.googleapis.com"
  disable_on_destroy = false
}

# Den Web-Schlüssel von Firebase auf die Adressen der Seite und die Dienste
# einschränken, die der Client braucht (#43). Dafür braucht Terraform selbst
# (infra-manager@, bootstrap.sh add-site) das Recht auf API-Schlüssel.
resource "google_project_iam_member" "infra_manager_schluessel" {
  project = var.projekt_id
  role    = "roles/serviceusage.apiKeysAdmin"
  member  = "serviceAccount:infra-manager@${var.infra_projekt}.iam.gserviceaccount.com"
}

# Der Client (firebaseClient.js) braucht nur Anmeldung und Firestore; die
# Anmeldung läuft über die Seite <projekt>.firebaseapp.com.
resource "google_apikeys_key" "web" {
  count        = var.web_schluessel == null ? 0 : 1
  name         = var.web_schluessel
  display_name = "Browser key (auto created by Firebase)"

  restrictions {
    browser_key_restrictions {
      allowed_referrers = concat(var.web_adressen, [
        "https://${var.projekt_id}.firebaseapp.com/*",
        "https://${var.projekt_id}.web.app/*",
        "http://localhost/*",
        "http://localhost:4321/*", # astro dev
        "http://localhost:4322/*", # astro preview
      ])
    }
    dynamic "api_targets" {
      for_each = ["identitytoolkit.googleapis.com", "securetoken.googleapis.com", "firestore.googleapis.com"]
      content {
        service = api_targets.value
      }
    }
  }

  # Ohne ihn kann sich niemand mehr anmelden; zum Aufheben der Einschränkung
  # die Einschränkungen ändern, nicht den Schlüssel löschen.
  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.api, google_project_iam_member.infra_manager_schluessel]
}

resource "google_firebase_project" "projekt" {
  provider   = google-beta
  depends_on = [google_project_service.api]
}

resource "google_firestore_database" "datenbank" {
  name                    = var.firestore_datenbank
  location_id             = var.region
  type                    = "FIRESTORE_NATIVE"
  database_edition        = "ENTERPRISE"
  delete_protection_state = "DELETE_PROTECTION_ENABLED"
  deletion_policy         = "ABANDON"
  depends_on              = [google_project_service.api]
}

# Originale. Die Bildfunktion erzeugt daraus die Webversionen in R2.
resource "google_storage_bucket" "originale" {
  name                        = local.bucket
  location                    = upper(var.region)
  storage_class               = "REGIONAL"
  uniform_bucket_level_access = false
  lifecycle { prevent_destroy = true }
}

# --- Servicekonten -----------------------------------------------------------

resource "google_service_account" "konto" {
  for_each = {
    werkverzeichnis-build  = "Werkverzeichnis build"
    bilder-function        = "Bild-Funktion: Webversionen nach R2"
    publish-function       = "Veröffentlichen: Build starten, Status eintragen"
    werkverzeichnis-deploy = "Regeln und Funktionen deployen (#3)"
  }
  account_id   = each.key
  display_name = each.value
}

resource "google_project_iam_member" "rolle" {
  for_each = {
    "build-datastore"   = ["werkverzeichnis-build", "roles/datastore.viewer"]
    "build-logs"        = ["werkverzeichnis-build", "roles/logging.logWriter"]
    "bilder-datastore"  = ["bilder-function", "roles/datastore.user"]
    "bilder-events"     = ["bilder-function", "roles/eventarc.eventReceiver"]
    "bilder-invoker"    = ["bilder-function", "roles/run.invoker"]
    "publish-builds"    = ["publish-function", "roles/cloudbuild.builds.editor"]
    "publish-datastore" = ["publish-function", "roles/datastore.user"]
    "publish-events"    = ["publish-function", "roles/eventarc.eventReceiver"]
    "publish-invoker"   = ["publish-function", "roles/run.invoker"]
    # Regeln und Funktionen (cloudbuild-backend.yaml). Die Firebase CLI liest
    # außerdem Projekt, APIs und IAM-Richtlinie, bevor sie deployt.
    "deploy-logs"      = ["werkverzeichnis-deploy", "roles/logging.logWriter"]
    "deploy-regeln"    = ["werkverzeichnis-deploy", "roles/firebaserules.admin"]
    "deploy-funktion"  = ["werkverzeichnis-deploy", "roles/cloudfunctions.admin"]
    "deploy-registry"  = ["werkverzeichnis-deploy", "roles/artifactregistry.admin"]
    "deploy-firebase"  = ["werkverzeichnis-deploy", "roles/firebase.viewer"]
    "deploy-dienste"   = ["werkverzeichnis-deploy", "roles/serviceusage.serviceUsageConsumer"]
    "deploy-iam-lesen" = ["werkverzeichnis-deploy", "roles/iam.securityReviewer"]
  }
  project = var.projekt_id
  member  = local.konten[each.value[0]]
  role    = each.value[1]
}

resource "google_storage_bucket_iam_member" "originale_lesen" {
  for_each = toset(["werkverzeichnis-build", "bilder-function"])
  bucket   = google_storage_bucket.originale.name
  role     = "roles/storage.objectViewer"
  member   = local.konten[each.key]
}

# Die Veröffentlichen-Funktion startet den Trigger, dessen Builds als Build-Konto laufen.
resource "google_service_account_iam_member" "veroeffentlichen_als_build" {
  service_account_id = google_service_account.konto["werkverzeichnis-build"].name
  role               = "roles/iam.serviceAccountUser"
  member             = local.konten["publish-function"]
}

# Die Zentrale (#27) im Infra-Projekt: liest Stand und Builds der Seite, legt
# Veröffentlichungen an (#76), trägt Personen und Super-Admins ein (#78); mit IAM
# statt über die Firestore-Regeln.
resource "google_project_iam_member" "zentrale" {
  for_each = toset([
    "roles/datastore.user",
    "roles/cloudbuild.builds.viewer",
    "roles/firebaseauth.admin",                # Super-Admins (Custom Claim), wer sich angemeldet hat
    "roles/serviceusage.serviceUsageConsumer", # Firebase Auth rechnet auf das Projekt der Seite ab
  ])
  project = var.projekt_id
  role    = each.key
  member  = "serviceAccount:zentrale@${var.infra_projekt}.iam.gserviceaccount.com"
}

# Storage-Ereignisse erreichen die Bildfunktion über Pub/Sub.
data "google_storage_project_service_account" "gcs" {}

resource "google_project_iam_member" "gcs_ereignisse" {
  project = var.projekt_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${data.google_storage_project_service_account.gcs.email_address}"
}

# --- Secrets (Werte: gcloud secrets versions add, siehe BOOTSTRAP.md) --------

resource "google_secret_manager_secret" "geheimnis" {
  for_each  = toset(["r2-access-key-id", "r2-secret-access-key", "cloudflare-pages-token"])
  secret_id = each.key
  replication {
    auto {}
  }
  depends_on = [google_project_service.api]
}

resource "google_secret_manager_secret_iam_member" "leser" {
  for_each = {
    "r2-access-key-id"       = "bilder-function"
    "r2-secret-access-key"   = "bilder-function"
    "cloudflare-pages-token" = "werkverzeichnis-build"
  }
  secret_id = google_secret_manager_secret.geheimnis[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = local.konten[each.value]
}

# --- Bauen und veröffentlichen ------------------------------------------------

# Die GitHub-Verbindung ohne Konsole (#112): Cloud Build liest das GitHub-Token
# aus einer Kopie im Projekt der Seite; das Original liegt im Infra-Projekt.
data "google_secret_manager_secret_version_access" "github" {
  count   = var.github_app_installation == null ? 0 : 1
  project = var.infra_projekt
  secret  = "github-token"
}

resource "google_secret_manager_secret" "github" {
  count     = var.github_app_installation == null ? 0 : 1
  secret_id = "github-token"
  replication {
    auto {}
  }
  depends_on = [google_project_service.api]
}

resource "google_secret_manager_secret_version" "github" {
  count       = var.github_app_installation == null ? 0 : 1
  secret      = google_secret_manager_secret.github[0].id
  secret_data = data.google_secret_manager_secret_version_access.github[0].secret_data
}

resource "google_project_service_identity" "cloudbuild" {
  count    = var.github_app_installation == null ? 0 : 1
  provider = google-beta
  service  = "cloudbuild.googleapis.com"
}

resource "google_secret_manager_secret_iam_member" "github" {
  count     = var.github_app_installation == null ? 0 : 1
  secret_id = google_secret_manager_secret.github[0].id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_project_service_identity.cloudbuild[0].member
}

resource "google_cloudbuildv2_connection" "github" {
  count    = var.github_app_installation == null ? 0 : 1
  name     = var.github_verbindung
  location = var.region
  github_config {
    app_installation_id = var.github_app_installation
    authorizer_credential {
      oauth_token_secret_version = google_secret_manager_secret_version.github[0].id
    }
  }
  depends_on = [google_secret_manager_secret_iam_member.github]
}

resource "google_cloudbuildv2_repository" "repo" {
  name              = replace(var.github_repo, "/", "-")
  location          = var.region
  parent_connection = var.github_app_installation == null ? var.github_verbindung : google_cloudbuildv2_connection.github[0].name
  remote_uri        = "https://github.com/${var.github_repo}.git"
}

resource "google_cloudbuild_trigger" "seite" {
  name            = "werkverzeichnis-${var.branch}"
  description     = "Seite aus Firestore nach Cloudflare Pages (Push auf ${var.branch} oder Veröffentlichen)"
  location        = var.region
  filename        = "cloudbuild.yaml"
  service_account = google_service_account.konto["werkverzeichnis-build"].id

  repository_event_config {
    repository = google_cloudbuildv2_repository.repo.id
    push {
      branch = "^${var.branch}$"
    }
  }

  substitutions = {
    _SITE                  = var.seiten_url
    _ARTIST                = var.kuenstler
    _FIRESTORE_DATABASE    = var.firestore_datenbank
    _PAGES_PROJECT         = var.pages_projekt
    _CLOUDFLARE_ACCOUNT_ID = var.cloudflare_konto_id
  }
}

# Regeln und Funktionen: nur wenn sich daran etwas ändert (cloudbuild-backend.yaml).
resource "google_cloudbuild_trigger" "backend" {
  name            = "werkverzeichnis-backend-${var.branch}"
  description     = "Firestore-Regeln und Funktionen (Push auf ${var.branch})"
  location        = var.region
  filename        = "cloudbuild-backend.yaml"
  service_account = google_service_account.konto["werkverzeichnis-deploy"].id
  included_files = [
    "firestore.rules", "src/werkverzeichnis/permissions.js", "tools/rules_*.mjs",
    "gcf/**", "firebase.json", "cloudbuild-backend.yaml",
  ]

  repository_event_config {
    repository = google_cloudbuildv2_repository.repo.id
    push {
      branch = "^${var.branch}$"
    }
  }

  substitutions = {
    _FIRESTORE_DATABASE = var.firestore_datenbank
  }
}

# Die Funktionen laufen unter eigenen Konten; wer sie deployt, muss diese verwenden dürfen.
resource "google_service_account_iam_member" "deploy_als_funktion" {
  for_each           = toset(["bilder-function", "publish-function"])
  service_account_id = google_service_account.konto[each.key].name
  role               = "roles/iam.serviceAccountUser"
  member             = local.konten["werkverzeichnis-deploy"]
}

# Die Firebase CLI prüft vor jedem Deploy außerdem, ob sie das App-Engine-
# Standardkonto verwenden darf, auch wenn keine Funktion darunter läuft.
resource "google_service_account_iam_member" "deploy_als_appspot" {
  service_account_id = "projects/${var.projekt_id}/serviceAccounts/${var.projekt_id}@appspot.gserviceaccount.com"
  role               = "roles/iam.serviceAccountUser"
  member             = local.konten["werkverzeichnis-deploy"]
}

# Die Ereignis-Trigger der Funktionen laufen unter dem Compute-Standardkonto;
# neuere firebase-tools setzen sie beim Deploy mit, also braucht das Deploy auch dieses
# Konto (#97; firebase-tools ohne feste Version, seit dem 26.10.).
data "google_project" "projekt" {
  project_id = var.projekt_id
}

resource "google_service_account_iam_member" "deploy_als_compute" {
  service_account_id = "projects/${var.projekt_id}/serviceAccounts/${data.google_project.projekt.number}-compute@developer.gserviceaccount.com"
  role               = "roles/iam.serviceAccountUser"
  member             = local.konten["werkverzeichnis-deploy"]
}

# Cloud Build meldet hier jeden Build; gcf/publish.js (buildStatus) hört zu.
resource "google_pubsub_topic" "cloud_builds" {
  name       = "cloud-builds"
  depends_on = [google_project_service.api]
}
