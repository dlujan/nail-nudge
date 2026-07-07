use tauri::{
    include_image,
    menu::{Menu, MenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    Emitter, Manager, WindowEvent,
};

struct TrayState {
    status: MenuItem<tauri::Wry>,
    _tray: TrayIcon<tauri::Wry>,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let status = MenuItem::with_id(app, "status", "🟢 Monitoring", false, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show Nail Nudge", true, None::<&str>)?;
            let pause = MenuItem::with_id(app, "pause", "Pause Watching", true, None::<&str>)?;
            let resume = MenuItem::with_id(app, "resume", "Resume Watching", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Hide Window", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&status, &show, &pause, &resume, &hide, &quit])?;

            let tray_icon = include_image!("icons/32x32.png");

            let tray = TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .tooltip("Nail Nudge")
                .build(app)?;

            app.manage(TrayState {
                status: status.clone(),
                _tray: tray,
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "pause" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("pause-watching", ());
                }

                let tray_state = app.state::<TrayState>();
                let _ = tray_state.status.set_text("⏸️ Paused");
            }
            "resume" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("resume-watching", ());
                }

                let tray_state = app.state::<TrayState>();
                let _ = tray_state.status.set_text("🟢 Monitoring");
            }
            "hide" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
