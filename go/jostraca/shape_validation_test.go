package jostraca

import (
	"strings"
	"testing"
)

// Per-component shape validation at define time. Mirrors TS FragmentShape
// and CopyShape at src/cmp/Fragment.ts:13-20 and src/cmp/Copy.ts:10-21.

func TestFragmentRequiresFrom(t *testing.T) {
	mem := NewMemFS()
	j := New(WithFS(mem), WithFolder("/out"))
	_, err := j.Generate(Options{}, func(j *J) {
		j.File("foo.txt", func(j *J) {
			j.Fragment(FragmentProps{}, nil) // missing From
		})
	})
	if err == nil {
		t.Errorf("Fragment without From should error")
	}
	if err != nil && !strings.Contains(err.Error(), "From is required") {
		t.Errorf("err = %v, want 'From is required'", err)
	}
}

func TestFragmentMissingFromFile(t *testing.T) {
	mem := NewMemFS()
	j := New(WithFS(mem), WithFolder("/out"))
	_, err := j.Generate(Options{}, func(j *J) {
		j.File("foo.txt", func(j *J) {
			j.Fragment(FragmentProps{From: "/nonexistent.html"}, nil)
		})
	})
	if err == nil {
		t.Errorf("Fragment with missing From file should error")
	}
	if err != nil && !strings.Contains(err.Error(), "does not exist") {
		t.Errorf("err = %v, want 'does not exist'", err)
	}
}

func TestCopyRequiresFrom(t *testing.T) {
	mem := NewMemFS()
	j := New(WithFS(mem), WithFolder("/out"))
	_, err := j.Generate(Options{}, func(j *J) {
		j.Copy(CopyProps{})
	})
	if err == nil {
		t.Errorf("Copy without From should error")
	}
	if err != nil && !strings.Contains(err.Error(), "From is required") {
		t.Errorf("err = %v, want 'From is required'", err)
	}
}

func TestCopyMissingFromFile(t *testing.T) {
	mem := NewMemFS()
	j := New(WithFS(mem), WithFolder("/out"))
	_, err := j.Generate(Options{}, func(j *J) {
		j.Copy(CopyProps{From: "/nonexistent"})
	})
	if err == nil {
		t.Errorf("Copy with missing From should error")
	}
	if err != nil && !strings.Contains(err.Error(), "does not exist") {
		t.Errorf("err = %v, want 'does not exist'", err)
	}
}

// Errors fire at DEFINE time, not at build phase, matching TS behaviour.
// A valid file in the user callback after the bad component should
// not be processed.
func TestShapeValidationStopsAtDefine(t *testing.T) {
	mem := NewMemFS()
	called := false
	j := New(WithFS(mem), WithFolder("/out"))
	_, err := j.Generate(Options{}, func(j *J) {
		j.File("first.txt", func(j *J) {
			j.Fragment(FragmentProps{From: "/missing"}, nil)
		})
		j.File("second.txt", func(j *J) {
			called = true
			j.Content("hi")
		})
	})
	if err == nil {
		t.Errorf("expected error from bad Fragment")
	}
	if called {
		t.Errorf("subsequent component called after define-time error")
	}
}
