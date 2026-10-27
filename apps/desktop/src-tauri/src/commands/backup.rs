use crate::runtime::state::{RuntimeConnection, RuntimeProcess};
use std::fs::OpenOptions;
use std::io::{BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::os::unix::fs::OpenOptionsExt;
use std::sync::Arc;
use std::time::Duration;
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const MAX_BACKUP: u64 = 4 * 1024 * 1024 * 1024;

// The fixed local FileResponse has Content-Length. Reject incomplete or unexpected transfers.
fn copy_response(reader: &mut impl Read, output: &mut impl Write) -> Result<(), String> {
    let mut header = Vec::new();
    while !header.ends_with(b"\r\n\r\n") {
        if header.len() >= 65536 {
            return Err("BACKUP_RESPONSE_INVALID".into());
        }
        let mut byte = [0];
        reader
            .read_exact(&mut byte)
            .map_err(|_| "BACKUP_CONNECTION_FAILED")?;
        header.push(byte[0]);
    }
    let header = String::from_utf8(header).map_err(|_| "BACKUP_RESPONSE_INVALID")?;
    let mut lines = header.lines();
    let status = lines.next().and_then(|line| line.split_whitespace().nth(1));
    if status != Some("200") {
        return Err(if status == Some("409") {
            "BACKUP_BUSY"
        } else {
            "BACKUP_EXPORT_FAILED"
        }
        .into());
    }
    let mut length = None;
    for line in lines {
        if let Some((key, value)) = line.split_once(':') {
            if key.eq_ignore_ascii_case("transfer-encoding") {
                return Err("BACKUP_RESPONSE_INVALID".into());
            }
            if key.eq_ignore_ascii_case("content-length") {
                length = value.trim().parse::<u64>().ok();
            }
        }
    }
    let length = length
        .filter(|size| *size > 0 && *size <= MAX_BACKUP)
        .ok_or("BACKUP_SIZE_INVALID")?;
    let copied =
        std::io::copy(&mut reader.take(length + 1), output).map_err(|_| "BACKUP_WRITE_FAILED")?;
    if copied != length {
        return Err("BACKUP_TRANSFER_INCOMPLETE".into());
    }
    Ok(())
}

fn transfer(connection: RuntimeConnection, output: &mut impl Write) -> Result<(), String> {
    let address: SocketAddr = connection
        .base_url
        .strip_prefix("http://")
        .ok_or("BACKUP_CONNECTION_INVALID")?
        .parse()
        .map_err(|_| "BACKUP_CONNECTION_INVALID")?;
    if address.ip() != std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST)
        || connection
            .token
            .bytes()
            .any(|byte| byte <= 32 || byte >= 127)
    {
        return Err("BACKUP_CONNECTION_INVALID".into());
    }
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(10))
        .map_err(|_| "BACKUP_CONNECTION_FAILED")?;
    stream
        .set_read_timeout(Some(Duration::from_secs(1200)))
        .map_err(|_| "BACKUP_CONNECTION_FAILED")?;
    stream
        .set_write_timeout(Some(Duration::from_secs(10)))
        .map_err(|_| "BACKUP_CONNECTION_FAILED")?;
    write!(stream, "POST /internal/v1/storage/backup HTTP/1.0\r\nHost: {address}\r\nAuthorization: Bearer {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", connection.token)
        .map_err(|_| "BACKUP_CONNECTION_FAILED")?;
    copy_response(&mut BufReader::new(stream), output)
}

/// Stream directly from the authenticated Runtime to a native-picker destination, outside JS IPC.
#[tauri::command]
pub(crate) async fn export_backup(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<RuntimeProcess>>,
) -> Result<bool, String> {
    let connection = state
        .status
        .lock()
        .map_err(|_| "BACKUP_CONNECTION_FAILED")?
        .connection
        .clone()
        .ok_or("RUNTIME_NOT_AVAILABLE")?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(selected) = app
            .dialog()
            .file()
            .set_file_name("ownloom-backup.zip")
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = selected.into_path().map_err(|_| "EXPORT_PATH_INVALID")?;
        let parent = path.parent().ok_or("EXPORT_PATH_INVALID")?;
        let temporary = parent.join(format!(".mlx-backup-{}.tmp", Uuid::new_v4()));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary)
            .map_err(|_| "BACKUP_WRITE_FAILED")?;
        let result = transfer(connection, &mut file)
            .and_then(|()| {
                file.sync_all()
                    .map_err(|_| "BACKUP_WRITE_FAILED".to_owned())
            })
            .and_then(|()| {
                std::fs::rename(&temporary, &path).map_err(|_| "BACKUP_WRITE_FAILED".to_owned())
            });
        if result.is_err() {
            let _ = std::fs::remove_file(&temporary);
        }
        result.map(|()| true)
    })
    .await
    .map_err(|_| "EXPORT_DIALOG_FAILED")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backup_copy_requires_exact_success_length() {
        let mut output = Vec::new();
        copy_response(
            &mut &b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nzip"[..],
            &mut output,
        )
        .unwrap();
        assert_eq!(output, b"zip");
        for response in [
            &b"HTTP/1.1 409 Conflict\r\nContent-Length: 3\r\n\r\nerr"[..],
            &b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\npartial"[..],
            &b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n"[..],
        ] {
            assert!(copy_response(&mut &*response, &mut Vec::new()).is_err());
        }
    }
}
