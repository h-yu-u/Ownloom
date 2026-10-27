use tauri_plugin_shell::ShellExt;

fn web_url(value: &str) -> Result<tauri::Url, String> {
    if value.len() > 8192 || value.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("EXTERNAL_URL_INVALID".into());
    }
    let url = tauri::Url::parse(value).map_err(|_| "EXTERNAL_URL_INVALID")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("EXTERNAL_URL_INVALID".into());
    }
    Ok(url)
}

/// Reuse the installed shell plugin, with a narrow web-only command instead of shell access.
#[tauri::command]
#[allow(deprecated)] // Shell::open is available in the existing dependency; no new opener plugin.
pub async fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let url = web_url(&url)?.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        app.shell()
            .open(url, None)
            .map_err(|_| "EXTERNAL_BROWSER_UNAVAILABLE".into())
    })
    .await
    .map_err(|_| "EXTERNAL_BROWSER_UNAVAILABLE")?
}

#[cfg(test)]
mod tests {
    use super::web_url;

    #[test]
    fn accepts_only_web_urls_without_embedded_credentials() {
        for value in [
            "https://github.com/trending?since=daily#top",
            "http://example.com/article",
            "https://example.com/中文?q=hello%20world",
        ] {
            assert!(web_url(value).is_ok(), "{value}");
        }
        for value in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "data:text/html,hello",
            "mailto:someone@example.com",
            "https://user:secret@example.com",
            "https://example.com\n/next",
            "https://example.com/with space",
            "--args",
            "/tmp/command",
            "https://",
            "tauri://localhost",
        ] {
            assert!(web_url(value).is_err(), "{value}");
        }
        assert!(web_url(&format!("https://example.com/{}", "a".repeat(8192))).is_err());
    }
}
