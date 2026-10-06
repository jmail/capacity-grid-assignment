package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
)

// maxWeeklyHours is the number of hours in a week; nothing above it can be real.
const maxWeeklyHours = 168

// weeklyHoursStep is the finest value accepted: a quarter of an hour, which
// covers contracts like 37.5 or 38.75. Quarters are exact in binary floating
// point, so the check below needs no tolerance.
const weeklyHoursStep = 0.25

type updatePersonRequest struct {
	// Pointers so a missing field is rejected instead of read as 0.
	WeeklyHours *float64 `json:"weeklyHours"`
	// The value the manager was looking at when they made the change.
	ExpectedWeeklyHours *float64 `json:"expectedWeeklyHours"`
}

type personResponse struct {
	ID          int     `json:"id"`
	Name        string  `json:"name"`
	WeeklyHours float64 `json:"weeklyHours"`
}

// conflictResponse is the 409 body: the usual error, plus what is stored now so
// the grid can show it and let the manager decide.
type conflictResponse struct {
	Error   string         `json:"error"`
	Current personResponse `json:"current"`
}

// handleUpdatePerson serves PATCH /api/people/{id} with
// {"weeklyHours": 32, "expectedWeeklyHours": 40}.
//
// It returns the person as stored. Weekly hours are the only input to capacity,
// so that row is everything the grid needs to correct itself after a save.
//
// The update only applies if the stored value is still the expected one.
// Otherwise two managers editing the same person would overwrite each other
// silently, the later one deciding from a number that was no longer true. The
// schema has no version column, so the value itself is the precondition.
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
		writeError(w, http.StatusBadRequest, `body must be JSON like {"weeklyHours": 32, "expectedWeeklyHours": 40}`)
		return
	}
	if err := validateWeeklyHours(req.WeeklyHours); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.ExpectedWeeklyHours == nil {
		writeError(w, http.StatusBadRequest, "expectedWeeklyHours is required: the value being changed from")
		return
	}

	var p personResponse
	err = s.db.QueryRow(r.Context(), `
		UPDATE people
		SET weekly_hours = $1::float8::numeric
		WHERE id = $2 AND weekly_hours = $3::float8::numeric
		RETURNING id, name, weekly_hours::float8`,
		*req.WeeklyHours, id, *req.ExpectedWeeklyHours,
	).Scan(&p.ID, &p.Name, &p.WeeklyHours)
	if err == nil {
		writeJSON(w, http.StatusOK, p)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		serverError(w, "update person", err)
		return
	}

	// Nothing matched: the person does not exist, or their hours have moved on.
	// A fresh read tells which, and it sees the other manager's committed value.
	err = s.db.QueryRow(r.Context(),
		`SELECT id, name, weekly_hours::float8 FROM people WHERE id = $1`, id,
	).Scan(&p.ID, &p.Name, &p.WeeklyHours)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "person not found")
		return
	}
	if err != nil {
		serverError(w, "read person after conflict", err)
		return
	}
	writeJSON(w, http.StatusConflict, conflictResponse{
		Error:   "weekly hours were changed by someone else",
		Current: p,
	})
}

func validateWeeklyHours(hours *float64) error {
	if hours == nil {
		return errors.New("weeklyHours is required")
	}
	if *hours < 0 || *hours > maxWeeklyHours {
		return fmt.Errorf("weeklyHours must be between 0 and %d", maxWeeklyHours)
	}
	// Refused rather than rounded: saving a different number from the one that
	// was sent would leave the manager looking at a value they never chose.
	if steps := *hours / weeklyHoursStep; steps != math.Trunc(steps) {
		return errors.New("weeklyHours must be in quarter hours, like 37.5 or 38.25")
	}
	return nil
}
