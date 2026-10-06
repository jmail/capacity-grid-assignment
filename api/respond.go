package main

import (
	"log"
	"net/http"
)

// writeError sends the error shape the web client reads: {"error": "..."}.
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// serverError logs the cause and keeps it out of the response.
func serverError(w http.ResponseWriter, what string, err error) {
	log.Printf("%s: %v", what, err)
	writeError(w, http.StatusInternalServerError, "internal error")
}
