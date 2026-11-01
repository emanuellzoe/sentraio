use near_sdk::env;
use near_sdk::serde_json::{json, Value};

/// NEP-297 event log, readable by indexers and the Sentineli dashboard.
pub fn emit(event: &str, data: Value) {
    let payload = json!({
        "standard": "sentineli",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}
