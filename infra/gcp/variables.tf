variable "projekt_id" {
  description = "Das GCP-Projekt der Seite."
  type        = string
}

variable "infra_projekt" {
  description = "Das Infra-Projekt (setzt apply.sh); dort läuft die Zentrale."
  type        = string
}

variable "region" {
  type    = string
  default = "europe-west3"
}

variable "kuenstler" {
  description = "Kennung der Künstler:in in Firestore (artists/{kuenstler}); die ARTIST_ID des Builds."
  type        = string
}

variable "firestore_datenbank" {
  type    = string
  default = "werkverzeichnis"
}

variable "bucket" {
  description = "Bucket der Originale. Null: <projekt>.firebasestorage.app, den Firebase anlegt."
  type        = string
  default     = null
}

variable "github_verbindung" {
  description = <<-EOT
    Name der GitHub-Verbindung von Cloud Build. Ohne github_app_installation in
    der Konsole angelegt (braucht eine Anmeldung im Browser), sonst von Terraform.
  EOT
  type        = string
}

variable "github_app_installation" {
  description = <<-EOT
    Gesetzt: Terraform legt die GitHub-Verbindung selbst an (#112), mit dieser
    Installation der Cloud-Build-App auf GitHub (dieselbe für alle Seiten;
    steht bei jeder bestehenden Verbindung) und dem Token aus dem Secret
    github-token des Infra-Projekts (bootstrap.sh infra). Es steht dann auch im
    Terraform-State.
  EOT
  type        = number
  default     = null
}

variable "github_repo" {
  description = "besitzer/name auf GitHub."
  type        = string
}

variable "branch" {
  description = "Branch, den der Trigger baut, und Pages-Branch, auf den er deployt."
  type        = string
}

variable "seiten_url" {
  type = string
}

variable "pages_projekt" {
  description = "Cloudflare-Pages-Projekt, auf das der Build deployt."
  type        = string
}

variable "cloudflare_konto_id" {
  type = string
}

variable "web_schluessel" {
  description = <<-EOT
    ID des Web-Schlüssels der Verwaltung (der apiKey in firebaseClient.js). Bei
    einer neuen Seite eine beliebige, z. B. "web": Terraform legt ihn an (#110).
    Hat Firebase schon einen angelegt (Web-App in der Console), seine ID
    (gcloud services api-keys lookup <apiKey>) und ein Import in
    sites/<seite>/gcp-imports.tf. Terraform schränkt ihn ein (#43).
  EOT
  type        = string
  default     = null
}

variable "web_adressen" {
  description = "Wo die Seite läuft, als Referrer-Muster für den Web-Schlüssel, z. B. https://*.example.pages.dev/*. Dazu kommen immer localhost und die Firebase-Domains des Projekts."
  type        = list(string)
  default     = []
}
