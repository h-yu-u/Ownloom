use std::fs::OpenOptions;
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;
use tauri::ipc::{InvokeBody, Request};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const MAX_EXPORT_BYTES: usize = 64 * 1024 * 1024;

fn validate_name(name: &str) -> Result<(), String> {
    let extension = name.rsplit('.').next().unwrap_or_default();
    if name.is_empty()
        || name.len() > 160
        || name.starts_with('.')
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
        || !matches!(extension, "wav" | "png" | "md" | "zip" | "json")
    {
        return Err("EXPORT_FILENAME_INVALID".into());
    }
    Ok(())
}

fn write_export(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("EXPORT_PATH_INVALID")?;
    let temporary = parent.join(format!(".mlx-export-{}.tmp", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&temporary)
        .map_err(|_| "EXPORT_WRITE_FAILED")?;
    let result = (|| {
        file.write_all(contents)?;
        file.sync_all()?;
        std::fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map_err(|_| "EXPORT_WRITE_FAILED".into())
}

/// Only the native save picker supplies the destination; JS cannot submit a path.
#[tauri::command]
pub async fn export_blob(app: tauri::AppHandle, request: Request<'_>) -> Result<bool, String> {
    let filename = request
        .headers()
        .get("x-mlx-export-name")
        .and_then(|value| value.to_str().ok())
        .ok_or("EXPORT_FILENAME_INVALID")?
        .to_owned();
    validate_name(&filename)?;
    let InvokeBody::Raw(contents) = request.body() else {
        return Err("EXPORT_BODY_INVALID".into());
    };
    if contents.is_empty() || contents.len() > MAX_EXPORT_BYTES {
        return Err("EXPORT_SIZE_INVALID".into());
    }
    let contents = contents.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_file_name(filename)
            .blocking_save_file();
        let Some(selected) = selected else {
            return Ok(false);
        };
        let path = selected.into_path().map_err(|_| "EXPORT_PATH_INVALID")?;
        write_export(&path, &contents)?;
        Ok(true)
    })
    .await
    .map_err(|_| "EXPORT_DIALOG_FAILED")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unsafe_suggested_names() {
        for name in [
            "../export.wav",
            "export.sh",
            ".hidden.wav",
            "foo/bar.png",
            "a\0.wav",
        ] {
            assert!(validate_name(name).is_err());
        }
        assert!(validate_name("ownloom-test.wav").is_ok());
    }
    #[test]
    fn replaces_atomically_and_cleans_failed_writes() {
        let root = std::env::temp_dir().join(format!("mlx-export-test-{}", Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let target = root.join("test.wav");
        std::fs::write(&target, b"before").unwrap();
        write_export(&target, b"after").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"after");
        assert!(write_export(&root.join("missing/file.wav"), b"data").is_err());
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }
}
