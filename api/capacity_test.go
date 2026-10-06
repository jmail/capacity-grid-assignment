package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestParseWeekRange(t *testing.T) {
	tests := []struct {
		name      string
		from, to  string
		wantFirst string
		wantLast  string
		wantErr   string
	}{
		{name: "already whole weeks", from: "2025-12-29", to: "2026-01-18", wantFirst: "2025-12-29", wantLast: "2026-01-12"},
		{name: "mid-week ends widen to whole weeks", from: "2025-12-31", to: "2026-01-16", wantFirst: "2025-12-29", wantLast: "2026-01-12"},
		{name: "sunday belongs to the week that started six days earlier", from: "2026-01-04", to: "2026-01-04", wantFirst: "2025-12-29", wantLast: "2025-12-29"},
		{name: "single day", from: "2026-01-07", to: "2026-01-07", wantFirst: "2026-01-05", wantLast: "2026-01-05"},
		{name: "exactly the maximum", from: "2026-01-05", to: "2026-07-05", wantFirst: "2026-01-05", wantLast: "2026-06-29"},
		{name: "one week over the maximum", from: "2026-01-05", to: "2026-07-06", wantErr: "maximum is 26"},
		{name: "missing from", from: "", to: "2026-01-05", wantErr: "required"},
		{name: "missing to", from: "2026-01-05", to: "", wantErr: "required"},
		{name: "not a date", from: "tomorrow", to: "2026-01-05", wantErr: "from must be a date"},
		{name: "impossible date", from: "2026-01-05", to: "2026-02-30", wantErr: "to must be a date"},
		{name: "reversed", from: "2026-01-12", to: "2026-01-05", wantErr: "must not be after"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			first, last, err := parseWeekRange(tt.from, tt.to)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("error = %v, want one containing %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got := first.Format(dateLayout); got != tt.wantFirst {
				t.Errorf("first week = %s, want %s", got, tt.wantFirst)
			}
			if got := last.Format(dateLayout); got != tt.wantLast {
				t.Errorf("last week = %s, want %s", got, tt.wantLast)
			}
		})
	}
}

// newTestServer connects to the seeded database. The expectations below are read
// off db/seed.sql, which is fixed input.
func newTestServer(t *testing.T) *server {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set; run with: docker compose exec api go test ./...")
	}
	db, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(db.Close)
	return &server{db: db}
}

func getCapacity(t *testing.T, s *server, query string) (int, capacityResponse) {
	t.Helper()
	rec := httptest.NewRecorder()
	s.handleCapacity(rec, httptest.NewRequest(http.MethodGet, "/api/capacity?"+query, nil))

	var resp capacityResponse
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode: %v", err)
		}
	}
	return rec.Code, resp
}

func TestCapacityAgainstSeed(t *testing.T) {
	s := newTestServer(t)

	// The starter range ends on a Friday; the response reports whole weeks.
	status, resp := getCapacity(t, s, "from=2025-12-29&to=2026-01-16")
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if resp.From != "2025-12-29" || resp.To != "2026-01-18" {
		t.Errorf("range = %s..%s, want 2025-12-29..2026-01-18", resp.From, resp.To)
	}
	if want := []string{"2025-12-29", "2026-01-05", "2026-01-12"}; !reflect.DeepEqual(resp.Weeks, want) {
		t.Fatalf("weeks = %v, want %v", resp.Weeks, want)
	}
	if len(resp.People) != 500 {
		t.Errorf("people = %d, want all 500, including those with nothing assigned in range", len(resp.People))
	}

	byName := map[string]personCapacity{}
	for _, p := range resp.People {
		byName[p.Name] = p
	}

	// Only allocations are pinned. Weekly hours can be changed through the app, so
	// asserting the seed's values here would fail as soon as someone used it.
	tests := []struct {
		name      string
		allocated []float64
		why       string
	}{
		{"Ana Ferreira", []float64{56, 0, 30}, "Mon-Sun at 8h/day is 56h: every day of an assignment counts, weekends too"},
		{"Bo Lindqvist", []float64{0, 48, 8}, "a Fri-Mon assignment puts Fri, Sat and Sun in one week and Mon in the next"},
		{"Cem Aydin", []float64{0, 4, 12}, "single-day and part-week assignments"},
		{"Dee Okafor", []float64{0, 45, 40}, "overlapping projects add up"},
		{"Eli Nakamura", []float64{0, 20, 0}, "someone with no capacity still has their allocation reported"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := byName[tt.name]
			if !ok {
				t.Fatalf("%s missing from response", tt.name)
			}
			if !reflect.DeepEqual(got.Allocated, tt.allocated) {
				t.Errorf("allocated = %v, want %v (%s)", got.Allocated, tt.allocated, tt.why)
			}
		})
	}
}

func TestCapacityOrdersNamesAlphabetically(t *testing.T) {
	s := newTestServer(t)

	_, resp := getCapacity(t, s, "from=2026-01-05&to=2026-01-11")
	row := map[string]int{}
	for i, p := range resp.People {
		row[p.Name] = i
	}

	// The database's default collation compares bytes, which puts every "Inés"
	// after every "Ingrid" because é sorts after g.
	if row["Inés Álvarez"] > row["Ingrid Hagen"] {
		t.Errorf("Inés Álvarez is on row %d, after Ingrid Hagen on row %d", row["Inés Álvarez"], row["Ingrid Hagen"])
	}
}

func TestCapacityAbandonedRequestIsNotAServerError(t *testing.T) {
	s := newTestServer(t)

	var logged bytes.Buffer
	log.SetOutput(&logged)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	// The manager moved to another range before this one answered.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest(http.MethodGet, "/api/capacity?from=2026-01-05&to=2026-01-11", nil).WithContext(ctx)
	rec := httptest.NewRecorder()
	s.handleCapacity(rec, req)

	if rec.Code == http.StatusInternalServerError || logged.Len() > 0 {
		t.Errorf("status %d, logged %q; an abandoned request should be dropped quietly", rec.Code, logged.String())
	}
}

func TestCapacityRejectsBadRanges(t *testing.T) {
	s := newTestServer(t)

	for _, query := range []string{"", "from=2026-01-05", "from=2026-01-12&to=2026-01-05", "from=2025-01-06&to=2026-01-05"} {
		if status, _ := getCapacity(t, s, query); status != http.StatusBadRequest {
			t.Errorf("query %q: status = %d, want 400", query, status)
		}
	}
}
