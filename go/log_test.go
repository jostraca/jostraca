package jostraca

import (
	"bytes"
	"io"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// captureStd runs fn with os.Stdout and os.Stderr redirected, and returns
// what each received.
func captureStd(t *testing.T, fn func()) (stdout, stderr string) {
	t.Helper()
	redirect := func(f **os.File) func() string {
		r, w, err := os.Pipe()
		if err != nil {
			t.Fatal(err)
		}
		saved := *f
		*f = w
		got := make(chan string)
		go func() {
			b, _ := io.ReadAll(r)
			got <- string(b)
		}()
		return func() string {
			*f = saved
			_ = w.Close()
			s := <-got
			_ = r.Close()
			return s
		}
	}
	restoreOut := redirect(&os.Stdout)
	restoreErr := redirect(&os.Stderr)
	fn()
	return restoreOut(), restoreErr()
}

var logLineRE = regexp.MustCompile(
	`(?m)^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z ([A-Z]+) a 1$`)

func logLevels(t *testing.T, out string) []string {
	t.Helper()
	levels := []string{}
	for _, m := range logLineRE.FindAllStringSubmatch(out, -1) {
		levels = append(levels, m[1])
	}
	if strings.Count(out, "\n") != len(levels) {
		t.Fatalf("unexpected line in %q", out)
	}
	return levels
}

func logEveryLevel(l Log) {
	l.Trace("a", 1)
	l.Debug("a", 1)
	l.Info("a", 1)
	l.Warn("a", 1)
	l.Error("a", 1)
	l.Fatal("a", 1)
}

// TS's console logger sends trace, debug and info through console.log and
// the rest through console.error.
func TestDefaultLogSplitsStreamsAsConsole(t *testing.T) {
	stdout, stderr := captureStd(t, func() { logEveryLevel(&DefaultLog{}) })
	if got := logLevels(t, stdout); !slices.Equal(got, []string{"TRACE", "DEBUG", "INFO"}) {
		t.Fatalf("stdout levels: %v", got)
	}
	if got := logLevels(t, stderr); !slices.Equal(got, []string{"WARN", "ERROR", "FATAL"}) {
		t.Fatalf("stderr levels: %v", got)
	}
}

func TestDefaultLogOutTakesEveryLevel(t *testing.T) {
	var buf bytes.Buffer
	stdout, stderr := captureStd(t, func() { logEveryLevel(&DefaultLog{Out: &buf}) })
	if stdout != "" || stderr != "" {
		t.Fatalf("leaked: stdout %q stderr %q", stdout, stderr)
	}
	want := []string{"TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"}
	if got := logLevels(t, buf.String()); !slices.Equal(got, want) {
		t.Fatalf("levels: %v", got)
	}
}
