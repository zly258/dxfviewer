// DXF Viewer 桌面客户端入口。
//
// 前端（dxfviewer-example/dist）通过 WebView2 加载，图纸的打开/解析/渲染
// 全部在前端完成，无需原生命令；后续如需文件关联等原生能力再扩展。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
