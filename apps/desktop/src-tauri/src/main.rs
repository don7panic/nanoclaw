mod setup;

use setup::{
    setup_cancel, setup_get_state, setup_retry_step, setup_skip_manual_check, setup_start_step,
    SetupStore,
};

fn main() {
    let setup_store = SetupStore::new().expect("Failed to initialize setup store");

    tauri::Builder::default()
        .manage(setup_store)
        .invoke_handler(tauri::generate_handler![
            setup_get_state,
            setup_start_step,
            setup_retry_step,
            setup_skip_manual_check,
            setup_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
