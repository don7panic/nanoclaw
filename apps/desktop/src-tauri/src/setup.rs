use std::{
    collections::BTreeMap,
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

const KEYCHAIN_SERVICE: &str = "nanoclaw.setup";
const STATE_VERSION: u32 = 1;
const STEP_ORDER: [&str; 12] = [
    "preflight",
    "install_dependencies",
    "container_runtime",
    "claude_auth",
    "build_agent_image",
    "discord_auth",
    "assistant_name",
    "security_confirmation",
    "register_main_channel",
    "mount_allowlist",
    "launchd_setup",
    "final_test",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualCheckpoint {
    id: String,
    title: String,
    instructions: Vec<String>,
    severity: String,
    skippable: bool,
    completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStepRuntime {
    id: String,
    status: String,
    started_at: Option<String>,
    finished_at: Option<String>,
    error: Option<String>,
    blocked_reason: Option<String>,
    retry_count: u32,
    manual_checkpoints: Vec<ManualCheckpoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupState {
    version: u32,
    created_at: String,
    updated_at: String,
    current_step: String,
    selected_runtime: Option<String>,
    steps: BTreeMap<String, SetupStepRuntime>,
    cancelled: bool,
    step_payloads: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupLogEntry {
    timestamp: String,
    step_id: String,
    level: String,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupReport {
    generated_at: String,
    success: bool,
    steps: Vec<StepReportItem>,
    logs: Vec<SetupLogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepReportItem {
    id: String,
    status: String,
    notes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartStepPayload {
    step_id: String,
    data: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetryStepPayload {
    step_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkipManualCheckPayload {
    step_id: String,
    checkpoint_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ManualActionEvent {
    step_id: String,
    reason: String,
    checkpoints: Vec<ManualCheckpoint>,
}

#[derive(Debug)]
pub struct SetupStore {
    repo_root: PathBuf,
    state_path: PathBuf,
    report_path: PathBuf,
    state: Mutex<SetupState>,
    logs: Mutex<Vec<SetupLogEntry>>,
}

#[derive(Debug)]
struct StepResult {
    status: String,
    next_step: Option<String>,
    selected_runtime: Option<String>,
    blocked_reason: Option<String>,
    checkpoints: Vec<ManualCheckpoint>,
    notes: Vec<String>,
    logs: Vec<SetupLogEntry>,
}

impl SetupStore {
    pub fn new() -> Result<Self, String> {
        let repo_root = find_repo_root()?;
        let state_path = repo_root.join("data/setup-wizard/state.json");
        let report_path = repo_root.join("data/setup-wizard/report.json");

        if let Some(parent) = state_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("Failed to create state directory: {err}"))?;
        }

        let state = if state_path.exists() {
            let content = fs::read_to_string(&state_path)
                .map_err(|err| format!("Failed to read setup state: {err}"))?;
            serde_json::from_str::<SetupState>(&content)
                .map_err(|err| format!("Failed to parse setup state: {err}"))?
        } else {
            create_initial_state()
        };

        Ok(Self {
            repo_root,
            state_path,
            report_path,
            state: Mutex::new(state),
            logs: Mutex::new(Vec::new()),
        })
    }

    fn persist_state(&self) -> Result<(), String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "Failed to lock setup state".to_string())?
            .clone();

        let serialized = serde_json::to_string_pretty(&state)
            .map_err(|err| format!("Failed to serialize setup state: {err}"))?;

        fs::write(&self.state_path, serialized)
            .map_err(|err| format!("Failed to write setup state: {err}"))
    }

    fn persist_report(&self) -> Result<(), String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "Failed to lock setup state".to_string())?
            .clone();
        let logs = self
            .logs
            .lock()
            .map_err(|_| "Failed to lock setup logs".to_string())?
            .clone();

        let mut success = true;
        let mut steps = Vec::new();
        for step_id in STEP_ORDER {
            if let Some(runtime) = state.steps.get(step_id) {
                if runtime.status != "done" {
                    success = false;
                }
                let mut notes = Vec::new();
                if let Some(blocked) = &runtime.blocked_reason {
                    notes.push(blocked.clone());
                }
                if let Some(error) = &runtime.error {
                    notes.push(error.clone());
                }
                steps.push(StepReportItem {
                    id: step_id.to_string(),
                    status: runtime.status.clone(),
                    notes,
                });
            }
        }

        let report = SetupReport {
            generated_at: now_iso(),
            success,
            steps,
            logs,
        };

        let serialized = serde_json::to_string_pretty(&report)
            .map_err(|err| format!("Failed to serialize setup report: {err}"))?;

        fs::write(&self.report_path, serialized)
            .map_err(|err| format!("Failed to write setup report: {err}"))
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn find_repo_root() -> Result<PathBuf, String> {
    let mut cursor =
        std::env::current_dir().map_err(|err| format!("Failed to get current dir: {err}"))?;

    loop {
        let marker_git = cursor.join(".git");
        let marker_src = cursor.join("src/index.ts");
        let marker_package = cursor.join("package.json");

        if marker_git.exists() && marker_src.exists() && marker_package.exists() {
            return Ok(cursor);
        }

        if !cursor.pop() {
            break;
        }
    }

    Err("Failed to locate NanoClaw repository root".to_string())
}

fn create_initial_state() -> SetupState {
    let mut steps = BTreeMap::new();
    for step_id in STEP_ORDER {
        steps.insert(
            step_id.to_string(),
            SetupStepRuntime {
                id: step_id.to_string(),
                status: "idle".to_string(),
                started_at: None,
                finished_at: None,
                error: None,
                blocked_reason: None,
                retry_count: 0,
                manual_checkpoints: Vec::new(),
            },
        );
    }

    let timestamp = now_iso();

    SetupState {
        version: STATE_VERSION,
        created_at: timestamp.clone(),
        updated_at: timestamp,
        current_step: "preflight".to_string(),
        selected_runtime: None,
        steps,
        cancelled: false,
        step_payloads: BTreeMap::new(),
    }
}

fn next_step_of(step_id: &str) -> Option<String> {
    for (index, candidate) in STEP_ORDER.iter().enumerate() {
        if *candidate == step_id {
            return STEP_ORDER.get(index + 1).map(|value| (*value).to_string());
        }
    }
    None
}

fn make_log(step_id: &str, level: &str, message: impl Into<String>) -> SetupLogEntry {
    SetupLogEntry {
        timestamp: now_iso(),
        step_id: step_id.to_string(),
        level: level.to_string(),
        message: message.into(),
    }
}

fn emit_log(app: &AppHandle, entry: &SetupLogEntry) {
    let _ = app.emit("setup://log", entry);
}

fn emit_state(app: &AppHandle, state: &SetupState) {
    let _ = app.emit("setup://step-status", state);
}

fn emit_manual_action(app: &AppHandle, payload: &ManualActionEvent) {
    let _ = app.emit("setup://requires-user-action", payload);
}

fn emit_fatal_error(app: &AppHandle, message: String) {
    let _ = app.emit("setup://fatal-error", json!({ "message": message }));
}

fn append_logs(store: &SetupStore, logs: &[SetupLogEntry]) -> Result<(), String> {
    let mut guard = store
        .logs
        .lock()
        .map_err(|_| "Failed to lock setup logs".to_string())?;
    for entry in logs {
        guard.push(entry.clone());
    }
    Ok(())
}

fn write_file(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create directory {}: {err}", parent.display()))?;
    }
    fs::write(path, content).map_err(|err| format!("Failed to write {}: {err}", path.display()))
}

fn command_exists(binary: &str) -> bool {
    Command::new("/bin/zsh")
        .arg("-lc")
        .arg(format!("command -v {binary} >/dev/null 2>&1"))
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn run_shell_script(
    app: &AppHandle,
    step_id: &str,
    cwd: &Path,
    script: &str,
    envs: &[(String, String)],
) -> (Vec<SetupLogEntry>, Result<(), String>) {
    let collector = Arc::new(Mutex::new(Vec::<SetupLogEntry>::new()));

    let command_entry = make_log(step_id, "info", format!("$ {script}"));
    emit_log(app, &command_entry);
    if let Ok(mut guard) = collector.lock() {
        guard.push(command_entry);
    }

    let mut command = Command::new("/bin/zsh");
    command
        .arg("-lc")
        .arg(script)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    for (key, value) in envs {
        command.env(key, value);
    }

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(err) => {
            let entry = make_log(step_id, "error", format!("Failed to spawn command: {err}"));
            emit_log(app, &entry);
            if let Ok(mut guard) = collector.lock() {
                guard.push(entry);
            }

            let logs = collector
                .lock()
                .map(|data| data.clone())
                .unwrap_or_default();
            return (logs, Err(format!("Failed to spawn command: {err}")));
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let mut handles = Vec::new();

    if let Some(stdout_reader) = stdout {
        handles.push(spawn_stream_reader(
            app.clone(),
            collector.clone(),
            step_id.to_string(),
            "info".to_string(),
            stdout_reader,
        ));
    }

    if let Some(stderr_reader) = stderr {
        handles.push(spawn_stream_reader(
            app.clone(),
            collector.clone(),
            step_id.to_string(),
            "warning".to_string(),
            stderr_reader,
        ));
    }

    let status = child.wait();

    for handle in handles {
        let _ = handle.join();
    }

    let mut logs = collector
        .lock()
        .map(|data| data.clone())
        .unwrap_or_default();

    match status {
        Ok(exit) if exit.success() => (logs, Ok(())),
        Ok(exit) => {
            let entry = make_log(
                step_id,
                "error",
                format!("Command exited with code {:?}", exit.code()),
            );
            emit_log(app, &entry);
            logs.push(entry);
            (
                logs,
                Err(format!("Command failed with exit code {:?}", exit.code())),
            )
        }
        Err(err) => {
            let entry = make_log(
                step_id,
                "error",
                format!("Failed to wait for command: {err}"),
            );
            emit_log(app, &entry);
            logs.push(entry);
            (logs, Err(format!("Failed to wait for command: {err}")))
        }
    }
}

fn spawn_stream_reader<R: Read + Send + 'static>(
    app: AppHandle,
    collector: Arc<Mutex<Vec<SetupLogEntry>>>,
    step_id: String,
    level: String,
    stream: R,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines() {
            match line {
                Ok(content) => {
                    let entry = make_log(&step_id, &level, content);
                    emit_log(&app, &entry);
                    if let Ok(mut guard) = collector.lock() {
                        guard.push(entry);
                    }
                }
                Err(err) => {
                    let entry = make_log(&step_id, "warning", format!("Stream read error: {err}"));
                    emit_log(&app, &entry);
                    if let Ok(mut guard) = collector.lock() {
                        guard.push(entry);
                    }
                }
            }
        }
    })
}

fn run_shell_and_capture_stdout(
    cwd: &Path,
    script: &str,
    envs: &[(String, String)],
) -> Result<String, String> {
    let mut command = Command::new("/bin/zsh");
    command.arg("-lc").arg(script).current_dir(cwd);
    for (key, value) in envs {
        command.env(key, value);
    }

    let output = command
        .output()
        .map_err(|err| format!("Failed to run command: {err}"))?;

    if !output.status.success() {
        return Err(format!(
            "Command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn set_keychain_secret(account: &str, value: &str) -> Result<(), String> {
    let status = Command::new("security")
        .args([
            "add-generic-password",
            "-U",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            account,
            "-w",
            value,
        ])
        .status()
        .map_err(|err| format!("Failed to execute security command: {err}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("Failed to save {account} in Keychain"))
    }
}

fn get_keychain_secret(account: &str) -> Option<String> {
    let output = Command::new("security")
        .args([
            "find-generic-password",
            "-w",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            account,
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn collect_auth_env() -> Vec<(String, String)> {
    let mut envs = Vec::new();
    for account in [
        "CLAUDE_CODE_OAUTH_TOKEN",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_AUTH_TOKEN",
        "DISCORD_BOT_TOKEN",
        "DISCORD_APP_ID",
        "ASSISTANT_NAME",
    ] {
        if let Some(value) = get_keychain_secret(account) {
            envs.push((account.to_string(), value));
        }
    }
    envs
}

fn execute_step(
    app: &AppHandle,
    store: &SetupStore,
    state_snapshot: &SetupState,
    step_id: &str,
    payload: &Value,
) -> Result<StepResult, String> {
    match step_id {
        "preflight" => run_preflight(app, store),
        "install_dependencies" => run_install_dependencies(app, store),
        "container_runtime" => run_container_runtime(app, payload),
        "claude_auth" => run_claude_auth(payload),
        "build_agent_image" => run_build_agent_image(app, store, state_snapshot),
        "discord_auth" => run_discord_auth(payload),
        "assistant_name" => run_assistant_name(store, payload),
        "security_confirmation" => run_security_confirmation(payload),
        "register_main_channel" => run_register_main_channel(store, payload),
        "mount_allowlist" => run_mount_allowlist(payload),
        "launchd_setup" => run_launchd_setup(app, store),
        "final_test" => run_final_test(app, store, state_snapshot),
        _ => Err(format!("Unknown step id: {step_id}")),
    }
}

fn run_preflight(app: &AppHandle, store: &SetupStore) -> Result<StepResult, String> {
    let mut notes = Vec::new();
    let envs = collect_auth_env();
    let script = r#"
      echo "Checking Node and npm";
      if command -v node >/dev/null 2>&1; then echo "NODE_OK $(node --version)"; else echo "NODE_MISSING"; fi
      if command -v npm >/dev/null 2>&1; then echo "NPM_OK $(npm --version)"; else echo "NPM_MISSING"; fi
      if command -v claude >/dev/null 2>&1; then echo "CLAUDE_OK"; claude --version; else echo "CLAUDE_MISSING"; fi
      echo "PLATFORM $(uname -s)";
      if [ -w . ]; then echo "REPO_WRITABLE"; else echo "REPO_NOT_WRITABLE"; fi
      if curl -Is --max-time 5 https://discord.com >/dev/null 2>&1; then echo "NETWORK_HINT_OK"; else echo "NETWORK_HINT_WARN"; fi
    "#;

    let (logs, result) = run_shell_script(app, "preflight", &store.repo_root, script, &envs);
    if let Err(err) = result {
        return Err(err);
    }

    let mut blocked_points = Vec::new();

    if logs
        .iter()
        .any(|entry| entry.message.contains("NODE_MISSING"))
    {
        blocked_points.push(ManualCheckpoint {
            id: "install-node".to_string(),
            title: "Install Node.js 20+".to_string(),
            instructions: vec![
                "Install Node.js from https://nodejs.org".to_string(),
                "Re-open NanoClaw Desktop Setup".to_string(),
            ],
            severity: "error".to_string(),
            skippable: false,
            completed: false,
        });
    }

    if logs
        .iter()
        .any(|entry| entry.message.contains("NPM_MISSING"))
    {
        blocked_points.push(ManualCheckpoint {
            id: "install-npm".to_string(),
            title: "Install npm".to_string(),
            instructions: vec![
                "npm should be installed with Node.js".to_string(),
                "Ensure npm is available in PATH".to_string(),
            ],
            severity: "error".to_string(),
            skippable: false,
            completed: false,
        });
    }

    if logs
        .iter()
        .any(|entry| entry.message.contains("CLAUDE_MISSING"))
    {
        blocked_points.push(ManualCheckpoint {
            id: "install-claude".to_string(),
            title: "Install Claude Code CLI".to_string(),
            instructions: vec![
                "Download Claude Code from https://claude.ai/download".to_string(),
                "Confirm `claude --version` works in terminal".to_string(),
            ],
            severity: "warning".to_string(),
            skippable: false,
            completed: false,
        });
    }

    if logs
        .iter()
        .any(|entry| entry.message.contains("REPO_NOT_WRITABLE"))
    {
        blocked_points.push(ManualCheckpoint {
            id: "repo-permission".to_string(),
            title: "Repository must be writable".to_string(),
            instructions: vec![
                "Adjust folder permissions for the NanoClaw repository".to_string(),
                "Re-run preflight".to_string(),
            ],
            severity: "error".to_string(),
            skippable: false,
            completed: false,
        });
    }

    if !blocked_points.is_empty() {
        return Ok(StepResult {
            status: "blocked".to_string(),
            next_step: None,
            selected_runtime: None,
            blocked_reason: Some("Preflight requires manual remediation".to_string()),
            checkpoints: blocked_points,
            notes,
            logs,
        });
    }

    if logs
        .iter()
        .any(|entry| entry.message.contains("NETWORK_HINT_WARN"))
    {
        notes.push(
            "Network reachability check failed; setup can continue but external services may fail."
                .to_string(),
        );
    }

    Ok(StepResult {
        status: "done".to_string(),
        next_step: next_step_of("preflight"),
        selected_runtime: None,
        blocked_reason: None,
        checkpoints: Vec::new(),
        notes,
        logs,
    })
}

fn run_install_dependencies(app: &AppHandle, store: &SetupStore) -> Result<StepResult, String> {
    let envs = collect_auth_env();
    let (logs, result) = run_shell_script(
        app,
        "install_dependencies",
        &store.repo_root,
        "npm install",
        &envs,
    );
    if let Err(err) = result {
        return Err(err);
    }

    Ok(StepResult {
        status: "done".to_string(),
        next_step: next_step_of("install_dependencies"),
        selected_runtime: None,
        blocked_reason: None,
        checkpoints: Vec::new(),
        notes: vec!["Dependencies installed.".to_string()],
        logs,
    })
}

fn run_container_runtime(app: &AppHandle, payload: &Value) -> Result<StepResult, String> {
    let requested = payload
        .get("runtime")
        .and_then(Value::as_str)
        .unwrap_or("apple_container")
        .to_string();

    let mut logs = Vec::new();
    let mut checkpoints = Vec::new();

    let has_container = command_exists("container");
    let has_docker = command_exists("docker");

    logs.push(make_log(
        "container_runtime",
        "info",
        format!("Detected runtimes: apple_container={has_container}, docker={has_docker}"),
    ));

    if requested == "apple_container" {
        if !has_container {
            checkpoints.push(ManualCheckpoint {
                id: "install-apple-container".to_string(),
                title: "Install Apple Container".to_string(),
                instructions: vec![
                    "Download latest package from https://github.com/apple/container/releases"
                        .to_string(),
                    "Install and run `container system start`".to_string(),
                ],
                severity: "error".to_string(),
                skippable: false,
                completed: false,
            });
        } else {
            let (step_logs, result) = run_shell_script(
                app,
                "container_runtime",
                Path::new("/"),
                "container system status >/dev/null 2>&1 || container system start",
                &[],
            );
            logs.extend(step_logs);
            if let Err(_) = result {
                checkpoints.push(ManualCheckpoint {
                    id: "start-apple-container".to_string(),
                    title: "Start Apple Container".to_string(),
                    instructions: vec![
                        "Run `container system start` in Terminal".to_string(),
                        "Then click Retry Step".to_string(),
                    ],
                    severity: "error".to_string(),
                    skippable: false,
                    completed: false,
                });
            }
        }
    } else if requested == "docker" {
        if !has_docker {
            checkpoints.push(ManualCheckpoint {
                id: "install-docker".to_string(),
                title: "Install Docker".to_string(),
                instructions: vec![
                    "Install Docker Desktop from https://docker.com/products/docker-desktop"
                        .to_string(),
                    "Start Docker Desktop and wait until it is ready".to_string(),
                ],
                severity: "error".to_string(),
                skippable: false,
                completed: false,
            });
        } else {
            let (step_logs, result) = run_shell_script(
                app,
                "container_runtime",
                Path::new("/"),
                "docker info >/dev/null",
                &[],
            );
            logs.extend(step_logs);
            if let Err(_) = result {
                checkpoints.push(ManualCheckpoint {
                    id: "start-docker".to_string(),
                    title: "Start Docker".to_string(),
                    instructions: vec![
                        "Start Docker Desktop".to_string(),
                        "Wait for Docker engine to be ready".to_string(),
                    ],
                    severity: "error".to_string(),
                    skippable: false,
                    completed: false,
                });
            }
        }
    } else {
        return Err(format!("Unsupported runtime: {requested}"));
    }

    if !checkpoints.is_empty() {
        return Ok(StepResult {
            status: "blocked".to_string(),
            next_step: None,
            selected_runtime: None,
            blocked_reason: Some("Container runtime needs manual setup".to_string()),
            checkpoints,
            notes: Vec::new(),
            logs,
        });
    }

    Ok(StepResult {
        status: "done".to_string(),
        next_step: next_step_of("container_runtime"),
        selected_runtime: Some(requested),
        blocked_reason: None,
        checkpoints: Vec::new(),
        notes: vec!["Container runtime is available and ready.".to_string()],
        logs,
    })
}

fn run_claude_auth(payload: &Value) -> Result<StepResult, String> {
    let method = payload
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("oauth");
    let token = payload
        .get("token")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();

    if token.is_empty() {
        return Err("Claude token is required".to_string());
    }

    if method == "oauth" && !token.starts_with("sk-ant-oat") {
        return Err("Expected Claude subscription token (sk-ant-oat...)".to_string());
    }

    if method == "api_key" && !token.starts_with("sk-ant-api") {
        return Err("Expected Anthropic API key (sk-ant-api...)".to_string());
    }

    let account = if method == "api_key" {
        "ANTHROPIC_API_KEY"
    } else {
        "CLAUDE_CODE_OAUTH_TOKEN"
    };

    set_keychain_secret(account, &token)?;
    set_keychain_secret("CLAUDE_AUTH_METHOD", method)?;

    if get_keychain_secret(account).is_none() {
        return Err(format!("Failed to verify {account} from Keychain"));
    }

    Ok(StepResult {
        status: "done".to_string(),
        next_step: next_step_of("claude_auth"),
        selected_runtime: None,
        blocked_reason: None,
        checkpoints: Vec::new(),
        notes: vec![format!(
            "Stored {account} in Keychain service {KEYCHAIN_SERVICE}."
        )],
        logs: vec![make_log(
            "claude_auth",
            "info",
            format!("Saved {account} into Keychain."),
        )],
    })
}

fn run_build_agent_image(
    app: &AppHandle,
    store: &SetupStore,
    state_snapshot: &SetupState,
) -> Result<StepResult, String> {
    let runtime = state_snapshot
        .selected_runtime
        .clone()
        .unwrap_or_else(|| "apple_container".to_string());

    let envs = collect_auth_env();

    let mut logs = Vec::new();

    if runtime == "docker" {
        let (build_logs, build_result) = run_shell_script(
            app,
            "build_agent_image",
            &store.repo_root,
            "docker build -t nanoclaw-agent:latest ./container",
            &envs,
        );
        logs.extend(build_logs);
        if let Err(err) = build_result {
            return Err(err);
        }

        let (smoke_logs, smoke_result) = run_shell_script(
            app,
            "build_agent_image",
            &store.repo_root,
            "echo '{}' | docker run -i --rm --entrypoint /bin/echo nanoclaw-agent:latest \"Container OK\"",
            &envs,
        );
        logs.extend(smoke_logs);
        if let Err(err) = smoke_result {
            return Err(err);
        }
    } else {
        let (build_logs, build_result) = run_shell_script(
            app,
            "build_agent_image",
            &store.repo_root,
            "bash ./container/build.sh",
            &envs,
        );
        logs.extend(build_logs);
        if let Err(err) = build_result {
            return Err(err);
        }

        let (smoke_logs, smoke_result) = run_shell_script(
            app,
            "build_agent_image",
            &store.repo_root,
            "echo '{}' | container run -i --entrypoint /bin/echo nanoclaw-agent:latest \"Container OK\"",
            &envs,
        );
        logs.extend(smoke_logs);
        if let Err(err) = smoke_result {
            return Err(err);
        }
    }

    Ok(StepResult {
        status: "done".to_string(),
        next_step: next_step_of("build_agent_image"),
        selected_runtime: None,
        blocked_reason: None,
        checkpoints: Vec::new(),
        notes: vec![format!(
            "Agent image built and smoke-tested with {runtime}."
        )],
        logs,
    })
}

fn run_discord_auth(payload: &Value) -> Result<StepResult, String> {
    let token = payload
        .get("discordBotToken")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();

    if token.len() < 30 || !token.contains('.') {
        return Err("Discord bot token looks invalid".to_string());
    }

    set_keychain_secret("DISCORD_BOT_TOKEN", &token)?;

    if let Some(app_id) = payload
        .get("discordAppId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        set_keychain_secret("DISCORD_APP_ID", app_id)?;
    }

    Ok(StepResult {
        status: "done".to_string(),
        next_step: next_step_of("discord_auth"),
        selected_runtime: None,
        blocked_reason: None,
        checkpoints: Vec::new(),
        notes: vec!["Discord credentials stored in Keychain.".to_string()],
        logs: vec![make_log(
            "discord_auth",
            "info",
            "Discord token saved to Keychain.",
        )],
    })
}

fn run_assistant_name(store: &SetupStore, payload: &Value) -> Result<StepResult, String> {
    let raw_name = payload
        .get("assistantName")
        .and_then(Value::as_str)
        .unwrap_or("Andy")
        .trim();

    if raw_name.is_empty() {
        return Err("Assistant name cannot be empty".to_string());
    }

    let assistant_name: String = raw_name
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '-')
        .collect();

    if assistant_name.is_empty() {
        return Err("Assistant name must contain letters or numbers".to_string());
    }

    set_keychain_secret("ASSISTANT_NAME", &assistant_name)?;

    for rel_path in ["groups/main/CLAUDE.md", "groups/CLAUDE.md"] {
        let file_path = store.repo_root.join(rel_path);
        if !file_path.exists() {
            continue;
        }

        let content = fs::read_to_string(&file_path)
            .map_err(|err| format!("Failed to read {}: {err}", file_path.display()))?;

        let updated = content
            .replace("# Andy", &format!("# {assistant_name}"))
            .replace("You are Andy", &format!("You are {assistant_name}"))
            .replace("@Andy", &format!("@{assistant_name}"));

        write_file(&file_path, &updated)?;
    }

    Ok(StepResult {
        status: "done".to_string(),
        next_step: next_step_of("assistant_name"),
        selected_runtime: None,
        blocked_reason: None,
        checkpoints: Vec::new(),
        notes: vec![format!("Assistant name set to {assistant_name}.")],
        logs: vec![make_log(
            "assistant_name",
            "info",
            format!("Assistant name updated to {assistant_name}."),
        )],
    })
}

fn run_security_confirmation(payload: &Value) -> Result<StepResult, String> {
    let confirmed = payload
        .get("confirmed")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    if !confirmed {
        return Ok(StepResult {
            status: "blocked".to_string(),
            next_step: None,
            selected_runtime: None,
            blocked_reason: Some(
                "You must acknowledge main-channel administrative privileges before proceeding."
                    .to_string(),
            ),
            checkpoints: vec![ManualCheckpoint {
                id: "confirm-main-channel-risk".to_string(),
                title: "Acknowledge security model".to_string(),
                instructions: vec![
                    "Main channel can manage all groups and tasks.".to_string(),
                    "Use a personal DM or private admin channel for main.".to_string(),
                ],
                severity: "warning".to_string(),
                skippable: false,
                completed: false,
            }],
            notes: Vec::new(),
            logs: vec![make_log(
                "security_confirmation",
                "warning",
                "Security confirmation is required.",
            )],
        });
    }

    Ok(StepResult {
        status: "done".to_string(),
        next_step: next_step_of("security_confirmation"),
        selected_runtime: None,
        blocked_reason: None,
        checkpoints: Vec::new(),
        notes: vec!["Security confirmation accepted.".to_string()],
        logs: vec![make_log(
            "security_confirmation",
            "info",
            "Main channel risk acknowledged.",
        )],
    })
}

fn run_register_main_channel(store: &SetupStore, payload: &Value) -> Result<StepResult, String> {
    let mut channel_id = payload
        .get("channelId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();

    if channel_id.is_empty() {
        channel_id = discover_latest_channel_id(&store.repo_root)?;
    }

    if channel_id.is_empty() {
        return Ok(StepResult {
            status: "blocked".to_string(),
            next_step: None,
            selected_runtime: None,
            blocked_reason: Some(
                "No channel ID available. Send any message to your bot, then retry this step."
                    .to_string(),
            ),
            checkpoints: vec![ManualCheckpoint {
                id: "send-discord-message".to_string(),
                title: "Generate channel metadata".to_string(),
                instructions: vec![
                    "Send a message in your target Discord DM or channel.".to_string(),
                    "Retry registration after the message appears.".to_string(),
                ],
                severity: "warning".to_string(),
                skippable: false,
                completed: false,
            }],
            notes: Vec::new(),
            logs: vec![make_log(
                "register_main_channel",
                "warning",
                "Could not auto-detect channel id from store/messages.db",
            )],
        });
    }

    let name = payload
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("main")
        .trim();
    let folder = payload
        .get("folder")
        .and_then(Value::as_str)
        .unwrap_or("main")
        .trim();
    let trigger = payload
        .get("trigger")
        .and_then(Value::as_str)
        .unwrap_or("@Andy")
        .trim();

    if folder.is_empty() {
        return Err("Main folder cannot be empty".to_string());
    }

    let target = store.repo_root.join("data/registered_groups.json");
    let mut groups: BTreeMap<String, Value> = if target.exists() {
        let content = fs::read_to_string(&target)
            .map_err(|err| format!("Failed to read registered_groups.json: {err}"))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        BTreeMap::new()
    };

    groups.insert(
        channel_id.clone(),
        json!({
            "name": name,
            "folder": folder,
            "trigger": trigger,
            "added_at": now_iso(),
        }),
    );

    write_file(
        &target,
        &serde_json::to_string_pretty(&groups)
            .map_err(|err| format!("Failed to serialize registered groups: {err}"))?,
    )?;

    fs::create_dir_all(store.repo_root.join(format!("groups/{folder}/logs")))
        .map_err(|err| format!("Failed to create group folder: {err}"))?;

    Ok(StepResult {
        status: "done".to_string(),
        next_step: next_step_of("register_main_channel"),
        selected_runtime: None,
        blocked_reason: None,
        checkpoints: Vec::new(),
        notes: vec![format!("Registered main channel {channel_id}.")],
        logs: vec![make_log(
            "register_main_channel",
            "info",
            format!("Registered channel {channel_id} with folder {folder}."),
        )],
    })
}

fn discover_latest_channel_id(repo_root: &Path) -> Result<String, String> {
    let db_path = repo_root.join("store/messages.db");
    if !db_path.exists() {
        return Ok(String::new());
    }

    let script = format!(
        "sqlite3 {} \"SELECT jid FROM chats WHERE jid != '__group_sync__' ORDER BY last_message_time DESC LIMIT 1;\"",
        shell_escape(db_path.to_string_lossy().as_ref())
    );

    run_shell_and_capture_stdout(repo_root, &script, &[])
}

fn shell_escape(value: &str) -> String {
    format!("'{}'", value.replace('"', "\\\"").replace('\'', "'\\''"))
}

fn run_mount_allowlist(payload: &Value) -> Result<StepResult, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    let allowlist_path = PathBuf::from(home).join(".config/nanoclaw/mount-allowlist.json");

    let non_main_read_only = payload
        .get("nonMainReadOnly")
        .and_then(Value::as_bool)
        .unwrap_or(true);

    let mut allowed_roots = Vec::new();
    if let Some(roots) = payload.get("allowedRoots").and_then(Value::as_array) {
        for root in roots {
            if let Some(path) = root.get("path").and_then(Value::as_str) {
                let path = path.trim();
                if path.is_empty() {
                    continue;
                }

                let allow_read_write = root
                    .get("allowReadWrite")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                let description = root
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();

                allowed_roots.push(json!({
                    "path": path,
                    "allowReadWrite": allow_read_write,
                    "description": description,
                }));
            }
        }
    }

    let content = json!({
        "allowedRoots": allowed_roots,
        "blockedPatterns": [],
        "nonMainReadOnly": non_main_read_only,
    });

    write_file(
        &allowlist_path,
        &serde_json::to_string_pretty(&content)
            .map_err(|err| format!("Failed to serialize allowlist: {err}"))?,
    )?;

    Ok(StepResult {
        status: "done".to_string(),
        next_step: next_step_of("mount_allowlist"),
        selected_runtime: None,
        blocked_reason: None,
        checkpoints: Vec::new(),
        notes: vec![format!(
            "Wrote mount allowlist to {}",
            allowlist_path.display()
        )],
        logs: vec![make_log(
            "mount_allowlist",
            "info",
            format!("Allowlist updated at {}", allowlist_path.display()),
        )],
    })
}

fn run_launchd_setup(app: &AppHandle, store: &SetupStore) -> Result<StepResult, String> {
    let node_path = run_shell_and_capture_stdout(&store.repo_root, "which node", &[])?;
    let script_path = store
        .repo_root
        .join("scripts/run-nanoclaw-from-keychain.sh");

    let script_content = format!(
        r#"#!/bin/zsh
set -euo pipefail

PROJECT_ROOT={project_root}
NODE_PATH={node_path}

CLAUDE_CODE_OAUTH_TOKEN=$(security find-generic-password -w -s {service} -a CLAUDE_CODE_OAUTH_TOKEN 2>/dev/null || true)
ANTHROPIC_API_KEY=$(security find-generic-password -w -s {service} -a ANTHROPIC_API_KEY 2>/dev/null || true)
DISCORD_BOT_TOKEN=$(security find-generic-password -w -s {service} -a DISCORD_BOT_TOKEN 2>/dev/null || true)
DISCORD_APP_ID=$(security find-generic-password -w -s {service} -a DISCORD_APP_ID 2>/dev/null || true)
ASSISTANT_NAME=$(security find-generic-password -w -s {service} -a ASSISTANT_NAME 2>/dev/null || true)

if [ -z "$DISCORD_BOT_TOKEN" ]; then
  echo "Missing DISCORD_BOT_TOKEN in Keychain"
  exit 1
fi

if [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ] && [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "Missing Claude credential in Keychain"
  exit 1
fi

if [ -z "$ASSISTANT_NAME" ]; then
  ASSISTANT_NAME="Andy"
fi

export CLAUDE_CODE_OAUTH_TOKEN
export ANTHROPIC_API_KEY
export DISCORD_BOT_TOKEN
export DISCORD_APP_ID
export ASSISTANT_NAME

cd "$PROJECT_ROOT"
exec "$NODE_PATH" "$PROJECT_ROOT/dist/index.js"
"#,
        project_root = shell_escape(store.repo_root.to_string_lossy().as_ref()),
        node_path = shell_escape(&node_path),
        service = KEYCHAIN_SERVICE,
    );

    write_file(&script_path, &script_content)?;

    let script_path_str = script_path
        .to_str()
        .ok_or_else(|| "Invalid script path".to_string())?;

    let chmod_status = Command::new("chmod")
        .args(["+x", script_path_str])
        .status()
        .map_err(|err| format!("Failed to chmod launch script: {err}"))?;
    if !chmod_status.success() {
        return Err("Failed to chmod launch script".to_string());
    }

    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    let plist_path = PathBuf::from(&home).join("Library/LaunchAgents/com.nanoclaw.plist");

    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nanoclaw</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/zsh</string>
        <string>{script_path}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>{project_root}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>{home}/.local/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>{home}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>{project_root}/logs/nanoclaw.log</string>
    <key>StandardErrorPath</key>
    <string>{project_root}/logs/nanoclaw.error.log</string>
</dict>
</plist>
"#,
        script_path = script_path.display(),
        project_root = store.repo_root.display(),
        home = home,
    );

    write_file(&plist_path, &plist)?;

    fs::create_dir_all(store.repo_root.join("logs"))
        .map_err(|err| format!("Failed to create logs directory: {err}"))?;

    let envs = collect_auth_env();
    let (build_logs, build_result) = run_shell_script(
        app,
        "launchd_setup",
        &store.repo_root,
        "npm run build",
        &envs,
    );
    if let Err(err) = build_result {
        return Err(err);
    }

    let launch_script = format!(
        "launchctl unload {} >/dev/null 2>&1 || true; launchctl load {}",
        shell_escape(plist_path.to_string_lossy().as_ref()),
        shell_escape(plist_path.to_string_lossy().as_ref())
    );

    let (launch_logs, launch_result) = run_shell_script(
        app,
        "launchd_setup",
        &store.repo_root,
        &launch_script,
        &envs,
    );

    let mut logs = Vec::new();
    logs.extend(build_logs);
    logs.extend(launch_logs);

    if let Err(err) = launch_result {
        return Err(err);
    }

    Ok(StepResult {
        status: "done".to_string(),
        next_step: next_step_of("launchd_setup"),
        selected_runtime: None,
        blocked_reason: None,
        checkpoints: Vec::new(),
        notes: vec![
            format!("Launch script created at {}", script_path.display()),
            format!("launchd plist created at {}", plist_path.display()),
        ],
        logs,
    })
}

fn run_final_test(
    app: &AppHandle,
    store: &SetupStore,
    state_snapshot: &SetupState,
) -> Result<StepResult, String> {
    let runtime = state_snapshot
        .selected_runtime
        .clone()
        .unwrap_or_else(|| "apple_container".to_string());
    let envs = collect_auth_env();

    let runtime_check = if runtime == "docker" {
        "docker info >/dev/null && echo RUNTIME_OK || echo RUNTIME_FAIL"
    } else {
        "container system status >/dev/null && echo RUNTIME_OK || echo RUNTIME_FAIL"
    };

    let script = format!(
        "launchctl list | grep -q com.nanoclaw && echo SERVICE_OK || echo SERVICE_FAIL; \
         test -f logs/nanoclaw.log && echo LOG_OK || echo LOG_WARN; \
         test -f data/registered_groups.json && echo GROUPS_OK || echo GROUPS_FAIL; \
         {}",
        runtime_check
    );

    let (logs, result) = run_shell_script(app, "final_test", &store.repo_root, &script, &envs);
    if let Err(err) = result {
        return Err(err);
    }

    let has_service = logs.iter().any(|item| item.message.contains("SERVICE_OK"));
    let has_groups = logs.iter().any(|item| item.message.contains("GROUPS_OK"));
    let has_runtime = logs.iter().any(|item| item.message.contains("RUNTIME_OK"));

    if !(has_service && has_groups && has_runtime) {
        return Err(
            "Final test did not pass all checks (service/groups/runtime). Review log panel."
                .to_string(),
        );
    }

    Ok(StepResult {
        status: "done".to_string(),
        next_step: None,
        selected_runtime: None,
        blocked_reason: None,
        checkpoints: Vec::new(),
        notes: vec!["Setup completed successfully.".to_string()],
        logs,
    })
}

fn set_step_running(state: &mut SetupState, step_id: &str, retry: bool) {
    let timestamp = now_iso();
    state.updated_at = timestamp.clone();
    state.current_step = step_id.to_string();

    if let Some(runtime) = state.steps.get_mut(step_id) {
        runtime.status = "running".to_string();
        runtime.started_at = Some(runtime.started_at.clone().unwrap_or(timestamp));
        runtime.finished_at = None;
        runtime.error = None;
        runtime.blocked_reason = None;
        runtime.manual_checkpoints.clear();
        if retry {
            runtime.retry_count = runtime.retry_count.saturating_add(1);
        }
    }
}

fn finalize_step(state: &mut SetupState, step_id: &str, result: &StepResult) {
    let timestamp = now_iso();
    state.updated_at = timestamp.clone();

    if let Some(runtime) = state.steps.get_mut(step_id) {
        runtime.status = result.status.clone();
        runtime.finished_at = Some(timestamp);
        runtime.error = None;
        runtime.blocked_reason = result.blocked_reason.clone();
        runtime.manual_checkpoints = result.checkpoints.clone();
    }

    if let Some(selected_runtime) = &result.selected_runtime {
        state.selected_runtime = Some(selected_runtime.clone());
    }

    if result.status == "done" {
        if let Some(next_step) = &result.next_step {
            state.current_step = next_step.clone();
        }
    }
}

fn fail_step(state: &mut SetupState, step_id: &str, message: String) {
    let timestamp = now_iso();
    state.updated_at = timestamp.clone();
    state.current_step = step_id.to_string();

    if let Some(runtime) = state.steps.get_mut(step_id) {
        runtime.status = "failed".to_string();
        runtime.finished_at = Some(timestamp);
        runtime.error = Some(message);
        runtime.blocked_reason = None;
    }
}

#[tauri::command]
pub fn setup_get_state(store: State<'_, SetupStore>) -> Result<SetupState, String> {
    let state = store
        .state
        .lock()
        .map_err(|_| "Failed to lock setup state".to_string())?
        .clone();
    Ok(state)
}

#[tauri::command]
pub fn setup_start_step(
    app: AppHandle,
    store: State<'_, SetupStore>,
    payload: StartStepPayload,
) -> Result<SetupState, String> {
    {
        let mut state = store
            .state
            .lock()
            .map_err(|_| "Failed to lock setup state".to_string())?;
        state.cancelled = false;
        set_step_running(&mut state, &payload.step_id, false);
        state.step_payloads.insert(
            payload.step_id.clone(),
            payload.data.clone().unwrap_or(Value::Null),
        );
    }

    store.persist_state()?;

    let state_snapshot = store
        .state
        .lock()
        .map_err(|_| "Failed to lock setup state".to_string())?
        .clone();

    emit_state(&app, &state_snapshot);

    let data = payload.data.unwrap_or(Value::Null);
    let result = execute_step(&app, &store, &state_snapshot, &payload.step_id, &data);

    match result {
        Ok(step_result) => {
            append_logs(&store, &step_result.logs)?;

            {
                let mut state = store
                    .state
                    .lock()
                    .map_err(|_| "Failed to lock setup state".to_string())?;
                finalize_step(&mut state, &payload.step_id, &step_result);
            }

            store.persist_state()?;
            store.persist_report()?;

            if step_result.status == "blocked" {
                emit_manual_action(
                    &app,
                    &ManualActionEvent {
                        step_id: payload.step_id.clone(),
                        reason: step_result
                            .blocked_reason
                            .clone()
                            .unwrap_or_else(|| "Manual action required".to_string()),
                        checkpoints: step_result.checkpoints,
                    },
                );
            }

            let state = store
                .state
                .lock()
                .map_err(|_| "Failed to lock setup state".to_string())?
                .clone();
            emit_state(&app, &state);
            Ok(state)
        }
        Err(err) => {
            {
                let mut state = store
                    .state
                    .lock()
                    .map_err(|_| "Failed to lock setup state".to_string())?;
                fail_step(&mut state, &payload.step_id, err.clone());
            }
            store.persist_state()?;
            store.persist_report()?;

            let entry = make_log(&payload.step_id, "error", err.clone());
            append_logs(&store, &[entry.clone()])?;
            emit_log(&app, &entry);
            emit_fatal_error(&app, err.clone());

            let state = store
                .state
                .lock()
                .map_err(|_| "Failed to lock setup state".to_string())?
                .clone();
            emit_state(&app, &state);

            Ok(state)
        }
    }
}

#[tauri::command]
pub fn setup_retry_step(
    app: AppHandle,
    store: State<'_, SetupStore>,
    payload: RetryStepPayload,
) -> Result<SetupState, String> {
    let retry_payload = {
        let mut state = store
            .state
            .lock()
            .map_err(|_| "Failed to lock setup state".to_string())?;
        set_step_running(&mut state, &payload.step_id, true);
        state
            .step_payloads
            .get(&payload.step_id)
            .cloned()
            .unwrap_or(Value::Null)
    };

    store.persist_state()?;

    let state_snapshot = store
        .state
        .lock()
        .map_err(|_| "Failed to lock setup state".to_string())?
        .clone();
    emit_state(&app, &state_snapshot);

    let result = execute_step(
        &app,
        &store,
        &state_snapshot,
        &payload.step_id,
        &retry_payload,
    );

    match result {
        Ok(step_result) => {
            append_logs(&store, &step_result.logs)?;

            {
                let mut state = store
                    .state
                    .lock()
                    .map_err(|_| "Failed to lock setup state".to_string())?;
                finalize_step(&mut state, &payload.step_id, &step_result);
            }

            store.persist_state()?;
            store.persist_report()?;

            if step_result.status == "blocked" {
                emit_manual_action(
                    &app,
                    &ManualActionEvent {
                        step_id: payload.step_id.clone(),
                        reason: step_result
                            .blocked_reason
                            .clone()
                            .unwrap_or_else(|| "Manual action required".to_string()),
                        checkpoints: step_result.checkpoints,
                    },
                );
            }

            let state = store
                .state
                .lock()
                .map_err(|_| "Failed to lock setup state".to_string())?
                .clone();
            emit_state(&app, &state);
            Ok(state)
        }
        Err(err) => {
            {
                let mut state = store
                    .state
                    .lock()
                    .map_err(|_| "Failed to lock setup state".to_string())?;
                fail_step(&mut state, &payload.step_id, err.clone());
            }

            store.persist_state()?;
            store.persist_report()?;
            emit_fatal_error(&app, err);

            let state = store
                .state
                .lock()
                .map_err(|_| "Failed to lock setup state".to_string())?
                .clone();
            emit_state(&app, &state);
            Ok(state)
        }
    }
}

#[tauri::command]
pub fn setup_skip_manual_check(
    app: AppHandle,
    store: State<'_, SetupStore>,
    payload: SkipManualCheckPayload,
) -> Result<SetupState, String> {
    {
        let mut state = store
            .state
            .lock()
            .map_err(|_| "Failed to lock setup state".to_string())?;

        if let Some(runtime) = state.steps.get_mut(&payload.step_id) {
            for checkpoint in &mut runtime.manual_checkpoints {
                if checkpoint.id == payload.checkpoint_id {
                    checkpoint.completed = true;
                }
            }

            let all_completed = runtime
                .manual_checkpoints
                .iter()
                .all(|checkpoint| checkpoint.completed || checkpoint.skippable);

            if all_completed && runtime.status == "blocked" {
                runtime.status = "idle".to_string();
                runtime.blocked_reason = None;
            }
        }

        state.updated_at = now_iso();
    }

    store.persist_state()?;
    store.persist_report()?;

    let state = store
        .state
        .lock()
        .map_err(|_| "Failed to lock setup state".to_string())?
        .clone();

    emit_state(&app, &state);
    Ok(state)
}

#[tauri::command]
pub fn setup_cancel(app: AppHandle, store: State<'_, SetupStore>) -> Result<SetupState, String> {
    {
        let mut state = store
            .state
            .lock()
            .map_err(|_| "Failed to lock setup state".to_string())?;

        state.cancelled = true;
        state.updated_at = now_iso();
        let current_step = state.current_step.clone();
        if let Some(runtime) = state.steps.get_mut(&current_step) {
            runtime.status = "cancelled".to_string();
            runtime.finished_at = Some(now_iso());
        }
    }

    store.persist_state()?;
    store.persist_report()?;

    let entry = make_log("system", "warning", "Setup cancelled by user.");
    append_logs(&store, &[entry.clone()])?;
    emit_log(&app, &entry);

    let state = store
        .state
        .lock()
        .map_err(|_| "Failed to lock setup state".to_string())?
        .clone();
    emit_state(&app, &state);
    Ok(state)
}
