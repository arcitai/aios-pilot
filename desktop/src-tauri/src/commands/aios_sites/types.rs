use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SitesPublisherFiles {
    pub index_html: String,
    pub style_css: String,
    pub app_js: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SitesPublisherConnectionStatus {
    pub connected: bool,
    pub version: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SitesPublisherSiteStatus {
    pub site_id: String,
    pub published: bool,
    pub content_hash: Option<String>,
    pub public_url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SitesPublisherResult {
    pub site_id: String,
    pub content_hash: String,
    pub public_url: String,
    pub already_published: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SitesPublisherPreview {
    pub preview_url: String,
    pub expires_in_seconds: u64,
}
