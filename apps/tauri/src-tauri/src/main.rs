#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    time::Duration,
};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

struct Backend(Mutex<Option<Child>>);

impl Backend {
    fn stop(&self) {
        if let Ok(mut state) = self.0.lock() {
            if let Some(mut child) = state.take() {
                // Closing stdin asks the sidecar to close its API, watchers and run services.
                drop(child.stdin.take());
                for _ in 0..50 {
                    if matches!(child.try_wait(), Ok(Some(_))) {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

impl Drop for Backend {
    fn drop(&mut self) {
        self.stop();
    }
}

#[derive(serde::Deserialize)]
struct Ready {
    url: String,
}

fn is_external_browser_url(url: &tauri::Url) -> bool {
    url.scheme() == "https" && url.username().is_empty() && url.password().is_none()
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let resources = app.path().resource_dir()?.join("backend");
            let data_dir = std::env::var_os("CRAFT_HUB_TAURI_TRIAL_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(app.path().app_local_data_dir()?.join("trial"));
            let mut child = Command::new(resources.join("node"))
                .arg(resources.join("backend.mjs"))
                .current_dir(&resources)
                .env("CRAFT_HUB_TAURI_TRIAL_DIR", &data_dir)
                .env_remove("CRAFT_HUB_DEVICE_CONFIG")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()?;
            let stdout = child.stdout.take().ok_or("Backend stdout is unavailable")?;
            app.manage(Backend(Mutex::new(Some(child))));
            let (sender, receiver) = mpsc::channel();
            std::thread::spawn(move || {
                let mut reader = BufReader::new(stdout);
                let mut line = String::new();
                let result = reader.read_line(&mut line).map(|_| line);
                let _ = sender.send(result);
                // Drain subsequent diagnostics to avoid filling the child's stdout pipe.
                for _ in reader.lines() {}
            });
            let line = receiver.recv_timeout(Duration::from_secs(30))??;
            let ready: Ready = serde_json::from_str(&line)?;
            let url: tauri::Url = ready.url.parse()?;
            if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") || url.port().is_none()
            {
                return Err("Backend returned an invalid local origin".into());
            }
            let origin = url.origin().ascii_serialization();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Craft Hub · Tauri Trial")
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 620.0)
                // External sites have no access to this WebView or its local host bridge.
                .on_navigation(move |target| target.origin().ascii_serialization() == origin)
                .on_new_window(|target, _| {
                    if is_external_browser_url(&target) {
                        std::thread::spawn(move || {
                            let _ = Command::new("/usr/bin/open")
                                .args(["--", target.as_str()])
                                .stdin(Stdio::null())
                                .stdout(Stdio::null())
                                .stderr(Stdio::null())
                                .status();
                        });
                    }
                    tauri::webview::NewWindowResponse::Deny
                })
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Failed to start the optional Tauri trial");
    app.run(|app, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            app.state::<Backend>().stop();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::is_external_browser_url;

    #[test]
    fn only_credential_free_https_opens_in_the_browser() {
        for value in ["https://example.com", "https://example.com/path?value=a"] {
            assert!(is_external_browser_url(&value.parse().unwrap()));
        }
        for value in [
            "http://example.com",
            "https://user:secret@example.com",
            "file:///tmp/file",
            "raycast://extensions/test/tools/open",
        ] {
            assert!(!is_external_browser_url(&value.parse().unwrap()));
        }
    }
}
