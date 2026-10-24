# Die Zentrale (#27): eine Web-App für Super-Admin-Aufgaben in Cloud Run, nur
# über IAP erreichbar. Den Code deployt infra/zentrale/deploy.sh; Terraform legt
# den Dienst mit einem Platzhalter an und lässt das Image danach in Ruhe.

resource "google_project_service" "api" {
  for_each = toset([
    "run", "iap", "artifactregistry", "cloudbuild", "secretmanager", "iam",
  ])
  service            = "${each.key}.googleapis.com"
  disable_on_destroy = false
}

data "google_project" "infra" {}

# Wer in die Zentrale darf: eine E-Mail-Adresse je Zeile im Secret
# zentrale-zugang (bootstrap.sh zentrale). Nicht geheim, aber nicht fürs
# öffentliche Repo.
data "google_secret_manager_secret_version_access" "zugang" {
  secret = "zentrale-zugang"
}

locals {
  zugang = toset([
    for zeile in split("\n", nonsensitive(data.google_secret_manager_secret_version_access.zugang.secret_data)) :
    lower(trimspace(zeile)) if trimspace(zeile) != ""
  ])
}

# Unter diesem Konto läuft die App. Rechte in den Seiten-Projekten bekommt es
# erst mit den Funktionen, die sie brauchen.
resource "google_service_account" "zentrale" {
  account_id   = "zentrale"
  display_name = "Zentrale (Cloud Run)"
  depends_on   = [google_project_service.api]
}

# Baut die App bei gcloud run deploy --source.
resource "google_service_account" "bauen" {
  account_id   = "zentrale-bauen"
  display_name = "Zentrale: Build"
  depends_on   = [google_project_service.api]
}

resource "google_project_iam_member" "bauen" {
  project = var.infra_projekt
  role    = "roles/run.builder"
  member  = "serviceAccount:${google_service_account.bauen.email}"
}

resource "google_cloud_run_v2_service" "zentrale" {
  provider     = google-beta
  name         = "zentrale"
  location     = var.region
  launch_stage = "BETA"
  ingress      = "INGRESS_TRAFFIC_ALL"
  iap_enabled  = true

  deletion_protection = false

  template {
    service_account = google_service_account.zentrale.email
    containers {
      image = "us-docker.pkg.dev/cloudrun/container/hello"
    }
    scaling {
      max_instance_count = 1
    }
  }

  # Das Image setzt deploy.sh.
  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version, template[0].labels]
  }

  depends_on = [google_project_service.api]
}

# IAP ruft den Dienst mit seinem eigenen Dienst-Agenten auf.
resource "google_project_service_identity" "iap" {
  provider = google-beta
  service  = "iap.googleapis.com"
}

resource "google_cloud_run_v2_service_iam_member" "iap" {
  location = google_cloud_run_v2_service.zentrale.location
  name     = google_cloud_run_v2_service.zentrale.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_project_service_identity.iap.email}"
}

resource "google_iap_web_cloud_run_service_iam_member" "zugang" {
  for_each               = local.zugang
  project                = var.infra_projekt
  location               = google_cloud_run_v2_service.zentrale.location
  cloud_run_service_name = google_cloud_run_v2_service.zentrale.name
  role                   = "roles/iap.httpsResourceAccessor"
  member                 = "user:${each.value}"
}

output "adresse" {
  value = google_cloud_run_v2_service.zentrale.uri
}

output "bau_konto" {
  value = google_service_account.bauen.email
}
