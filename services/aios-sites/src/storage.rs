use crate::model::{valid_hash, valid_site_id, SitePointer, SiteSnapshot};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    ffi::OsStr,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
use uuid::Uuid;

const MAX_RETAINED_SNAPSHOTS: usize = 2;

pub(crate) fn pointer_path(data_dir: &Path, site_id: &str) -> PathBuf {
    data_dir.join("sites").join(site_id).join("current.json")
}

pub(crate) fn snapshot_path(data_dir: &Path, site_id: &str, content_hash: &str) -> PathBuf {
    data_dir
        .join("sites")
        .join(site_id)
        .join("objects")
        .join(format!("{content_hash}.json"))
}

pub(crate) fn read_pointer(
    data_dir: &Path,
    site_id: &str,
) -> Result<Option<SitePointer>, std::io::Error> {
    if !valid_site_id(site_id) {
        return Ok(None);
    }
    read_json(&pointer_path(data_dir, site_id))
}

pub(crate) fn read_snapshot(
    data_dir: &Path,
    site_id: &str,
    content_hash: &str,
) -> Result<Option<SiteSnapshot>, std::io::Error> {
    if !valid_site_id(site_id) || !valid_hash(content_hash) {
        return Ok(None);
    }
    let Some(snapshot) =
        read_json::<SiteSnapshot>(&snapshot_path(data_dir, site_id, content_hash))?
    else {
        return Ok(None);
    };
    let bytes = serde_json::to_vec(&snapshot).map_err(std::io::Error::other)?;
    if hex::encode(Sha256::digest(bytes)) != content_hash {
        return Ok(None);
    }
    Ok(Some(snapshot))
}

pub(crate) fn read_json<T: for<'de> Deserialize<'de>>(
    path: &Path,
) -> Result<Option<T>, std::io::Error> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(std::io::Error::other),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

pub(crate) fn write_snapshot_if_missing(
    data_dir: &Path,
    site_id: &str,
    content_hash: &str,
    bytes: &[u8],
) -> Result<(), std::io::Error> {
    if !valid_site_id(site_id) || !valid_hash(content_hash) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "invalid snapshot identity",
        ));
    }
    if hex::encode(Sha256::digest(bytes)) != content_hash {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "snapshot bytes do not match content hash",
        ));
    }
    let path = snapshot_path(data_dir, site_id, content_hash);
    match fs::read(&path) {
        Ok(existing) if existing == bytes => Ok(()),
        Ok(_) => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "existing snapshot bytes do not match content hash",
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => write_atomic(&path, bytes),
        Err(error) => Err(error),
    }
}

pub(crate) fn prune_site_snapshots(
    data_dir: &Path,
    site_id: &str,
    keep_hashes: &[&str],
) -> Result<(), std::io::Error> {
    if !valid_site_id(site_id)
        || keep_hashes.len() > MAX_RETAINED_SNAPSHOTS
        || keep_hashes.iter().any(|hash| !valid_hash(hash))
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "invalid snapshot retention request",
        ));
    }
    let objects_dir = data_dir.join("sites").join(site_id).join("objects");
    let entries = match fs::read_dir(objects_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension() != Some(OsStr::new("json")) {
            continue;
        }
        let Some(hash) = path.file_stem().and_then(OsStr::to_str) else {
            continue;
        };
        if valid_hash(hash) && !keep_hashes.iter().any(|keep_hash| *keep_hash == hash) {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}

pub(crate) fn write_pointer(
    data_dir: &Path,
    site_id: &str,
    pointer: &SitePointer,
) -> Result<(), std::io::Error> {
    let bytes = serde_json::to_vec(pointer).map_err(std::io::Error::other)?;
    write_atomic(&pointer_path(data_dir, site_id), &bytes)
}

pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), std::io::Error> {
    let parent = path
        .parent()
        .ok_or_else(|| std::io::Error::other("missing parent directory"))?;
    fs::create_dir_all(parent)?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("state.json");
    let temporary = parent.join(format!(".{file_name}.{}.tmp", Uuid::new_v4().simple()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    if let Err(error) = file.write_all(bytes).and_then(|()| file.sync_all()) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    drop(file);
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if let Ok(directory) = File::open(parent) {
        let _ = directory.sync_all();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{SiteFiles, SiteSnapshot};
    use tempfile::tempdir;

    fn snapshot_bytes() -> Vec<u8> {
        serde_json::to_vec(&SiteSnapshot {
            schema_version: 1,
            site_id: "site_1".to_string(),
            title: "My site".to_string(),
            files: SiteFiles {
                index_html: "<main>Hi</main>".to_string(),
                style_css: "body { color: navy }".to_string(),
                app_js: "document.body.dataset.ready='yes'".to_string(),
            },
        })
        .unwrap()
    }

    #[test]
    fn existing_snapshot_must_match_its_content_hash_bytes() {
        let directory = tempdir().unwrap();
        let bytes = snapshot_bytes();
        let hash = hex::encode(Sha256::digest(&bytes));

        write_snapshot_if_missing(directory.path(), "site_1", &hash, &bytes).unwrap();
        write_snapshot_if_missing(directory.path(), "site_1", &hash, &bytes).unwrap();
        fs::write(snapshot_path(directory.path(), "site_1", &hash), b"corrupt").unwrap();

        let error =
            write_snapshot_if_missing(directory.path(), "site_1", &hash, &bytes).unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
        assert_eq!(
            fs::read(snapshot_path(directory.path(), "site_1", &hash)).unwrap(),
            b"corrupt"
        );
    }

    #[test]
    fn pruning_keeps_only_named_hash_objects_and_ignores_non_objects() {
        let directory = tempdir().unwrap();
        let objects_dir = directory.path().join("sites/site_1/objects");
        fs::create_dir_all(&objects_dir).unwrap();
        let keep = "a".repeat(64);
        let remove = "b".repeat(64);
        fs::write(objects_dir.join(format!("{keep}.json")), b"keep").unwrap();
        fs::write(objects_dir.join(format!("{remove}.json")), b"remove").unwrap();
        fs::write(objects_dir.join("temporary.tmp"), b"ignore").unwrap();

        prune_site_snapshots(directory.path(), "site_1", &[&keep]).unwrap();

        assert!(objects_dir.join(format!("{keep}.json")).exists());
        assert!(!objects_dir.join(format!("{remove}.json")).exists());
        assert!(objects_dir.join("temporary.tmp").exists());
    }
}
