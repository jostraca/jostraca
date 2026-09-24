// log.rs — Log trait and DefaultLog, ported from go/log.go

use std::io::{self, Write};
use std::sync::Mutex;

/// Logging interface. Mirrors Go `Log` / TS `Log`.
pub trait Log: Send + Sync {
    fn trace(&self, args: &[&dyn std::fmt::Display]);
    fn debug(&self, args: &[&dyn std::fmt::Display]);
    fn info(&self, args: &[&dyn std::fmt::Display]);
    fn warn(&self, args: &[&dyn std::fmt::Display]);
    fn error(&self, args: &[&dyn std::fmt::Display]);
    fn fatal(&self, args: &[&dyn std::fmt::Display]);
}

/// Writes ISO-8601-prefixed lines per level.
pub struct DefaultLog {
    mu: Mutex<()>,
}

impl DefaultLog {
    pub fn new() -> Self { DefaultLog { mu: Mutex::new(()) } }

    fn write(&self, level: &str, args: &[&dyn std::fmt::Display]) {
        let _g = self.mu.lock().unwrap_or_else(|e| e.into_inner());
        let ts = chrono_or_fallback();
        let mut parts = vec![format!("{} {}", ts, level)];
        for a in args {
            parts.push(format!(" {}", a));
        }
        let _ = writeln!(io::stderr(), "{}", parts.join(""));
    }
}

impl Default for DefaultLog {
    fn default() -> Self { DefaultLog::new() }
}

impl Log for DefaultLog {
    fn trace(&self, a: &[&dyn std::fmt::Display]) { self.write("TRACE", a) }
    fn debug(&self, a: &[&dyn std::fmt::Display]) { self.write("DEBUG", a) }
    fn info (&self, a: &[&dyn std::fmt::Display]) { self.write("INFO",  a) }
    fn warn (&self, a: &[&dyn std::fmt::Display]) { self.write("WARN",  a) }
    fn error(&self, a: &[&dyn std::fmt::Display]) { self.write("ERROR", a) }
    fn fatal(&self, a: &[&dyn std::fmt::Display]) { self.write("FATAL", a) }
}

fn chrono_or_fallback() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    // Format as ISO-8601 manually (no chrono dep to keep the dep tree small).
    let secs = ms / 1000;
    let milli = ms % 1000;
    let s = secs % 60;
    let m = (secs / 60) % 60;
    let h = (secs / 3600) % 24;
    // days since epoch → rough date (good enough for a log timestamp)
    let days = secs / 86400;
    let (y, mo, d) = days_to_ymd(days as u64);
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z", y, mo, d, h, m, s, milli)
}

fn days_to_ymd(mut days: u64) -> (u64, u64, u64) {
    // Gregorian approximation — not perfect but accurate for any date in range
    let mut y = 1970u64;
    loop {
        let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
        let dy = if leap { 366 } else { 365 };
        if days < dy { break; }
        days -= dy;
        y += 1;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let mdays = [31u64, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut mo = 1u64;
    for &md in &mdays {
        if days < md { break; }
        days -= md;
        mo += 1;
    }
    (y, mo, days + 1)
}

/// Drops all messages. Used when no Log is configured.
pub struct NopLog;

impl Log for NopLog {
    fn trace(&self, _: &[&dyn std::fmt::Display]) {}
    fn debug(&self, _: &[&dyn std::fmt::Display]) {}
    fn info (&self, _: &[&dyn std::fmt::Display]) {}
    fn warn (&self, _: &[&dyn std::fmt::Display]) {}
    fn error(&self, _: &[&dyn std::fmt::Display]) {}
    fn fatal(&self, _: &[&dyn std::fmt::Display]) {}
}
