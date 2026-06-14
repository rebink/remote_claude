use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[derive(Default)]
struct ProvisionState {
    child: Mutex<Option<CommandChild>>,
    busy: AtomicBool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProvisionArgs {
    host: String,
    user: String,
    port: u16,
    key_path: String,
    agent_port: u16,
    token: String,
}

fn validate_and_resolve(args: &ProvisionArgs) -> Result<String, String> {
    // host: non-empty, no leading '-', hostname/IP grammar
    if args.host.is_empty()
        || args.host.starts_with('-')
        || !args.host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '[' | ']'))
    {
        return Err("invalid host".into());
    }
    // user: ^[A-Za-z_][A-Za-z0-9._-]{0,31}$
    let mut uc = args.user.chars();
    let user_ok = matches!(uc.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && args.user.len() <= 32
        && args.user.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    if !user_ok {
        return Err("invalid user".into());
    }
    // token: ^[A-Za-z0-9_-]{16,}$ (matches the CLI's own guard)
    if args.token.len() < 16 || !args.token.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-')) {
        return Err("invalid token".into());
    }
    // key_path: no leading '-', expand a leading '~/' to $HOME, must exist
    if args.key_path.starts_with('-') {
        return Err("invalid key_path".into());
    }
    let resolved = if let Some(rest) = args.key_path.strip_prefix("~/") {
        let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
        format!("{home}/{rest}")
    } else {
        args.key_path.clone()
    };
    if !std::path::Path::new(&resolved).exists() {
        return Err(format!("key_path does not exist: {resolved}"));
    }
    Ok(resolved)
}

#[tauri::command]
async fn start_provision(
    app: tauri::AppHandle,
    state: State<'_, ProvisionState>,
    args: ProvisionArgs,
) -> Result<(), String> {
    // Validate inputs BEFORE claiming busy — a validation error must NOT leave busy set.
    let key_path = validate_and_resolve(&args)?;

    // Get sidecar handle BEFORE claiming busy — so only .spawn() is inside the claimed region.
    let sidecar = app.shell().sidecar("patchwire").map_err(|e| e.to_string())?;

    // Atomic in-progress claim: compare_exchange false→true; fail if already true.
    if state.busy.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return Err("a provision is already in progress".into());
    }

    // Spawn the sidecar. On failure, reset busy before returning.
    let (mut rx, mut child) = match sidecar
        .args([
            "setup", "--provision-remote", "--stream",
            "--token-stdin",
            "--host", &args.host,
            "--user", &args.user,
            "--ssh-port", &args.port.to_string(),
            "--key-path", &key_path,
            "--agent-port", &args.agent_port.to_string(),
        ])
        .spawn()
    {
        Ok(v) => v,
        Err(e) => {
            state.busy.store(false, Ordering::SeqCst);
            return Err(e.to_string());
        }
    };

    let token_line = format!("{{\"token\":\"{}\"}}\n", args.token);
    child.write(token_line.as_bytes()).map_err(|e| e.to_string())?;

    *state.child.lock().unwrap() = Some(child);

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).trim_end().to_string();
                    if !line.is_empty() {
                        let _ = app.emit("pw://prov", line);
                    }
                }
                CommandEvent::Terminated(p) => {
                    // Clear both child slot and busy flag atomically on termination.
                    if let Some(st) = app.try_state::<ProvisionState>() {
                        *st.child.lock().unwrap() = None;
                        st.busy.store(false, Ordering::SeqCst);
                    }
                    let _ = app.emit("pw://prov-end", p.code);
                }
                _ => {}
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn save_host(app: tauri::AppHandle, record: serde_json::Value) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("hosts.json");
    let mut hosts: Vec<serde_json::Value> = match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    let id = record.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    hosts.retain(|h| h.get("id").and_then(|v| v.as_str()) != Some(id.as_str()));
    hosts.push(record);
    let json = serde_json::to_string_pretty(&hosts).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_hosts(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("hosts.json");
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(serde_json::from_str(&s).unwrap_or_default()),
        Err(_) => Ok(Vec::new()),
    }
}

#[tauri::command]
fn delete_host(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("hosts.json");
    let mut hosts: Vec<serde_json::Value> = match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    hosts.retain(|h| h.get("id").and_then(|v| v.as_str()) != Some(id.as_str()));
    let json = serde_json::to_string_pretty(&hosts).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
fn send_consent(state: State<'_, ProvisionState>, consent: bool) -> Result<(), String> {
    let mut guard = state.child.lock().unwrap();
    let child = guard.as_mut().ok_or("no active provision")?;
    let line = if consent { "{\"consent\":true}\n" } else { "{\"consent\":false}\n" };
    child.write(line.as_bytes()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ProvisionState::default())
        .invoke_handler(tauri::generate_handler![start_provision, send_consent, save_host, list_hosts, delete_host])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
