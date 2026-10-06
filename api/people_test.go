package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func patchPerson(t *testing.T, s *server, id, body string) (int, personResponse) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPatch, "/api/people/"+id, strings.NewReader(body))
	req.SetPathValue("id", id)
	rec := httptest.NewRecorder()
	s.handleUpdatePerson(rec, req)

	var p personResponse
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
			t.Fatalf("decode: %v", err)
		}
	}
	return rec.Code, p
}

func TestUpdatePersonChangesCapacity(t *testing.T) {
	s := newTestServer(t)

	// Dee Okafor. Put back whatever was there, which is not necessarily the seed
	// value once someone has used the app.
	const deeID = "4"
	var before float64
	if err := s.db.QueryRow(context.Background(), `SELECT weekly_hours::float8 FROM people WHERE id = 4`).Scan(&before); err != nil {
		t.Fatalf("read current value: %v", err)
	}
	t.Cleanup(func() {
		if _, err := s.db.Exec(context.Background(), `UPDATE people SET weekly_hours = $1::float8::numeric WHERE id = 4`, before); err != nil {
			t.Errorf("restore previous value: %v", err)
		}
	})

	status, person := patchPerson(t, s, deeID, fmt.Sprintf(`{"weeklyHours": 37.5, "expectedWeeklyHours": %v}`, before))
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if person.ID != 4 || person.Name != "Dee Okafor" || person.WeeklyHours != 37.5 {
		t.Errorf("response = %+v, want Dee Okafor with 37.5", person)
	}

	_, resp := getCapacity(t, s, "from=2026-01-05&to=2026-01-11")
	for _, p := range resp.People {
		if p.ID == 4 && p.WeeklyHours != 37.5 {
			t.Errorf("capacity endpoint still reports %v after the update", p.WeeklyHours)
		}
	}
}

// Two managers have the grid open. The first saves; the second, still looking at
// the old number, saves too. The second save must not go through silently.
func TestUpdatePersonRefusesAnEditMadeFromAStaleValue(t *testing.T) {
	s := newTestServer(t)

	var stored float64
	if err := s.db.QueryRow(context.Background(), `SELECT weekly_hours::float8 FROM people WHERE id = 4`).Scan(&stored); err != nil {
		t.Fatalf("read current value: %v", err)
	}

	// The second manager believes the value is something it no longer is.
	body := fmt.Sprintf(`{"weeklyHours": 20, "expectedWeeklyHours": %v}`, stored+1)
	req := httptest.NewRequest(http.MethodPatch, "/api/people/4", strings.NewReader(body))
	req.SetPathValue("id", "4")
	rec := httptest.NewRecorder()
	s.handleUpdatePerson(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
	var conflict conflictResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &conflict); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if conflict.Current.ID != 4 || conflict.Current.WeeklyHours != stored {
		t.Errorf("current = %+v, want the stored value %v so the grid can show it", conflict.Current, stored)
	}

	var after float64
	if err := s.db.QueryRow(context.Background(), `SELECT weekly_hours::float8 FROM people WHERE id = 4`).Scan(&after); err != nil {
		t.Fatalf("read value after: %v", err)
	}
	if after != stored {
		t.Errorf("stored value changed from %v to %v despite the conflict", stored, after)
	}
}

func TestValidateWeeklyHours(t *testing.T) {
	hours := func(h float64) *float64 { return &h }

	for _, ok := range []float64{0, 20, 37.5, 38.25, 38.75, 168} {
		if err := validateWeeklyHours(hours(ok)); err != nil {
			t.Errorf("%v rejected: %v", ok, err)
		}
	}

	// Anything finer than a quarter of an hour is refused, not rounded: a manager
	// who types 41.12566476 should be told, rather than find 41.13 saved.
	for _, bad := range []float64{-0.25, 168.25, 41.12566476, 41.1, 0.01} {
		if err := validateWeeklyHours(hours(bad)); err == nil {
			t.Errorf("%v accepted", bad)
		}
	}
	if err := validateWeeklyHours(nil); err == nil {
		t.Error("missing value accepted")
	}
}

func TestUpdatePersonRejectsBadInput(t *testing.T) {
	s := newTestServer(t)

	tests := []struct {
		name   string
		id     string
		body   string
		status int
	}{
		{"unknown person", "999999", `{"weeklyHours": 40, "expectedWeeklyHours": 40}`, http.StatusNotFound},
		{"no expected value, so the edit could overwrite blindly", "4", `{"weeklyHours": 40}`, http.StatusBadRequest},
		{"non-numeric id", "abc", `{"weeklyHours": 40}`, http.StatusBadRequest},
		{"id too large for the id column", "99999999999", `{"weeklyHours": 40, "expectedWeeklyHours": 40}`, http.StatusBadRequest},
		{"negative hours", "4", `{"weeklyHours": -1}`, http.StatusBadRequest},
		{"more hours than a week has", "4", `{"weeklyHours": 169}`, http.StatusBadRequest},
		{"finer than a quarter hour", "4", `{"weeklyHours": 41.12566476}`, http.StatusBadRequest},
		{"missing field would otherwise save 0", "4", `{}`, http.StatusBadRequest},
		{"null", "4", `{"weeklyHours": null}`, http.StatusBadRequest},
		{"wrong type", "4", `{"weeklyHours": "forty"}`, http.StatusBadRequest},
		{"unknown field", "4", `{"weeklyHours": 40, "expectedWeeklyHours": 40, "name": "x"}`, http.StatusBadRequest},
		{"not JSON", "4", `weeklyHours=40`, http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if status, _ := patchPerson(t, s, tt.id, tt.body); status != tt.status {
				t.Errorf("status = %d, want %d", status, tt.status)
			}
		})
	}
}
