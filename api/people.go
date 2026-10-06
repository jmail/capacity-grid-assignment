package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
)

// maxWeeklyHours is the number of hours in a week; nothing above it can be real.
const maxWeeklyHours = 168

type updatePersonRequest struct {
	// A pointer so a missing field is rejected instead of saved as 0.
	WeeklyHours *float64 `json:"weeklyHours"`
}

type personResponse struct {
	ID          int     `json:"id"`
	Name        string  `json:"name"`
	WeeklyHours float64 `json:"weeklyHours"`
}

// handleUpdatePerson serves PATCH /api/people/{id} with {"weeklyHours": 32}.
//
// It returns the person as stored. Weekly hours are the only input to capacity,
// so that row is everything the grid needs to correct itself after a save.
func (s *server) handleUpdatePerson(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "person id must be a positive integer")
		return
	}

	var req updatePersonRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, `body must be JSON like {"weeklyHours": 32}`)
		return
	}
	if err := validateWeeklyHours(req.WeeklyHours); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	var p personResponse
	err = s.db.QueryRow(r.Context(), `
		UPDATE people
		SET weekly_hours = round($1::float8::numeric, 2)
		WHERE id = $2
		RETURNING id, name, weekly_hours::float8`,
		*req.WeeklyHours, id,
	).Scan(&p.ID, &p.Name, &p.WeeklyHours)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "person not found")
		return
	}
	if err != nil {
		serverError(w, "update person", err)
		return
	}

	writeJSON(w, http.StatusOK, p)
}

func validateWeeklyHours(hours *float64) error {
	if hours == nil {
		return errors.New("weeklyHours is required")
	}
	if *hours < 0 || *hours > maxWeeklyHours {
		return fmt.Errorf("weeklyHours must be between 0 and %d", maxWeeklyHours)
	}
	return nil
}
