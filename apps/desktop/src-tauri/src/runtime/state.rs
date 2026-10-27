use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, AtomicU64},
    Mutex,
};
use tauri_plugin_shell::process::CommandChild;
use tokio::sync::Notify;
pub(crate) const PROTOCOL_VERSION: u32 = 1;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeConnection {
    pub(crate) base_url: String,
    pub(crate) token: String,
    pub(crate) protocol_version: u32,
    pub(crate) generation: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeStatusEvent {
    pub(crate) status: String,
    pub(crate) generation: u64,
    pub(crate) message: Option<String>,
}

#[derive(Default, Clone)]
pub(crate) struct RuntimeSnapshot {
    pub(crate) connection: Option<RuntimeConnection>,
    pub(crate) error: Option<String>,
    pub(crate) generation: u64,
}

pub(crate) struct RuntimeProcess {
    pub(crate) status: Mutex<RuntimeSnapshot>,
    pub(crate) lifecycle: Mutex<()>,
    pub(crate) shutting_down: AtomicBool,
    pub(crate) child: Mutex<Option<CommandChild>>,
    pub(crate) ready: Notify,
    pub(crate) generation: AtomicU64,
}

impl Default for RuntimeProcess {
    fn default() -> Self {
        Self {
            status: Mutex::new(RuntimeSnapshot::default()),
            lifecycle: Mutex::new(()),
            shutting_down: AtomicBool::new(false),
            child: Mutex::new(None),
            ready: Notify::new(),
            generation: AtomicU64::new(0),
        }
    }
}
