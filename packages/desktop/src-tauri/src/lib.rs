use std::fs;
use std::path::PathBuf;
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

#[derive(Default)]
struct ChatState {
    busy: std::sync::atomic::AtomicBool,
    child: std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
}

#[derive(Default)]
struct SyncWatchState {
    busy: std::sync::atomic::AtomicBool,
    child: std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
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
    #[serde(default)] project_dir: Option<String>,   // local folder where patchwire.yml lands (current_dir)
    #[serde(default)] project: Option<String>,       // project name passed as --project
    #[serde(default)] remote_path: Option<String>,   // remote path passed as --path
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
    if let Some(ref dir) = args.project_dir {
        if !std::path::Path::new(dir).is_dir() {
            return Err("project_dir does not exist or is not a directory".into());
        }
    }

    // Get sidecar handle BEFORE claiming busy — so only .spawn() is inside the claimed region.
    let sidecar = app.shell().sidecar("patchwire").map_err(|e| e.to_string())?;

    // Atomic in-progress claim: compare_exchange false→true; fail if already true.
    if state.busy.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return Err("a provision is already in progress".into());
    }

    // Build argv — append project flags only when both project + remote_path are present.
    let mut argv: Vec<String> = vec![
        "setup".into(), "--provision-remote".into(), "--stream".into(), "--token-stdin".into(),
        "--host".into(), args.host.clone(),
        "--user".into(), args.user.clone(),
        "--ssh-port".into(), args.port.to_string(),
        "--key-path".into(), key_path.clone(),
        "--agent-port".into(), args.agent_port.to_string(),
    ];
    if let (Some(p), Some(rp)) = (args.project.as_ref(), args.remote_path.as_ref()) {
        argv.push("--project".into()); argv.push(p.clone());
        argv.push("--path".into()); argv.push(rp.clone());
    }

    // Set current_dir only when project_dir is present.
    let mut cmd = sidecar;
    if let Some(ref dir) = args.project_dir {
        cmd = cmd.current_dir(std::path::PathBuf::from(dir));
    }

    // Spawn the sidecar. On failure, reset busy before returning.
    let (mut rx, mut child) = match cmd.args(argv).spawn() {
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

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostArgs {
    host: String,
    user: String,
    port: u16,
    key_path: String,
    agent_port: u16,
}

fn validate_host(args: &HostArgs) -> Result<String, String> {
    if args.host.is_empty() || args.host.starts_with('-')
        || !args.host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '[' | ']')) {
        return Err("invalid host".into());
    }
    let mut uc = args.user.chars();
    let user_ok = matches!(uc.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && args.user.len() <= 32
        && args.user.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    if !user_ok { return Err("invalid user".into()); }
    if args.key_path.starts_with('-') { return Err("invalid key_path".into()); }
    let resolved = if let Some(rest) = args.key_path.strip_prefix("~/") {
        format!("{}/{}", std::env::var("HOME").map_err(|_| "HOME not set".to_string())?, rest)
    } else { args.key_path.clone() };
    if !std::path::Path::new(&resolved).exists() { return Err(format!("key_path does not exist: {resolved}")); }
    Ok(resolved)
}

async fn run_host_op(app: &tauri::AppHandle, verb: &str, args: &HostArgs) -> Result<String, String> {
    let key = validate_host(args)?;
    let out = app.shell().sidecar("patchwire").map_err(|e| e.to_string())?
        .args([
            verb,
            "--host", &args.host,
            "--user", &args.user,
            "--ssh-port", &args.port.to_string(),
            "--key-path", &key,
            "--agent-port", &args.agent_port.to_string(),
        ])
        .output().await.map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[tauri::command]
async fn host_health(app: tauri::AppHandle, args: HostArgs) -> Result<String, String> {
    run_host_op(&app, "host-check", &args).await
}

#[tauri::command]
async fn host_uninstall(app: tauri::AppHandle, args: HostArgs) -> Result<String, String> {
    run_host_op(&app, "host-uninstall", &args).await
}

#[tauri::command]
async fn host_logs(app: tauri::AppHandle, args: HostArgs, limit: u32) -> Result<String, String> {
    let key = validate_host(&args)?;
    let out = app.shell().sidecar("patchwire").map_err(|e| e.to_string())?
        .args([
            "host-logs",
            "--host", &args.host,
            "--user", &args.user,
            "--ssh-port", &args.port.to_string(),
            "--key-path", &key,
            "--agent-port", &args.agent_port.to_string(),
            "--limit", &limit.to_string(),
        ])
        .output().await.map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn data_file(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(name))
}

#[tauri::command]
fn list_projects(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let path = data_file(&app, "projects.json")?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let value: Vec<serde_json::Value> = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    Ok(value)
}

#[tauri::command]
fn save_project(app: tauri::AppHandle, project: serde_json::Value) -> Result<(), String> {
    let path = data_file(&app, "projects.json")?;
    let mut list: Vec<serde_json::Value> = if path.exists() {
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&text).map_err(|e| e.to_string())?
    } else {
        vec![]
    };
    let new_id = project.get("id").and_then(|v| v.as_str()).unwrap_or("");
    if new_id.is_empty() {
        return Err("project.id is required".into());
    }
    list.retain(|p| p.get("id").and_then(|v| v.as_str()) != Some(new_id));
    list.push(project);
    let text = serde_json::to_string_pretty(&list).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_connections(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let path = data_file(&app, "connections.json")?;
    if !path.exists() { return Ok(vec![]); }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_connection(app: tauri::AppHandle, connection: serde_json::Value) -> Result<(), String> {
    let path = data_file(&app, "connections.json")?;
    let mut list: Vec<serde_json::Value> = if path.exists() {
        serde_json::from_str(&fs::read_to_string(&path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?
    } else { vec![] };
    let id = connection.get("id").and_then(|v| v.as_str()).unwrap_or("");
    if id.is_empty() { return Err("connection.id is required".into()); }
    list.retain(|c| c.get("id").and_then(|v| v.as_str()) != Some(id));
    list.push(connection);
    fs::write(&path, serde_json::to_string_pretty(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_connection(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = data_file(&app, "connections.json")?;
    if !path.exists() { return Ok(()); }
    let mut list: Vec<serde_json::Value> = serde_json::from_str(&fs::read_to_string(&path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    list.retain(|c| c.get("id").and_then(|v| v.as_str()) != Some(id.as_str()));
    fs::write(&path, serde_json::to_string_pretty(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_project_config(app: tauri::AppHandle, project_dir: String) -> Result<String, String> {
    use tauri_plugin_shell::ShellExt;
    if project_dir.trim().is_empty() { return Err("project_dir is required".into()); }
    if !std::path::Path::new(&project_dir).is_dir() { return Err("project_dir does not exist".into()); }
    let sidecar = app.shell().sidecar("patchwire").map_err(|e| e.to_string())?;
    let output = sidecar
        .current_dir(std::path::PathBuf::from(&project_dir))
        .args(["config-show", "--json"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").to_string();
    if line.is_empty() {
        return Err(format!("config-show produced no output: {}", String::from_utf8_lossy(&output.stderr)));
    }
    Ok(line)
}

#[tauri::command]
async fn start_chat(
    app: tauri::AppHandle,
    state: tauri::State<'_, ChatState>,
    project_dir: String,
    session_uuid: String,
    prompt: String,
) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    use tauri_plugin_shell::ShellExt;
    use tauri_plugin_shell::process::CommandEvent;
    use tauri::Emitter;

    if project_dir.trim().is_empty() { return Err("project_dir is required".into()); }
    if !std::path::Path::new(&project_dir).is_dir() { return Err("project_dir does not exist".into()); }
    if session_uuid.trim().is_empty() { return Err("session_uuid is required".into()); }
    if prompt.trim().is_empty() { return Err("prompt is required".into()); }

    // Get sidecar handle BEFORE claiming busy — so only .spawn() is inside the claimed region.
    let sidecar = app.shell().sidecar("patchwire").map_err(|e| e.to_string())?;

    // Atomic in-progress claim: compare_exchange false→true; fail if already true.
    if state.busy.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return Err("a chat turn is already in progress".into());
    }

    let (mut rx, child) = match sidecar
        .current_dir(std::path::PathBuf::from(&project_dir))
        .args(["chat", "--session", &session_uuid, "--json", &prompt])
        .spawn()
    {
        Ok(v) => v,
        Err(e) => { state.busy.store(false, Ordering::SeqCst); return Err(e.to_string()); }
    };

    *state.child.lock().unwrap() = Some(child);

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).trim_end().to_string();
                    if !line.is_empty() {
                        let _ = app.emit("pw://chat", line);
                    }
                }
                CommandEvent::Terminated(p) => {
                    if let Some(st) = app.try_state::<ChatState>() {
                        *st.child.lock().unwrap() = None;
                        st.busy.store(false, Ordering::SeqCst);
                    }
                    let _ = app.emit("pw://chat-end", p.code);
                }
                _ => {}
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn cancel_chat(state: tauri::State<'_, ChatState>) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    if let Some(child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
    }
    state.busy.store(false, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
async fn apply_patch(
    app: tauri::AppHandle,
    project_dir: String,
    patch: String,
) -> Result<String, String> {
    use tauri_plugin_shell::ShellExt;
    if project_dir.trim().is_empty() { return Err("project_dir is required".into()); }
    if !std::path::Path::new(&project_dir).is_dir() { return Err("project_dir does not exist".into()); }

    let pw_dir = std::path::Path::new(&project_dir).join(".patchwire");
    std::fs::create_dir_all(&pw_dir).map_err(|e| e.to_string())?;
    let patch_path = pw_dir.join("desktop.patch");
    std::fs::write(&patch_path, &patch).map_err(|e| e.to_string())?;

    let sidecar = app.shell().sidecar("patchwire").map_err(|e| e.to_string())?;
    let output = sidecar
        .current_dir(std::path::PathBuf::from(&project_dir))
        .args(["apply", "--yes", "--json", &patch_path.to_string_lossy()])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    // Return the last non-empty line (the JSON result line).
    let line = stdout.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").to_string();
    if line.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("apply produced no result: {stderr}"));
    }
    Ok(line)
}

#[tauri::command]
async fn push_attachment(
    app: tauri::AppHandle,
    project_dir: String,
    file_path: Option<String>,
    use_clipboard: bool,
) -> Result<String, String> {
    use tauri_plugin_shell::ShellExt;
    if !std::path::Path::new(&project_dir).is_dir() { return Err("project_dir does not exist".into()); }
    if use_clipboard == file_path.is_some() {
        return Err("provide exactly one of file_path or use_clipboard".into());
    }
    let sidecar = app.shell().sidecar("patchwire").map_err(|e| e.to_string())?;
    let mut argv: Vec<String> = vec!["push".into()];
    if use_clipboard {
        argv.push("--clip".into());
        argv.push("--stage-only".into());
        argv.push("--json".into());
    } else if let Some(f) = file_path.as_ref() {
        if f.starts_with('-') {
            return Err("file_path must not start with '-'".into());
        }
        argv.push("--stage-only".into());
        argv.push("--json".into());
        argv.push("--".into());
        argv.push(f.clone());
    }
    let output = sidecar
        .current_dir(std::path::PathBuf::from(&project_dir))
        .args(argv)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!("push failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").to_string();
    match serde_json::from_str::<serde_json::Value>(&line) {
        Ok(v) => Ok(v.get("remotePath").and_then(|p| p.as_str()).unwrap_or("").to_string()),
        Err(_) => Err(format!("push: unparseable output: {line}")),
    }
}

#[tauri::command]
async fn start_sync_watch(
    app: tauri::AppHandle,
    state: tauri::State<'_, SyncWatchState>,
    project_dir: String,
) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    use tauri_plugin_shell::ShellExt;
    use tauri_plugin_shell::process::CommandEvent;
    use tauri::Emitter;

    if project_dir.trim().is_empty() { return Err("project_dir is required".into()); }
    if !std::path::Path::new(&project_dir).is_dir() { return Err("project_dir does not exist".into()); }

    // Get sidecar handle BEFORE claiming busy — so only .spawn() is inside the claimed region.
    let sidecar = app.shell().sidecar("patchwire").map_err(|e| e.to_string())?;

    if state.busy.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return Err("a sync watch is already running".into());
    }
    let (mut rx, child) = match sidecar
        .current_dir(std::path::PathBuf::from(&project_dir))
        .args(["sync-watch", "--json"])
        .spawn()
    {
        Ok(v) => v,
        Err(e) => { state.busy.store(false, Ordering::SeqCst); return Err(e.to_string()); }
    };
    *state.child.lock().unwrap() = Some(child);
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).trim_end().to_string();
                    if !line.is_empty() { let _ = app.emit("pw://sync", line); }
                }
                CommandEvent::Terminated(p) => {
                    if let Some(st) = app.try_state::<SyncWatchState>() {
                        *st.child.lock().unwrap() = None;
                        st.busy.store(false, Ordering::SeqCst);
                    }
                    let _ = app.emit("pw://sync-end", p.code);
                }
                _ => {}
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn stop_sync_watch(state: tauri::State<'_, SyncWatchState>) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    if let Some(child) = state.child.lock().unwrap().take() { let _ = child.kill(); }
    state.busy.store(false, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
async fn sync_command(
    app: tauri::AppHandle,
    project_dir: String,
    sub: String,
) -> Result<String, String> {
    use tauri_plugin_shell::ShellExt;
    if project_dir.trim().is_empty() { return Err("project_dir is required".into()); }
    if !std::path::Path::new(&project_dir).is_dir() { return Err("project_dir does not exist".into()); }
    let allowed = ["status", "start", "pause", "resume", "flush", "stop"];
    if !allowed.contains(&sub.as_str()) { return Err(format!("invalid sync sub-command: {sub}")); }

    let sidecar = app.shell().sidecar("patchwire").map_err(|e| e.to_string())?;
    let cmd = format!("sync-{sub}");
    let output = sidecar
        .current_dir(std::path::PathBuf::from(&project_dir))
        .args([cmd.as_str(), "--json"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").to_string();
    if line.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("sync-{sub} produced no result: {stderr}"));
    }
    Ok(line)
}

fn safe_token(v: &str) -> bool {
    !v.is_empty() && v.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

// Generate the per-project SSH key if missing; return the public key path.
#[tauri::command]
fn ensure_ssh_key(host: String, user: String) -> Result<String, String> {
    if !safe_token(&host) || !safe_token(&user) { return Err("invalid host/user".into()); }
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let keys = std::path::Path::new(&home).join(".patchwire").join("keys");
    std::fs::create_dir_all(&keys).map_err(|e| e.to_string())?;
    let key = keys.join(format!("{host}-{user}"));
    let pubkey = keys.join(format!("{host}-{user}.pub"));
    if !key.exists() {
        let out = std::process::Command::new("ssh-keygen")
            .args(["-t", "ed25519", "-f", &key.to_string_lossy(), "-N", "", "-C", "patchwire"])
            .output().map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(format!("ssh-keygen failed: {}", String::from_utf8_lossy(&out.stderr)));
        }
    }
    Ok(pubkey.to_string_lossy().to_string())
}

// Verify a key-only SSH connection works (reuses the CLI setup --verify-key).
#[tauri::command]
async fn verify_key(app: tauri::AppHandle, host: String, user: String, ssh_port: u16, key_path: String) -> Result<bool, String> {
    use tauri_plugin_shell::ShellExt;
    if !safe_token(&host) || !safe_token(&user) { return Err("invalid host/user".into()); }
    let sidecar = app.shell().sidecar("patchwire").map_err(|e| e.to_string())?;
    let out = sidecar.args([
        "setup", "--verify-key",
        "--host", &host, "--user", &user,
        "--ssh-port", &ssh_port.to_string(), "--key-path", &key_path,
    ]).output().await.map_err(|e| e.to_string())?;
    let line = String::from_utf8_lossy(&out.stdout).lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").to_string();
    match serde_json::from_str::<serde_json::Value>(&line) {
        Ok(v) => Ok(v.get("ok").and_then(|b| b.as_bool()).unwrap_or(false)),
        Err(_) => Ok(false),
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectYmlArgs {
    project_dir: String,
    project: String,
    host: String,
    user: String,
    ssh_port: u16,
    agent_port: u16,
    remote_path: String,
    token: String,
    exclude: Vec<String>,
}

// Best-effort project-type detection from a directory's root files. Mirrors the
// extension's detectProjectType.ts. Never errors on a readable dir → "common".
#[tauri::command]
fn detect_project_type(project_dir: String) -> Result<String, String> {
    use std::path::Path;
    let dir = Path::new(&project_dir);
    if dir.join("pubspec.yaml").exists() {
        return Ok("flutter".into());
    }
    let pkg = dir.join("package.json");
    if pkg.exists() {
        const FRONTEND_DEPS: [&str; 9] = [
            "next", "nuxt", "react", "react-dom", "vue", "@angular/core", "svelte", "vite", "astro",
        ];
        if let Ok(text) = std::fs::read_to_string(&pkg) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                let has_frontend = ["dependencies", "devDependencies"].iter().any(|k| {
                    json.get(k)
                        .and_then(|d| d.as_object())
                        .map(|o| FRONTEND_DEPS.iter().any(|d| o.contains_key(*d)))
                        .unwrap_or(false)
                });
                if has_frontend {
                    return Ok("node-frontend".into());
                }
            }
        }
        return Ok("node-backend".into());
    }
    for f in ["requirements.txt", "pyproject.toml", "setup.py", "Pipfile"] {
        if dir.join(f).exists() {
            return Ok("python".into());
        }
    }
    Ok("common".into())
}

// Write <project_dir>/patchwire.yml with a literal token (mirrors writeYaml in the CLI but
// swaps ${PW_TOKEN} for the literal token received via IPC — never via argv).
#[tauri::command]
fn write_project_yml(args: ProjectYmlArgs) -> Result<(), String> {
    if !std::path::Path::new(&args.project_dir).is_dir() {
        return Err("project_dir does not exist".into());
    }
    // Validate host/user with the existing safe_token allowlist (no injection into the yml).
    if !safe_token(&args.host) || !safe_token(&args.user) {
        return Err("invalid host/user".into());
    }
    // Fix 1 (HIGH): Reject CR/LF in free-form fields that are interpolated raw into YAML.
    // A newline in any of these values would inject arbitrary YAML keys (e.g. override
    // ai.command → RCE when chat runs). remote_path is user-editable in the UI → real vector.
    for (label, v) in [("project", &args.project), ("remote_path", &args.remote_path), ("token", &args.token)] {
        if v.contains('\n') || v.contains('\r') {
            return Err(format!("invalid {label}: contains a newline"));
        }
    }
    for e in &args.exclude {
        if e.contains('\n') || e.contains('\r') {
            return Err("invalid exclude entry: contains a newline".into());
        }
    }
    let exclude_block = if args.exclude.is_empty() {
        "  exclude: []\n".to_string()
    } else {
        let mut b = String::from("  exclude:\n");
        for e in &args.exclude {
            // Double-quote every entry: glob patterns like `*.swp` / `**/Pods/`
            // start with `*`, which YAML reads as an alias and rejects. Quoting
            // (escaping `\` and `"`) makes any single-line value a valid scalar.
            let escaped = e.replace('\\', "\\\\").replace('"', "\\\"");
            b.push_str("    - \"");
            b.push_str(&escaped);
            b.push_str("\"\n");
        }
        b
    };
    let yml = format!(
        "project: {project}\nremote:\n  host: {host}\n  user: {user}\n  path: {path}\n  sshPort: {ssh}\n  agentUrl: http://{host}:{ap}\n  token: {token}\nsync:\n{exclude_block}ai:\n  command: claude\n  args:\n    - --print\n  timeoutSec: 600\n",
        project = args.project,
        host = args.host,
        user = args.user,
        path = args.remote_path,
        ssh = args.ssh_port,
        ap = args.agent_port,
        token = args.token,
        exclude_block = exclude_block,
    );
    // Fix 2 (MEDIUM): Write the yml file owner-only (0o600) because it contains a literal token.
    let path = std::path::Path::new(&args.project_dir).join("patchwire.yml");
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&path)
            .map_err(|e| e.to_string())?;
        f.write_all(yml.as_bytes()).map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    {
        std::fs::write(&path, yml).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Best-effort local machine name for namespacing remote paths. macOS uses the
// friendly ComputerName; other platforms fall back to the hostname. The caller
// slugifies the result and falls back to the SSH user if this errors.
#[tauri::command]
fn computer_name() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = std::process::Command::new("scutil")
            .args(["--get", "ComputerName"])
            .output()
        {
            if out.status.success() {
                let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !name.is_empty() {
                    return Ok(name);
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(name) = std::env::var("COMPUTERNAME") {
            let n = name.trim().to_string();
            if !n.is_empty() {
                return Ok(n);
            }
        }
    }
    // Unix / ultimate fallback: the `hostname` command.
    if let Ok(out) = std::process::Command::new("hostname").output() {
        if out.status.success() {
            let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !name.is_empty() {
                return Ok(name);
            }
        }
    }
    Err("could not determine computer name".into())
}

// Run `patchwire init-remote --from-local --json` in the project dir. `mode`
// selects how an existing remote path is handled: "create" (no flag),
// "overwrite" (--overwrite, rm -rf + re-push) or "use_existing" (--use-existing,
// config-only). The full NDJSON stdout is returned to the caller, which parses it
// (parseInitRemoteResult) — including the `target_exists` signal that exits
// non-zero but is reported on stdout.
#[tauri::command]
async fn init_remote_copy(
    app: tauri::AppHandle,
    project_dir: String,
    remote_path: String,
    mode: String,
) -> Result<String, String> {
    use tauri_plugin_shell::ShellExt;
    if !std::path::Path::new(&project_dir).is_dir() {
        return Err("project_dir does not exist".into());
    }
    let project_name = std::path::Path::new(&project_dir)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "cannot derive project name from project_dir".to_string())?
        .to_string();

    let mut args: Vec<String> = vec![
        "init-remote".into(),
        "--from-local".into(),
        "--project".into(),
        project_name,
        "--remote-path".into(),
        remote_path,
        "--json".into(),
    ];
    match mode.as_str() {
        "overwrite" => args.push("--overwrite".into()),
        "use_existing" => args.push("--use-existing".into()),
        _ => {} // "create" — no flag
    }

    let sidecar = app.shell().sidecar("patchwire").map_err(|e| e.to_string())?;
    let output = sidecar
        .current_dir(std::path::PathBuf::from(&project_dir))
        .args(args)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    // Hard failure with no NDJSON to parse → surface stderr as an error.
    if stdout.trim().is_empty() && !output.status.success() {
        return Err(format!(
            "init-remote failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(stdout)
}

// Open Terminal.app and run a command (macOS). The command is built by the caller from validated host/user.
#[tauri::command]
fn open_terminal(command: String) -> Result<(), String> {
    // Reject control chars / quotes that could break out of the AppleScript string.
    if command.contains('"') || command.contains('\n') || command.contains('\r') {
        return Err("invalid command".into());
    }
    let script = format!("tell application \"Terminal\" to do script \"{command}\"");
    let out = std::process::Command::new("osascript").args(["-e", &script]).output().map_err(|e| e.to_string())?;
    if !out.status.success() { return Err(String::from_utf8_lossy(&out.stderr).to_string()); }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ProvisionState::default())
        .manage(ChatState::default())
        .manage(SyncWatchState::default())
        .invoke_handler(tauri::generate_handler![
            start_provision,
            send_consent,
            save_host,
            list_hosts,
            delete_host,
            host_health,
            host_uninstall,
            host_logs,
            list_projects,
            save_project,
            list_connections,
            save_connection,
            delete_connection,
            read_project_config,
            start_chat,
            cancel_chat,
            apply_patch,
            push_attachment,
            start_sync_watch,
            stop_sync_watch,
            sync_command,
            ensure_ssh_key,
            verify_key,
            open_terminal,
            computer_name,
            write_project_yml,
            detect_project_type,
            init_remote_copy
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
