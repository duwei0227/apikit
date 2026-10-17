// Windows 更新：下载 NSIS 安装包后以完整安装向导运行，由安装程序选择安装目录。
//
// 插件自带的 downloadAndInstall 会按当前包类型选择安装包（便携版取到的是 MSI），
// 并以 passive 模式静默装到默认目录（C 盘），也不能修改目录；下载完立即退出进程，
// 前端来不及显示 100%。这里拆成两步：先下载（前端显示到 100%），再启动安装向导。

use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_updater::UpdaterExt;

/// 已下载、待运行的安装包路径。只运行这里记录的文件，不接受前端传入路径
#[derive(Default)]
pub struct PendingInstaller(Mutex<Option<PathBuf>>);

/// 与 @tauri-apps/plugin-updater 的 DownloadEvent 结构一致，前端复用同一套进度处理
#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started { content_length: Option<u64> },
    #[serde(rename_all = "camelCase")]
    Progress { chunk_length: usize },
    Finished,
}

#[tauri::command]
pub async fn download_windows_installer(
    app: AppHandle,
    pending: State<'_, PendingInstaller>,
    on_event: Channel<DownloadEvent>,
) -> Result<String, String> {
    // 无论当前是便携版、MSI 还是 NSIS 安装，都下载 NSIS 安装包
    let update = app
        .updater_builder()
        .target("windows-x86_64-nsis")
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No update available".to_string())?;

    let mut started = false;
    let bytes = update
        .download(
            |chunk_length, content_length| {
                if !started {
                    started = true;
                    let _ = on_event.send(DownloadEvent::Started { content_length });
                }
                let _ = on_event.send(DownloadEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(DownloadEvent::Finished);
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    let path = std::env::temp_dir().join(format!("ApiKit_{}_x64-setup.exe", update.version));
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|e| format!("Failed to save installer: {e}"))?;

    *pending.0.lock().unwrap() = Some(path.clone());
    Ok(path.to_string_lossy().into_owned())
}

/// 启动安装向导并退出应用。默认安装目录为当前程序所在目录，用户可在向导中修改；
/// 检测到已安装的旧版本时，向导会提供“安装前卸载旧版本”（默认选中）
#[tauri::command]
pub async fn launch_windows_installer(
    app: AppHandle,
    pending: State<'_, PendingInstaller>,
) -> Result<(), String> {
    let path = pending
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or_else(|| "Installer has not been downloaded".to_string())?;

    spawn_installer(&path)?;
    // 安装后启动的新版本要用同样的端口，退出前先停止服务、释放端口
    stop_local_servers(app.clone()).await;
    app.exit(0);
    Ok(())
}

/// 停止 MCP 和所有 Mock 服务并等待端口释放。更新后重启前调用，
/// 不依赖退出事件，避免新进程启动时端口仍被旧进程占用
#[tauri::command]
pub async fn stop_local_servers(app: AppHandle) {
    crate::mcp::stop_all(&app).await;
    crate::mock::stop_all(&app).await;
}

#[cfg(windows)]
fn spawn_installer(path: &std::path::Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    let mut command = std::process::Command::new(path);
    // 自定义安装脚本（src-tauri/installer.nsi）据此跳过欢迎页和许可协议页
    command.arg("/INAPP");
    if let Some(dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
    {
        // NSIS 的 /D= 必须是最后一个参数且不能加引号，路径含空格也不加
        let dir = dir.to_string_lossy();
        let dir = dir.strip_prefix(r"\\?\").unwrap_or(&dir);
        command.raw_arg(format!("/D={dir}"));
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to start installer: {e}"))
}

#[cfg(not(windows))]
fn spawn_installer(_path: &std::path::Path) -> Result<(), String> {
    Err("Installer is only used on Windows".to_string())
}
