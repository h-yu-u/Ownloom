use crate::runtime::state::{RuntimeConnection, RuntimeProcess};
use crate::runtime::supervisor::{current_runtime_result, launch_runtime, stop_runtime};
use std::sync::Arc;
use tauri::{AppHandle, State};
#[tauri::command]
pub(crate) async fn runtime_connection(
    state: State<'_, Arc<RuntimeProcess>>,
) -> Result<RuntimeConnection, String> {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(20);
    loop {
        if let Some(result) = current_runtime_result(state.inner().as_ref())? {
            return result;
        }
        let notified = state.ready.notified();
        if let Some(result) = current_runtime_result(state.inner().as_ref())? {
            return result;
        }
        tokio::time::timeout_at(deadline, notified)
            .await
            .map_err(|_| "Runtime startup timed out".to_string())?;
    }
}

#[tauri::command]
pub(crate) fn restart_runtime_process(
    app: AppHandle,
    state: State<'_, Arc<RuntimeProcess>>,
) -> Result<(), String> {
    let _lease = state
        .lifecycle
        .lock()
        .map_err(|_| "Runtime lifecycle lock failed")?;
    if state
        .shutting_down
        .load(std::sync::atomic::Ordering::SeqCst)
    {
        return Err("Application is exiting".into());
    }
    stop_runtime(state.inner().as_ref())?;
    launch_runtime(&app, Arc::clone(state.inner()))
}
