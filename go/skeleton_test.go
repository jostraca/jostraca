package jostraca

import (
	"errors"
	"testing"
)

// Phase 1 — Skeleton. Tests the minimum surface area required to build a
// node tree with no ops wired and return an empty Result.

func TestNewReturnsBuilder(t *testing.T) {
	j := New()
	if j == nil {
		t.Fatal("New() returned nil")
	}
}

func TestNewWithOptions(t *testing.T) {
	folder := "/tmp/out"
	j := New(WithFolder(folder), WithMem())
	if j == nil {
		t.Fatal("New(opts...) returned nil")
	}
	// Verifying option assignment is internal to the package.
	if j.st.opts.Folder != folder {
		t.Errorf("Folder = %q, want %q", j.st.opts.Folder, folder)
	}
	if j.st.opts.Mem == nil || !*j.st.opts.Mem {
		t.Errorf("Mem = %v, want pointer to true", j.st.opts.Mem)
	}
}

func TestGenerateEmptyRoot(t *testing.T) {
	j := New()
	res, err := j.Generate(Options{}, func(j *J) {})
	if err != nil {
		t.Fatalf("Generate err = %v, want nil", err)
	}
	if len(res.Files.Written) != 0 {
		t.Errorf("Files.Written = %v, want empty", res.Files.Written)
	}
	if res.Audit == nil {
		t.Error("Result.Audit is nil")
	}
}

func TestGenerateNilRoot(t *testing.T) {
	j := New()
	_, err := j.Generate(Options{}, nil)
	if err == nil {
		t.Error("Generate(nil root) err = nil, want error")
	}
}

// Sentinel errors exist and are distinct.
func TestSentinelsDistinct(t *testing.T) {
	sentinels := []error{
		ErrMissingOp,
		ErrInvalidPath,
		ErrEmptyMatchRegex,
		ErrLookbehind,
		ErrMergeConflict,
	}
	seen := map[error]bool{}
	for _, e := range sentinels {
		if e == nil {
			t.Errorf("sentinel is nil")
			continue
		}
		if seen[e] {
			t.Errorf("duplicate sentinel: %v", e)
		}
		seen[e] = true
	}
}

func TestNodeErrorWraps(t *testing.T) {
	inner := errors.New("boom")
	ne := &NodeError{Step: "file", Path: []string{"a", "b"}, Err: inner}
	if !errors.Is(ne, inner) {
		t.Error("NodeError does not unwrap to inner error")
	}
	if ne.Error() == "" {
		t.Error("NodeError.Error() is empty")
	}
}

// Kind enum has a known starting point and a kindCount sentinel >= it.
func TestKindEnumShape(t *testing.T) {
	if KindNone != 0 {
		t.Errorf("KindNone = %d, want 0", KindNone)
	}
	kinds := []Kind{
		KindNone, KindProject, KindFolder, KindFile,
		KindContent, KindCopy, KindInject, KindFragment, KindSlot,
	}
	if int(kindCount) <= int(kinds[len(kinds)-1]) {
		t.Errorf("kindCount = %d, must exceed last named kind %d", kindCount, kinds[len(kinds)-1])
	}
	seen := map[Kind]bool{}
	for _, k := range kinds {
		if seen[k] {
			t.Errorf("duplicate Kind value: %d", k)
		}
		seen[k] = true
	}
}

// Default Log does not panic on every level.
func TestDefaultLogNoPanic(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("DefaultLog panicked: %v", r)
		}
	}()
	l := &DefaultLog{}
	l.Trace("a", 1)
	l.Debug("b")
	l.Info("c")
	l.Warn("d")
	l.Error("e")
	l.Fatal("f")
}

// OptionsFromMap accepts an empty map.
func TestOptionsFromMapEmpty(t *testing.T) {
	opts, err := OptionsFromMap(map[string]any{})
	if err != nil {
		t.Fatalf("OptionsFromMap({}) err = %v, want nil", err)
	}
	// Accept any zero value - the contract is "no error on empty".
	_ = opts
}
