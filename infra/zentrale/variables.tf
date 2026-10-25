variable "infra_projekt" {
  description = "Das Infra-Projekt; die Zentrale läuft dort."
  type        = string
}

variable "region" {
  type    = string
  default = "europe-west3"
}

variable "github_verbindung" {
  description = "GitHub-Verbindung von Cloud Build im Infra-Projekt, angelegt in der Konsole (BOOTSTRAP.md §6)."
  type        = string
  default     = "werkverzeichnis"
}

variable "github_repo" {
  description = "besitzer/name auf GitHub."
  type        = string
  default     = "allen-ziegenfus/werkverzeichnis"
}

variable "branch" {
  description = "Branch, von dem der Trigger die Zentrale deployt."
  type        = string
  default     = "main"
}
