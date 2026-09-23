use crate::model::PreviewEntry;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tokio::sync::Mutex as AsyncMutex;

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) admin_token_hash: [u8; crate::model::HASH_BYTES],
    pub(crate) data_dir: Arc<PathBuf>,
    pub(crate) public_origin: Arc<str>,
    pub(crate) preview_ancestors: Arc<str>,
    pub(crate) sites_lock: Arc<AsyncMutex<()>>,
    pub(crate) previews: Arc<Mutex<HashMap<String, PreviewEntry>>>,
}
