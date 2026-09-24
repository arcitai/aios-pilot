use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex, Weak},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Listener, Manager};
use tokio::sync::{Notify, Semaphore};
use uuid::Uuid;

const MAX_CLIENTS: usize = 4;
const MAX_CALLBACKS: usize = 512;
const MAX_EVENTS: usize = 512;
const MAX_QUEUE_BYTES: usize = 4 * 1024 * 1024;
const IDLE_LIMIT: Duration = Duration::from_secs(90);

#[derive(Default)]
pub(super) struct Sessions {
    clients: Mutex<HashMap<Uuid, Arc<Session>>>,
    channels: Mutex<HashMap<u32, Weak<Session>>>,
}

pub(super) struct Session {
    pub id: Uuid,
    data: Mutex<Data>,
    notify: Notify,
    polling: Semaphore,
    listeners: Mutex<Vec<tauri::EventId>>,
}

struct Data {
    last_seen: Instant,
    events: VecDeque<Value>,
    bytes: usize,
    overflowed: bool,
    channels: Vec<u32>,
    sockets: Vec<u32>,
    closed: bool,
}

impl Sessions {
    pub fn connect(&self) -> Result<Uuid, String> {
        let mut clients = self
            .clients
            .lock()
            .map_err(|_| "Browser session state unavailable")?;
        if clients.len() >= MAX_CLIENTS {
            return Err("Close an unused browser tab before opening another workspace".into());
        }
        let id = Uuid::new_v4();
        clients.insert(
            id,
            Arc::new(Session {
                id,
                notify: Notify::new(),
                polling: Semaphore::new(1),
                listeners: Mutex::new(Vec::new()),
                data: Mutex::new(Data {
                    last_seen: Instant::now(),
                    events: VecDeque::new(),
                    bytes: 0,
                    overflowed: false,
                    channels: Vec::new(),
                    sockets: Vec::new(),
                    closed: false,
                }),
            }),
        );
        Ok(id)
    }

    pub fn get(&self, id: Uuid) -> Result<Arc<Session>, String> {
        let session = self
            .clients
            .lock()
            .map_err(|_| "Browser session state unavailable")?
            .get(&id)
            .cloned()
            .ok_or("Browser session expired. Reload to reconnect.")?;
        session
            .data
            .lock()
            .map_err(|_| "Browser session unavailable")?
            .last_seen = Instant::now();
        Ok(session)
    }

    pub fn disconnect(&self, id: Uuid, app: &AppHandle) {
        let session = self
            .clients
            .lock()
            .ok()
            .and_then(|mut clients| clients.remove(&id));
        if let Some(session) = session {
            let sockets = if let Ok(mut data) = session.data.lock() {
                data.closed = true;
                if let Ok(mut channels) = self.channels.lock() {
                    for id in &data.channels {
                        channels.remove(id);
                    }
                }
                std::mem::take(&mut data.sockets)
            } else {
                Vec::new()
            };
            if let Ok(mut listeners) = session.listeners.lock() {
                for listener in listeners.drain(..) {
                    app.unlisten(listener);
                }
            }
            let manager = app
                .state::<crate::native_websocket::WebSocketManager>()
                .inner()
                .clone();
            tauri::async_runtime::spawn(async move {
                for id in sockets {
                    manager.disconnect(id).await;
                }
            });
            session.notify.notify_waiters();
        }
    }

    pub fn reap(&self, app: &AppHandle) {
        let expired = self
            .clients
            .lock()
            .map(|clients| {
                clients
                    .iter()
                    .filter_map(|(id, session)| {
                        session
                            .data
                            .lock()
                            .ok()
                            .filter(|data| data.last_seen.elapsed() > IDLE_LIMIT)
                            .map(|_| *id)
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for id in expired {
            self.disconnect(id, app);
        }
    }

    pub fn register_channels(&self, session: &Arc<Session>, args: &Value) -> Result<(), String> {
        let mut ids = Vec::new();
        collect_channels(args, &mut ids)?;
        let mut data = session
            .data
            .lock()
            .map_err(|_| "Browser session unavailable")?;
        if data.closed {
            return Err("Browser session closed".into());
        }
        let mut channels = self
            .channels
            .lock()
            .map_err(|_| "Browser callbacks unavailable")?;
        for id in ids {
            if let Some(existing) = channels.get(&id).and_then(Weak::upgrade) {
                if existing.id != session.id {
                    return Err("Browser callback collision. Reload this tab.".into());
                }
                continue;
            }
            if data.channels.len() >= MAX_CALLBACKS {
                return Err("Too many active browser callbacks. Reload this tab.".into());
            }
            data.channels.push(id);
            channels.insert(id, Arc::downgrade(session));
        }
        Ok(())
    }

    pub fn end_channel(&self, callback: u32, index: usize) {
        // Release the registry lock before taking session data: registration and
        // disconnect take these locks in the opposite order.
        let session =
            self.channels.lock().ok().and_then(|mut channels| {
                channels.remove(&callback).and_then(|weak| weak.upgrade())
            });
        if let Some(session) = session {
            session.push(json!({"callback": callback, "payload": {"index": index, "end": true}}));
            if let Ok(mut data) = session.data.lock() {
                data.channels.retain(|id| *id != callback);
            }
        }
    }

    pub fn send_channel(&self, callback: u32, payload: Value) -> bool {
        let session = self
            .channels
            .lock()
            .ok()
            .and_then(|channels| channels.get(&callback).and_then(Weak::upgrade));
        if let Some(session) = session {
            session.push(json!({"callback": callback, "payload": payload}));
            true
        } else {
            false
        }
    }
}

fn collect_channels(value: &Value, output: &mut Vec<u32>) -> Result<(), String> {
    match value {
        Value::String(value) if value.starts_with("__CHANNEL__:") => {
            output.push(
                value[12..]
                    .parse()
                    .map_err(|_| "Invalid browser channel identifier")?,
            );
            if output.len() > MAX_CALLBACKS {
                return Err("Too many browser channels in one request".into());
            }
        }
        Value::Array(values) => {
            for value in values {
                collect_channels(value, output)?;
            }
        }
        Value::Object(values) => {
            for value in values.values() {
                collect_channels(value, output)?;
            }
        }
        _ => {}
    }
    Ok(())
}

impl Session {
    pub fn register_socket(&self, id: u32) -> Result<(), String> {
        let mut data = self
            .data
            .lock()
            .map_err(|_| "Browser session unavailable")?;
        if data.closed || data.sockets.len() >= 64 {
            return Err("Browser session closed or connection limit reached".into());
        }
        data.sockets.push(id);
        Ok(())
    }

    pub fn owns_socket(&self, id: u32) -> bool {
        self.data
            .lock()
            .is_ok_and(|data| !data.closed && data.sockets.contains(&id))
    }

    pub fn forget_socket(&self, id: u32) {
        if let Ok(mut data) = self.data.lock() {
            data.sockets.retain(|socket| *socket != id);
        }
    }

    pub fn take_sockets(&self) -> Vec<u32> {
        self.data
            .lock()
            .map(|mut data| std::mem::take(&mut data.sockets))
            .unwrap_or_default()
    }

    pub fn listen(
        self: &Arc<Self>,
        app: &AppHandle,
        event: &str,
        callback: u32,
    ) -> Result<tauri::EventId, String> {
        if event.is_empty()
            || event.len() > 160
            || !event
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"-/:_".contains(&c))
        {
            return Err("Invalid event name".into());
        }
        let mut listeners = self
            .listeners
            .lock()
            .map_err(|_| "Browser listeners unavailable")?;
        if self
            .data
            .lock()
            .map_err(|_| "Browser session unavailable")?
            .closed
        {
            return Err("Browser session closed".into());
        }
        if listeners.len() >= MAX_CALLBACKS {
            return Err("Too many browser listeners".into());
        }
        let weak = Arc::downgrade(self);
        let name = event.to_owned();
        let listener = app.listen_any(event.to_owned(), move |event| {
            if let Some(session) = weak.upgrade() {
                let payload = serde_json::from_str::<Value>(event.payload()).unwrap_or_else(|_| Value::String(event.payload().to_owned()));
                session.push(json!({"callback": callback, "payload": {"event": name, "id": event.id(), "payload": payload}}));
            }
        });
        listeners.push(listener);
        Ok(listener)
    }

    pub fn unlisten(&self, app: &AppHandle, id: tauri::EventId) -> Result<(), String> {
        let mut listeners = self
            .listeners
            .lock()
            .map_err(|_| "Browser listeners unavailable")?;
        if let Some(index) = listeners.iter().position(|value| *value == id) {
            listeners.swap_remove(index);
            app.unlisten(id);
        }
        Ok(())
    }

    fn push(&self, value: Value) {
        let bytes = value.to_string().len();
        if let Ok(mut data) = self.data.lock() {
            if data.overflowed || data.closed {
                return;
            }
            if data.events.len() >= MAX_EVENTS || data.bytes.saturating_add(bytes) > MAX_QUEUE_BYTES
            {
                data.overflowed = true;
                data.events.clear();
                data.bytes = 0;
            } else {
                data.bytes += bytes;
                data.events.push_back(value);
            }
        }
        self.notify.notify_one();
    }

    pub async fn poll(&self) -> Result<Value, String> {
        let _permit = self
            .polling
            .try_acquire()
            .map_err(|_| "A browser event poll is already active")?;
        let notified = self.notify.notified();
        let has_events = {
            let data = self
                .data
                .lock()
                .map_err(|_| "Browser session unavailable")?;
            !data.events.is_empty() || data.overflowed
        };
        if !has_events {
            let _ = tokio::time::timeout(Duration::from_secs(20), notified).await;
        }
        let mut data = self
            .data
            .lock()
            .map_err(|_| "Browser session unavailable")?;
        let events = data.events.drain(..).collect::<Vec<_>>();
        data.bytes = 0;
        Ok(json!({"events": events, "overflowed": data.overflowed}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn socket_ownership_and_closed_session_fence() {
        let sessions = Sessions::default();
        let first = sessions.get(sessions.connect().unwrap()).unwrap();
        let second = sessions.get(sessions.connect().unwrap()).unwrap();
        first.register_socket(42).unwrap();
        assert!(first.owns_socket(42));
        assert!(!second.owns_socket(42));
        assert_eq!(first.take_sockets(), vec![42]);
        assert!(!first.owns_socket(42));
        first.data.lock().unwrap().closed = true;
        assert!(first.register_socket(43).is_err());
        assert!(sessions
            .register_channels(&first, &json!("__CHANNEL__:8"))
            .is_err());
    }

    #[tokio::test]
    async fn queue_is_bounded_and_reports_loss() {
        let sessions = Sessions::default();
        let id = sessions.connect().unwrap();
        let session = sessions.get(id).unwrap();
        for _ in 0..=MAX_EVENTS {
            session.push(json!({"payload": "test"}));
        }
        let result = session.poll().await.unwrap();
        assert_eq!(result["overflowed"], true);
        assert_eq!(result["events"].as_array().unwrap().len(), 0);
    }
    #[tokio::test]
    async fn channel_completion_is_delivered_and_releases_capacity() {
        let sessions = Sessions::default();
        let session = sessions.get(sessions.connect().unwrap()).unwrap();
        for index in 0..MAX_CALLBACKS + 1 {
            let id = index as u32;
            sessions
                .register_channels(&session, &json!({"channel": format!("__CHANNEL__:{id}")}))
                .unwrap();
            assert!(sessions.send_channel(id, json!({"index":0,"message":"hello"})));
            sessions.end_channel(id, 1);
            assert!(!sessions.send_channel(id, Value::Null));
            let result = session.poll().await.unwrap();
            assert_eq!(
                result["events"][1]["payload"],
                json!({"index":1,"end":true})
            );
        }
    }

    #[tokio::test]
    async fn duplicate_event_polls_are_rejected() {
        let sessions = Sessions::default();
        let session = sessions.get(sessions.connect().unwrap()).unwrap();
        let permit = session.polling.try_acquire().unwrap();
        assert!(session.poll().await.is_err());
        drop(permit);
        session.push(json!({"payload":"ready"}));
        assert!(session.poll().await.is_ok());
    }

    #[test]
    fn callback_ids_cannot_cross_browser_sessions() {
        let sessions = Sessions::default();
        let first = sessions.get(sessions.connect().unwrap()).unwrap();
        let second = sessions.get(sessions.connect().unwrap()).unwrap();
        sessions
            .register_channels(&first, &json!({"progress": "__CHANNEL__:123"}))
            .unwrap();
        assert!(sessions
            .register_channels(&second, &json!({"progress": "__CHANNEL__:123"}))
            .is_err());
    }
}
