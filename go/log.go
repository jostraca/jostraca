package jostraca

import (
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"time"
)

// Log is the user-visible logging interface. Mirrors src/types.ts Log.
type Log interface {
	Trace(args ...any)
	Debug(args ...any)
	Info(args ...any)
	Warn(args ...any)
	Error(args ...any)
	Fatal(args ...any)
}

// DefaultLog writes one `<ISO time> LEVEL <args>` line per call, as TS's
// console logger does, and is the logger a Generate uses when no Log is
// given. With Out nil, Trace, Debug and Info go to os.Stdout and Warn,
// Error and Fatal to os.Stderr, the split between console.log and
// console.error; a non-nil Out takes every level. Safe for concurrent use.
type DefaultLog struct {
	Out io.Writer
	mu  sync.Mutex
}

// defaultLog is shared so that concurrent runs print whole lines.
var defaultLog = &DefaultLog{}

func (l *DefaultLog) write(level string, diag bool, args []any) {
	if l == nil {
		return
	}
	var line strings.Builder
	line.WriteString(time.Now().UTC().Format("2006-01-02T15:04:05.000Z"))
	line.WriteString(" " + level)
	for _, a := range args {
		fmt.Fprintf(&line, " %v", a)
	}
	line.WriteString("\n")

	l.mu.Lock()
	defer l.mu.Unlock()
	out := l.Out
	if out == nil {
		out = os.Stdout
		if diag {
			out = os.Stderr
		}
	}
	_, _ = io.WriteString(out, line.String())
}

func (l *DefaultLog) Trace(args ...any) { l.write("TRACE", false, args) }
func (l *DefaultLog) Debug(args ...any) { l.write("DEBUG", false, args) }
func (l *DefaultLog) Info(args ...any)  { l.write("INFO", false, args) }
func (l *DefaultLog) Warn(args ...any)  { l.write("WARN", true, args) }
func (l *DefaultLog) Error(args ...any) { l.write("ERROR", true, args) }
func (l *DefaultLog) Fatal(args ...any) { l.write("FATAL", true, args) }
