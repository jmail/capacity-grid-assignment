package main

import (
	"errors"
	"fmt"
	"net/http"
	"time"
)

const dateLayout = "2006-01-02"

// maxRangeWeeks caps a single request. The grid is people × weeks, so an
// unbounded range is the easy way to ask for hundreds of thousands of cells.
const maxRangeWeeks = 26

// capacityResponse is what the grid consumes.
//
// Allocations are positional: people[n].allocated[i] is that person's total for
// weeks[i]. Capacity is sent once per person rather than per cell because the
// schema has a single weekly_hours per person; the grid derives every
// over-allocation flag from it, so one edit has exactly one number to update.
type capacityResponse struct {
	From   string           `json:"from"`  // Monday of the first week
	To     string           `json:"to"`    // Sunday of the last week
	Weeks  []string         `json:"weeks"` // Monday of each week, ascending
	People []personCapacity `json:"people"`
}

type personCapacity struct {
	ID          int       `json:"id"`
	Name        string    `json:"name"`
	WeeklyHours float64   `json:"weeklyHours"`
	Allocated   []float64 `json:"allocated"`
}

// capacityQuery returns one row per person per week, ordered so that a person's
// weeks arrive together and in week order. People without assignments still get
// a row per week.
//
// Every day of an assignment counts, Saturdays and Sundays included. The schema
// says nothing about who works which days, and people on shifts (retail,
// support) do work weekends. Leaving weekends out would report someone on a
// Wednesday-to-Sunday pattern as 24h when they are booked for 40h, and a missed
// overload costs a manager more than a false one. The price: an assignment
// written Monday to Sunday at 8h/day is 56h.
//
// A week is [week_start, week_start + 6], so the days an assignment contributes
// are plain date arithmetic, and the join condition guarantees at least one.
//
// Assignment rows are summed as they are. The seed stores one logical assignment
// as several rows with identical person, project and dates; they add up to the
// daily total and must not be de-duplicated.
//
// Names are ordered with an ICU collation because the database default compares
// bytes, which files "Inés" after "Ingrid" and every non-ASCII initial after "Z".
const capacityQuery = `
WITH weeks AS (
  SELECT gs::date AS week_start
  FROM generate_series($1::date, $2::date, interval '7 days') AS gs
),
allocations AS (
  SELECT a.person_id,
         w.week_start,
         sum(a.hours_per_day
             * (least(a.end_date, w.week_start + 6) - greatest(a.start_date, w.week_start) + 1)) AS hours
  FROM weeks w
  JOIN assignments a
    ON a.start_date <= w.week_start + 6
   AND a.end_date >= w.week_start
  GROUP BY a.person_id, w.week_start
)
SELECT p.id, p.name, p.weekly_hours::float8, COALESCE(al.hours, 0)::float8
FROM people p
CROSS JOIN weeks w
LEFT JOIN allocations al ON al.person_id = p.id AND al.week_start = w.week_start
ORDER BY p.name COLLATE "und-x-icu", p.id, w.week_start`

// handleCapacity serves GET /api/capacity?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// The range is widened to whole weeks: a week that is only partly inside
// from..to is reported in full, so a cell always means the same thing.
func (s *server) handleCapacity(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	firstWeek, lastWeek, err := parseWeekRange(q.Get("from"), q.Get("to"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	rows, err := s.db.Query(r.Context(), capacityQuery, firstWeek, lastWeek)
	if err != nil {
		serverError(w, "capacity query", err)
		return
	}
	defer rows.Close()

	resp := capacityResponse{
		From:   firstWeek.Format(dateLayout),
		To:     lastWeek.AddDate(0, 0, 6).Format(dateLayout),
		Weeks:  weekStarts(firstWeek, lastWeek),
		People: []personCapacity{},
	}
	for rows.Next() {
		var (
			p     personCapacity
			hours float64
		)
		if err := rows.Scan(&p.ID, &p.Name, &p.WeeklyHours, &hours); err != nil {
			serverError(w, "capacity scan", err)
			return
		}
		if n := len(resp.People); n == 0 || resp.People[n-1].ID != p.ID {
			p.Allocated = make([]float64, 0, len(resp.Weeks))
			resp.People = append(resp.People, p)
		}
		current := &resp.People[len(resp.People)-1]
		current.Allocated = append(current.Allocated, hours)
	}
	if err := rows.Err(); err != nil {
		serverError(w, "capacity rows", err)
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// parseWeekRange validates from/to and returns the Mondays of the first and last
// week they touch.
func parseWeekRange(from, to string) (firstWeek, lastWeek time.Time, err error) {
	if from == "" || to == "" {
		return firstWeek, lastWeek, errors.New("from and to are required, as YYYY-MM-DD")
	}
	fromDate, err := time.Parse(dateLayout, from)
	if err != nil {
		return firstWeek, lastWeek, errors.New("from must be a date like 2026-01-05")
	}
	toDate, err := time.Parse(dateLayout, to)
	if err != nil {
		return firstWeek, lastWeek, errors.New("to must be a date like 2026-01-05")
	}
	if toDate.Before(fromDate) {
		return firstWeek, lastWeek, errors.New("from must not be after to")
	}

	firstWeek, lastWeek = weekStart(fromDate), weekStart(toDate)
	if weeks := len(weekStarts(firstWeek, lastWeek)); weeks > maxRangeWeeks {
		return firstWeek, lastWeek, fmt.Errorf("range covers %d weeks; the maximum is %d", weeks, maxRangeWeeks)
	}
	return firstWeek, lastWeek, nil
}

// weekStart returns the Monday of the week d falls in.
func weekStart(d time.Time) time.Time {
	return d.AddDate(0, 0, -((int(d.Weekday()) + 6) % 7))
}

// weekStarts lists every Monday from firstWeek to lastWeek inclusive.
func weekStarts(firstWeek, lastWeek time.Time) []string {
	weeks := []string{}
	for d := firstWeek; !d.After(lastWeek); d = d.AddDate(0, 0, 7) {
		weeks = append(weeks, d.Format(dateLayout))
	}
	return weeks
}
