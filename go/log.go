package jostraca

import (
	"fmt"
	"io"
	"os"
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

// DefaultLog writes ISO-8601-prefixed lines per level. Out defaults to
// os.Stderr if nil. Safe for concurrent use.
type DefaultLog struct {
	Out io.Writer
	mu  sync.Mutex
}

func (l *DefaultLog) write(level string, args []any) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	out := l.Out
	if out == nil {
		out = os.Stderr
	}
	ts := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	fmt.Fprintf(out, "%s %s", ts, level)
	for _, a := range args {
		fmt.Fprintf(out, " %v", a)
	}
	fmt.Fprintln(out)
}

func (l *DefaultLog) Trace(args ...any) { l.write("TRACE", args) }
func (l *DefaultLog) Debug(args ...any) { l.write("DEBUG", args) }
func (l *DefaultLog) Info(args ...any)  { l.write("INFO", args) }
func (l *DefaultLog) Warn(args ...any)  { l.write("WARN", args) }
func (l *DefaultLog) Error(args ...any) { l.write("ERROR", args) }
func (l *DefaultLog) Fatal(args ...any) { l.write("FATAL", args) }

// nopLog drops all messages. Used when no Log is provided and the user
// has not opted into DefaultLog.
type nopLog struct{}

func (nopLog) Trace(...any) {}
func (nopLog) Debug(...any) {}
func (nopLog) Info(...any)  {}
func (nopLog) Warn(...any)  {}
func (nopLog) Error(...any) {}
func (nopLog) Fatal(...any) {}
