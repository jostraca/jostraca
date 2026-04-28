package jostraca

import (
	"fmt"
	"sync"
	"testing"
)

// Phase 7 — proves the receiver-shadowing design from PORT_PLAN §2:
// each Generate call has its own *J/*jstate; concurrent calls cannot
// see each other's nodes or output.

func TestGenerateConcurrentIsolated(t *testing.T) {
	const N = 10
	var wg sync.WaitGroup
	results := make([]Result, N)
	errs := make([]error, N)

	for i := 0; i < N; i++ {
		i := i
		wg.Add(1)
		go func() {
			defer wg.Done()
			mem := NewMemFS()
			j := New(WithFS(mem), WithFolder("/out"))
			results[i], errs[i] = j.Generate(Options{}, func(j *J) {
				j.Project(ProjectProps{Folder: fmt.Sprintf("p%d", i)}, func(j *J) {
					j.File(fmt.Sprintf("f%d.txt", i), func(j *J) {
						j.Content(fmt.Sprintf("body-%d\n", i))
					})
				})
			})
		}()
	}
	wg.Wait()

	for i := 0; i < N; i++ {
		if errs[i] != nil {
			t.Errorf("[%d] err: %v", i, errs[i])
			continue
		}
		vol := results[i].Vol()
		wantPath := fmt.Sprintf("/out/p%d/f%d.txt", i, i)
		wantBody := fmt.Sprintf("body-%d\n", i)
		got, ok := vol[wantPath]
		if !ok {
			t.Errorf("[%d] vol missing %q (have %v)", i, wantPath, keysOf(vol))
			continue
		}
		if string(got) != wantBody {
			t.Errorf("[%d] vol[%q] = %q, want %q", i, wantPath, got, wantBody)
		}
		// No cross-contamination: foreign-goroutine paths must not appear.
		for j := 0; j < N; j++ {
			if i == j {
				continue
			}
			foreign := fmt.Sprintf("/out/p%d/f%d.txt", j, j)
			if _, leaked := vol[foreign]; leaked {
				t.Errorf("[%d] saw foreign path %q", i, foreign)
			}
		}
	}
}

func keysOf(m map[string][]byte) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
