// Windows 更新：下载 NSIS 安装包，再按当前的安装方式运行。
// - NSIS 安装版（程序目录下有 uninstall.exe）：静默升级，只显示进度条；先卸载旧版本，
//   沿用原安装目录、快捷方式和数据，装完自动打开新版本
// - MSI 安装版和便携版：运行安装向导，由用户选择安装目录
//
// 插件自带的 downloadAndInstall 会按当前包类型选择安装包（便携版取到的是 MSI），
// 并以 passive 模式静默装到默认目录（C 盘），也不能修改目录；下载完立即退出进程，
// 前端来不及显示 100%。这里拆成两步：先下载（前端显示到 100%），再启动安装程序。

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

/// 下载完成后告诉前端接下来的安装方式
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedInstaller {
    /// true：静默升级并自动重启；false：运行安装向导
    pub silent: bool,
}

#[tauri::command]
pub async fn download_windows_installer(
    app: AppHandle,
    pending: State<'_, PendingInstaller>,
    on_event: Channel<DownloadEvent>,
) -> Result<DownloadedInstaller, String> {
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

    *pending.0.lock().unwrap() = Some(path);
    Ok(DownloadedInstaller {
        silent: current_install_dir().is_some_and(|dir| is_nsis_install(&dir)),
    })
}

/// 启动安装程序并退出应用。NSIS 安装版静默升级到当前目录并自动重启；
/// 其他情况运行安装向导，默认安装目录为当前程序所在目录，用户可在向导中修改
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

/// 当前程序所在目录
fn current_install_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.to_path_buf()))
}

/// NSIS 安装会在安装目录写入 uninstall.exe；MSI 安装和便携版没有这个文件
fn is_nsis_install(dir: &std::path::Path) -> bool {
    dir.join("uninstall.exe").is_file()
}

/// 安装程序的命令行参数，参数含义见 src-tauri/installer.nsi：
/// - /P /UPDATE /R：passive 模式只显示进度条，先卸载旧版本（保留快捷方式和数据），装完重启应用
/// - /INAPP：运行安装向导，跳过欢迎页和许可协议页
/// - /D=：安装目录。必须是最后一个参数且不能加引号，路径含空格也不加
#[cfg_attr(not(windows), allow(dead_code))]
fn installer_args(install_dir: Option<&str>, silent: bool) -> Vec<String> {
    let mut args: Vec<String> = if silent {
        vec!["/P".into(), "/UPDATE".into(), "/R".into()]
    } else {
        vec!["/INAPP".into()]
    };
    if let Some(dir) = install_dir {
        let dir = dir.strip_prefix(r"\\?\").unwrap_or(dir);
        args.push(format!("/D={dir}"));
    }
    args
}

#[cfg(windows)]
fn spawn_installer(path: &std::path::Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    let dir = current_install_dir();
    let silent = dir.as_deref().is_some_and(is_nsis_install);
    let dir = dir.map(|d| d.to_string_lossy().into_owned());

    let mut command = std::process::Command::new(path);
    // 逐个原样传入：/D= 中的路径不能被加上引号
    for arg in installer_args(dir.as_deref(), silent) {
        command.raw_arg(arg);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silent_update_passes_passive_update_restart_and_dir_last() {
        assert_eq!(
            installer_args(Some(r"D:\Apps\Api Kit"), true),
            vec!["/P", "/UPDATE", "/R", r"/D=D:\Apps\Api Kit"]
        );
    }

    #[test]
    fn wizard_update_skips_intro_pages_and_strips_verbatim_prefix() {
        assert_eq!(
            installer_args(Some(r"\\?\C:\ApiKit"), false),
            vec!["/INAPP", r"/D=C:\ApiKit"]
        );
    }

    #[test]
    fn missing_dir_omits_d_argument() {
        assert_eq!(installer_args(None, true), vec!["/P", "/UPDATE", "/R"]);
    }

    #[test]
    fn nsis_install_is_detected_by_uninstaller() {
        let dir = std::env::temp_dir().join(format!("apikit-updater-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!is_nsis_install(&dir));
        std::fs::write(dir.join("uninstall.exe"), b"").unwrap();
        assert!(is_nsis_install(&dir));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
