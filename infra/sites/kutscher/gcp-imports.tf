# Was es vor Terraform schon gab: der Web-Schlüssel, den Firebase angelegt hat
# (#43). Nach dem ersten Apply überflüssig, schadet aber nicht.
import {
  to = google_apikeys_key.web[0]
  id = "projects/vollrad-werkverzeichnis/locations/global/keys/6749c332-7e98-4606-b3b4-3f0f1de60138"
}
