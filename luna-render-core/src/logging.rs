use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;

static LOG_FILE: Mutex<Option<std::fs::File>> = Mutex::new(None);

pub(crate) fn init(log_path: &str) {
    std::panic::set_hook(Box::new(|info| {
        let message = if let Some(value) = info.payload().downcast_ref::<&str>() {
            value.to_string()
        } else if let Some(value) = info.payload().downcast_ref::<String>() {
            value.clone()
        } else {
            "unknown panic".to_string()
        };
        let location = info
            .location()
            .map(|location| format!("{}:{}", location.file(), location.line()))
            .unwrap_or_default();
        write(&format!("PANIC at {} - {}", location, message));
    }));

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let _ = writeln!(file, "\n=== LunaRC started at {} ===", timestamp);
        let _ = file.flush();
        if let Ok(mut guard) = LOG_FILE.lock() {
            *guard = Some(file);
        }
    }
}

pub(crate) fn write(message: &str) {
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let line = format!("[{}] {}", timestamp, message);
    eprintln!("[LunaRC] {}", line);
    if let Ok(mut guard) = LOG_FILE.lock() {
        if let Some(file) = guard.as_mut() {
            let _ = writeln!(file, "{}", line);
            let _ = file.flush();
        }
    }
}

pub(crate) fn error(message: &str) {
    write(&format!("ERROR: {}", message));
}
