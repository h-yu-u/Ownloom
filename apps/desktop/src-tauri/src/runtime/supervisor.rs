use crate::runtime::handshake::HandshakeDecoder;
use crate::runtime::state::{
    RuntimeConnection, RuntimeProcess, RuntimeSnapshot, RuntimeStatusEvent, PROTOCOL_VERSION,
};
use std::sync::{atomic::Ordering, Arc};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

pub(crate) fn current_runtime_result(
    state: &RuntimeProcess,
) -> Result<Option<Result<RuntimeConnection, String>>, String> {
    let snapshot = state
        .status
        .lock()
        .map_err(|_| "Runtime status lock failed")?
        .clone();
    if snapshot.generation != state.generation.load(Ordering::SeqCst) {
        return Ok(None);
    }
    if let Some(connection) = snapshot.connection {
        return Ok(Some(Ok(connection)));
    }
    Ok(snapshot.error.map(Err))
}

pub(crate) fn launch_runtime(app: &AppHandle, process: Arc<RuntimeProcess>) -> Result<(), String> {
    let generation = process.generation.fetch_add(1, Ordering::SeqCst) + 1;
    *process
        .status
        .lock()
        .map_err(|_| "Runtime status lock failed")? = RuntimeSnapshot {
        generation,
        ..RuntimeSnapshot::default()
    };
    emit_status(app, "starting", generation, None);

    let token = format!("{}{}", uuid::Uuid::new_v4(), uuid::Uuid::new_v4());
    let data_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&data_directory).map_err(|error| error.to_string())?;

    #[cfg(debug_assertions)]
    let command = {
        let runtime_project = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../services/runtime")
            .canonicalize()
            .map_err(|error| error.to_string())?;
        let python_path = runtime_project.join("src");
        app.shell()
            .command("uv")
            .args(["run", "--project"])
            .args([runtime_project
                .to_str()
                .ok_or("Invalid Runtime project path")?])
            .args([
                "--frozen",
                "--extra",
                "mlx-vlm",
                "--extra",
                "mflux",
                "--python",
                "3.12",
                "python",
                "-m",
                "mlx_studio_runtime.entrypoints.http.main",
            ])
            .env("PYTHONPATH", python_path)
            .env("MLX_STUDIO_DATA_DIR", &data_directory)
            .env("MLX_STUDIO_PARENT_PIPE", "1")
            .env("MLX_STUDIO_SESSION_TOKEN", &token)
    };
    #[cfg(not(debug_assertions))]
    let command = app
        .shell()
        .sidecar("mlx-studio-runtime")
        .map_err(|error| format!("Runtime sidecar unavailable: {error}"))?
        .env(
            "MLX_STUDIO_CODING_RESOURCES",
            app.path()
                .resource_dir()
                .map_err(|error| error.to_string())?
                .join("coding-agent"),
        )
        .env("MLX_STUDIO_DATA_DIR", &data_directory)
        .env("MLX_STUDIO_PARENT_PIPE", "1")
        .env("MLX_STUDIO_SESSION_TOKEN", &token);

    let (mut receiver, child) = match command.spawn() {
        Ok(spawned) => spawned,
        Err(error) => {
            let message = format!("Runtime sidecar failed to start: {error}");
            set_failed(app, &process, generation, message.clone());
            return Err(message);
        }
    };
    *process
        .child
        .lock()
        .map_err(|_| "Runtime child lock failed")? = Some(child);

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut stdout_buffer = HandshakeDecoder::default();
        while let Some(event) = receiver.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    consume_handshakes(
                        &mut stdout_buffer,
                        &bytes,
                        &app_handle,
                        &process,
                        &token,
                        generation,
                    );
                }
                CommandEvent::Stderr(bytes) => {
                    let text = String::from_utf8_lossy(&bytes).trim().to_string();
                    if !text.is_empty() {
                        eprintln!("[runtime] {text}");
                    }
                }
                CommandEvent::Terminated(_) => {
                    clear_child_if_current(&process, generation);
                    set_failed(
                        &app_handle,
                        &process,
                        generation,
                        "Runtime process exited".to_string(),
                    );
                    break;
                }
                CommandEvent::Error(error) => {
                    set_failed(
                        &app_handle,
                        &process,
                        generation,
                        format!("Runtime process error: {error}"),
                    );
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(())
}

fn consume_handshakes(
    decoder: &mut HandshakeDecoder,
    bytes: &[u8],
    app: &AppHandle,
    process: &RuntimeProcess,
    token: &str,
    generation: u64,
) {
    let frames = match decoder.push(bytes) {
        Ok(frames) => frames,
        Err(error) => {
            set_failed(app, process, generation, error.to_string());
            return;
        }
    };
    for frame in frames {
        if process.generation.load(Ordering::SeqCst) != generation {
            continue;
        }
        let connection = RuntimeConnection {
            base_url: format!("http://127.0.0.1:{}", frame.port),
            token: token.to_string(),
            protocol_version: PROTOCOL_VERSION,
            generation,
        };
        if let Ok(mut snapshot) = process.status.lock() {
            if process.generation.load(Ordering::SeqCst) != generation {
                continue;
            }
            snapshot.generation = generation;
            snapshot.connection = Some(connection);
            snapshot.error = None;
        }
        process.ready.notify_waiters();
        emit_status(app, "ready", generation, None);
    }
}

fn set_failed(app: &AppHandle, process: &RuntimeProcess, generation: u64, message: String) {
    if let Ok(mut snapshot) = process.status.lock() {
        if process.generation.load(Ordering::SeqCst) != generation {
            return;
        }
        snapshot.generation = generation;
        snapshot.connection = None;
        snapshot.error = Some(message.clone());
    }
    process.ready.notify_waiters();
    emit_status(app, "failed", generation, Some(message));
}

fn emit_status(app: &AppHandle, status: &str, generation: u64, message: Option<String>) {
    let _ = app.emit(
        "runtime-status",
        RuntimeStatusEvent {
            status: status.to_string(),
            generation,
            message,
        },
    );
}

fn clear_child_if_current(process: &RuntimeProcess, generation: u64) {
    if let Ok(mut child) = process.child.lock() {
        if process.generation.load(Ordering::SeqCst) == generation {
            child.take();
        }
    }
}

pub(crate) fn stop_runtime(process: &RuntimeProcess) -> Result<(), String> {
    let generation = process.generation.fetch_add(1, Ordering::SeqCst) + 1;
    *process
        .status
        .lock()
        .map_err(|_| "Runtime status lock failed")? = RuntimeSnapshot {
        generation,
        ..RuntimeSnapshot::default()
    };
    process.ready.notify_waiters();
    let child = process
        .child
        .lock()
        .map_err(|_| "Runtime child lock failed")?
        .take();
    if let Some(child) = child {
        child.kill().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stale_connections_and_failures_are_not_returned() {
        let process = RuntimeProcess::default();
        process.generation.store(2, Ordering::SeqCst);
        *process.status.lock().unwrap() = RuntimeSnapshot {
            generation: 1,
            error: Some("old failure".into()),
            connection: None,
        };
        assert!(current_runtime_result(&process).unwrap().is_none());
        process.status.lock().unwrap().generation = 2;
        assert!(current_runtime_result(&process).unwrap().unwrap().is_err());
    }
}
