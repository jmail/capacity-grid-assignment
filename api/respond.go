package main

import (
	"context"
	"errors"
	"log"
	"net/http"
)

// writeError sends the error shape the web client reads: {"error": "..."}.
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// serverError logs the cause and keeps it out of the response.
//
// A cancelled request is not an error. The grid abandons a range request when
// the manager moves on, which cancels the query; nobody is waiting for an answer
// and nothing went wrong, so it must not show up in the logs as a failure.
func serverError(w http.ResponseWriter, what string, err error) {
	if errors.Is(err, context.Canceled) {
		return
	}
	log.Printf("%s: %v", what, err)
	writeError(w, http.StatusInternalServerError, "internal error")
}
