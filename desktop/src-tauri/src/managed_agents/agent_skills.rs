//! Local specialist skill bundles and their validation boundary.
//!
//! Skills are private definition data. Persona relay events use an explicit
//! projection that intentionally omits this module's fields.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

pub const MAX_AGENT_SKILLS: usize = 12;
pub const MAX_SKILL_MARKDOWN_BYTES: usize = 256 * 1024;
pub const MAX_SKILL_ASSETS: usize = 32;
pub const MAX_SKILL_ASSET_BYTES: usize = 512 * 1024;
pub const MAX_SKILL_ASSETS_TOTAL_BYTES: usize = 2 * 1024 * 1024;
/// Keeps an opted-in snapshot below the existing JSON import size ceiling.
pub const MAX_AGENT_SKILL_BUNDLE_BYTES: usize = 3 * 1024 * 1024;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkill {
    /// The complete, human-reviewable `SKILL.md`, including YAML frontmatter.
    pub skill_md: String,
    /// Bundle-relative text or binary files referenced by `SKILL.md`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub assets: Vec<AgentSkillAsset>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillAsset {
    /// Safe path below the skill directory, using `/` separators.
    pub path: String,
    /// Standard base64 encoding of the original file bytes.
    pub content_base64: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentSkillMetadata {
    pub name: String,
    pub description: String,
}

pub fn parse_agent_skill(skill_md: &str) -> Result<AgentSkillMetadata, String> {
    if skill_md.len() > MAX_SKILL_MARKDOWN_BYTES {
        return Err(format!(
            "SKILL.md exceeds the {} KiB limit",
            MAX_SKILL_MARKDOWN_BYTES / 1024
        ));
    }
    if skill_md.replace("\r\n", "").contains('\r') {
        return Err("SKILL.md contains a carriage return outside a line ending".to_string());
    }
    let visible_text = skill_md.replace("\r\n", "\n");
    crate::managed_agents::validate_visible_text(&visible_text, "Skill instructions", true)?;
    let (frontmatter, body) = buzz_persona_pkg::persona::split_frontmatter(skill_md)
        .map_err(|error| format!("SKILL.md needs valid YAML frontmatter: {error}"))?;
    let metadata: serde_yaml::Value = serde_yaml::from_str(frontmatter)
        .map_err(|error| format!("SKILL.md frontmatter is invalid: {error}"))?;
    let mapping = metadata
        .as_mapping()
        .ok_or_else(|| "SKILL.md frontmatter must be a YAML mapping".to_string())?;
    let value = |key: &str| {
        mapping
            .get(&serde_yaml::Value::String(key.to_string()))
            .and_then(serde_yaml::Value::as_str)
            .map(str::to_string)
    };
    let name = value("name").ok_or_else(|| "SKILL.md needs a string `name`".to_string())?;
    validate_skill_name(&name)?;
    let description =
        value("description").ok_or_else(|| "SKILL.md needs a string `description`".to_string())?;
    if description.trim().is_empty() || description.chars().count() > 280 {
        return Err("Skill description must contain 1–280 characters".to_string());
    }
    crate::managed_agents::validate_visible_text(&description, "Skill description", false)?;
    if body.trim().is_empty() {
        return Err("SKILL.md needs instructions after its frontmatter".to_string());
    }
    Ok(AgentSkillMetadata { name, description })
}

pub fn validate_agent_skills(skills: &[AgentSkill]) -> Result<(), String> {
    if skills.len() > MAX_AGENT_SKILLS {
        return Err(format!(
            "An agent can have at most {MAX_AGENT_SKILLS} selected skills"
        ));
    }
    let mut names = BTreeSet::new();
    let mut total_bytes = 0usize;
    for skill in skills {
        let metadata = parse_agent_skill(&skill.skill_md)?;
        if !names.insert(metadata.name.to_ascii_lowercase()) {
            return Err(format!(
                "Skill `{}` is selected more than once",
                metadata.name
            ));
        }
        total_bytes = total_bytes.saturating_add(skill.skill_md.len());
        total_bytes = total_bytes.saturating_add(validate_skill_assets(&skill.assets)?);
        if total_bytes > MAX_AGENT_SKILL_BUNDLE_BYTES {
            return Err(format!(
                "Selected skills exceed the {} MiB total bundle limit",
                MAX_AGENT_SKILL_BUNDLE_BYTES / (1024 * 1024)
            ));
        }
    }
    Ok(())
}

pub fn agent_skills_fingerprint(skills: &[AgentSkill]) -> Result<String, String> {
    validate_agent_skills(skills)?;
    let mut ordered = skills.iter().collect::<Vec<_>>();
    ordered.sort_by_key(|skill| {
        parse_agent_skill(&skill.skill_md)
            .map(|metadata| metadata.name)
            .unwrap_or_default()
    });
    let mut hasher = Sha256::new();
    hasher.update(b"buzz-agent-skills-v1\0");
    for skill in ordered {
        let metadata = parse_agent_skill(&skill.skill_md)?;
        hasher.update(metadata.name.as_bytes());
        hasher.update([0]);
        hasher.update(skill.skill_md.as_bytes());
        let mut assets = skill.assets.iter().collect::<Vec<_>>();
        assets.sort_by(|left, right| left.path.cmp(&right.path));
        for asset in assets {
            hasher.update(asset.path.as_bytes());
            hasher.update([0]);
            hasher.update(
                BASE64
                    .decode(&asset.content_base64)
                    .map_err(|_| format!("Skill asset `{}` is not valid base64", asset.path))?,
            );
            hasher.update([0]);
        }
    }
    Ok(hex::encode(hasher.finalize()))
}

pub fn validate_skill_name(name: &str) -> Result<(), String> {
    let bytes = name.as_bytes();
    let valid = !bytes.is_empty()
        && bytes.len() <= 64
        && (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_-".contains(byte));
    if !valid {
        return Err(
            "Skill name must start with a lowercase letter or number and use only lowercase letters, numbers, `_`, or `-` (max 64 characters)".to_string(),
        );
    }
    if name == "buzz-cli" {
        return Err("`buzz-cli` is reserved for the bundled Buzz CLI skill".to_string());
    }
    Ok(())
}

pub fn validate_skill_asset_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.len() > 240
        || path.starts_with('/')
        || path.contains('\\')
        || path.contains(':')
        || path.contains('\0')
        || path.eq_ignore_ascii_case("SKILL.md")
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(format!(
            "Skill asset path `{path}` is not a safe relative path"
        ));
    }
    crate::managed_agents::validate_visible_text(path, "Skill asset path", false)?;
    Ok(())
}

fn validate_skill_assets(assets: &[AgentSkillAsset]) -> Result<usize, String> {
    if assets.len() > MAX_SKILL_ASSETS {
        return Err(format!(
            "A skill can contain at most {MAX_SKILL_ASSETS} supporting files"
        ));
    }
    let mut paths = BTreeSet::new();
    let mut total_bytes = 0usize;
    for asset in assets {
        validate_skill_asset_path(&asset.path)?;
        if !paths.insert(asset.path.to_ascii_lowercase()) {
            return Err(format!("Skill asset path `{}` is duplicated", asset.path));
        }
        let bytes = BASE64
            .decode(&asset.content_base64)
            .map_err(|_| format!("Skill asset `{}` is not valid base64", asset.path))?;
        if bytes.len() > MAX_SKILL_ASSET_BYTES {
            return Err(format!("Skill asset `{}` exceeds 512 KiB", asset.path));
        }
        total_bytes = total_bytes.saturating_add(bytes.len());
        if total_bytes > MAX_SKILL_ASSETS_TOTAL_BYTES {
            return Err("Supporting files for one skill exceed 2 MiB".to_string());
        }
    }
    Ok(total_bytes)
}

/// Prepare a private workspace for one agent and stage its selected skills.
///
/// The workspace links to shared Buzz context where the OS supports links,
/// while `.scratch` and `.agents/skills` remain per agent. A runtime-specific
/// discovery directory is linked to (or populated from) the canonical skills
/// directory. This separates staged files; it is not an OS security sandbox.
pub fn prepare_agent_workspace(
    shared_root: &Path,
    pubkey: &str,
    skills: &[AgentSkill],
    runtime_skill_dir: Option<&str>,
) -> Result<PathBuf, String> {
    validate_agent_skills(skills)?;
    if !skills.is_empty() && runtime_skill_dir.is_none() {
        return Err("The selected runtime does not support local Agent Skills".to_string());
    }
    if pubkey.len() != 64 || !pubkey.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Cannot prepare an agent workspace for an invalid public key".to_string());
    }
    ensure_real_directory(shared_root)?;
    let workspaces = shared_root.join("agent-workspaces");
    ensure_real_directory(&workspaces)?;
    set_private_dir_permissions(&workspaces)?;
    let workspace = workspaces.join(pubkey.to_ascii_lowercase());
    ensure_real_directory(&workspace)?;
    set_private_dir_permissions(&workspace)?;

    for name in [
        "AGENTS.md",
        "GUIDES",
        "RESEARCH",
        "PLANS",
        "WORK_LOGS",
        "OUTBOX",
        "REPOS",
    ] {
        let source = shared_root.join(name);
        if fs::symlink_metadata(&source).is_err() {
            continue;
        }
        ensure_shared_entry(&source, &workspace.join(name))?;
    }
    let scratch = workspace.join(".scratch");
    ensure_real_directory(&scratch)?;
    set_private_dir_permissions(&scratch)?;

    let canonical_skills = workspace.join(".agents/skills");
    ensure_real_directory(&workspace.join(".agents"))?;
    set_private_dir_permissions(&workspace.join(".agents"))?;
    if fs::symlink_metadata(&canonical_skills).is_ok() {
        let metadata = fs::symlink_metadata(&canonical_skills)
            .map_err(|error| format!("inspect {}: {error}", canonical_skills.display()))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(format!(
                "Refusing to replace non-directory skill path {}",
                canonical_skills.display()
            ));
        }
        fs::remove_dir_all(&canonical_skills)
            .map_err(|error| format!("replace {}: {error}", canonical_skills.display()))?;
    }
    ensure_real_directory(&canonical_skills)?;
    set_private_dir_permissions(&canonical_skills)?;

    let bundled_cli = shared_root.join(".agents/skills/buzz-cli");
    if !bundled_cli.join("SKILL.md").is_file() {
        return Err(format!(
            "The bundled Buzz CLI skill is missing at {}",
            bundled_cli.display()
        ));
    }
    copy_tree(&bundled_cli, &canonical_skills.join("buzz-cli"))?;
    for skill in skills {
        let metadata = parse_agent_skill(&skill.skill_md)?;
        let target = canonical_skills.join(&metadata.name);
        fs::create_dir(&target)
            .map_err(|error| format!("create skill directory {}: {error}", target.display()))?;
        set_private_dir_permissions(&target)?;
        // Some runtime readers require LF frontmatter even when the imported
        // bundle came from Windows. Preserve the reviewed source in the record.
        write_private_file(
            &target.join("SKILL.md"),
            skill.skill_md.replace("\r\n", "\n").as_bytes(),
        )?;
        for asset in &skill.assets {
            let bytes = BASE64
                .decode(&asset.content_base64)
                .map_err(|_| format!("Skill asset `{}` is not valid base64", asset.path))?;
            let asset_path = target.join(&asset.path);
            if let Some(parent) = asset_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("create {}: {error}", parent.display()))?;
                set_private_dir_permissions(parent)?;
            }
            write_private_file(&asset_path, &bytes)?;
        }
    }

    if let Some(skill_dir) = runtime_skill_dir {
        validate_skill_asset_path(skill_dir)?;
        let runtime_skills = workspace.join(skill_dir);
        let parent = runtime_skills
            .parent()
            .ok_or_else(|| "Runtime skill directory has no parent".to_string())?;
        ensure_real_directory(parent)?;
        set_private_dir_permissions(parent)?;
        ensure_runtime_skill_discovery(&canonical_skills, &runtime_skills, &workspace)?;
    }

    Ok(workspace)
}

fn ensure_real_directory(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => Err(format!(
            "Refusing to use non-directory path {}",
            path.display()
        )),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(path)
                .or_else(|create_error| {
                    if create_error.kind() == std::io::ErrorKind::AlreadyExists {
                        Ok(())
                    } else {
                        Err(create_error)
                    }
                })
                .map_err(|error| format!("create directory {}: {error}", path.display()))?;
            let metadata = fs::symlink_metadata(path)
                .map_err(|error| format!("inspect directory {}: {error}", path.display()))?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(format!(
                    "Refusing to use non-directory path {}",
                    path.display()
                ));
            }
            Ok(())
        }
        Err(error) => Err(format!("inspect directory {}: {error}", path.display())),
    }
}

fn ensure_shared_entry(source: &Path, target: &Path) -> Result<(), String> {
    if fs::symlink_metadata(target).is_ok() {
        // Existing links or fallback copies may contain agent work; preserve them.
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        ensure_real_directory(parent)?;
    }
    if create_path_symlink(source, target).is_ok() {
        return Ok(());
    }
    let copy_source = fs::canonicalize(source)
        .map_err(|error| format!("resolve {}: {error}", source.display()))?;
    copy_tree(&copy_source, target)
}

fn ensure_runtime_skill_discovery(
    canonical: &Path,
    discovery: &Path,
    workspace: &Path,
) -> Result<(), String> {
    // Buzz Agent reads the canonical directory directly; no alias is needed.
    if canonical == discovery {
        return Ok(());
    }
    if fs::symlink_metadata(discovery).is_ok() {
        let metadata = fs::symlink_metadata(discovery)
            .map_err(|error| format!("inspect {}: {error}", discovery.display()))?;
        if metadata.file_type().is_symlink() {
            let linked = fs::canonicalize(discovery)
                .map_err(|error| format!("resolve {}: {error}", discovery.display()))?;
            let expected = fs::canonicalize(canonical)
                .map_err(|error| format!("resolve {}: {error}", canonical.display()))?;
            if linked == expected {
                return Ok(());
            }
            return Err(format!(
                "Runtime skill path {} points outside this agent workspace",
                discovery.display()
            ));
        }
        if !metadata.is_dir() {
            return Err(format!(
                "Runtime skill path {} is not a directory",
                discovery.display()
            ));
        }
        let marker = workspace.join(".buzz-runtime-skills-copy");
        if !marker.is_file() {
            return Err(format!(
                "Runtime skill directory {} already exists and is not managed by Buzz",
                discovery.display()
            ));
        }
        fs::remove_dir_all(discovery)
            .map_err(|error| format!("refresh {}: {error}", discovery.display()))?;
        copy_tree(canonical, discovery)?;
        return Ok(());
    }
    if let Some(parent) = discovery.parent() {
        ensure_real_directory(parent)?;
    }
    if create_path_symlink(canonical, discovery).is_ok() {
        return Ok(());
    }
    copy_tree(canonical, discovery)?;
    write_private_file(
        &workspace.join(".buzz-runtime-skills-copy"),
        b"managed by Buzz\n",
    )
}

fn copy_tree(source: &Path, target: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("inspect {}: {error}", source.display()))?;
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "Refusing to copy symlink source {}",
            source.display()
        ));
    }
    if metadata.is_dir() {
        ensure_real_directory(target)?;
        for entry in
            fs::read_dir(source).map_err(|error| format!("read {}: {error}", source.display()))?
        {
            let entry = entry.map_err(|error| format!("read directory entry: {error}"))?;
            let file_type = entry
                .file_type()
                .map_err(|error| format!("inspect {}: {error}", entry.path().display()))?;
            if file_type.is_symlink() {
                continue;
            }
            copy_tree(&entry.path(), &target.join(entry.file_name()))?;
        }
        set_private_dir_permissions(target)?;
    } else if metadata.is_file() {
        if let Some(parent) = target.parent() {
            ensure_real_directory(parent)?;
        }
        fs::copy(source, target).map_err(|error| {
            format!("copy {} to {}: {error}", source.display(), target.display())
        })?;
        set_private_file_permissions(target)?;
    } else {
        return Err(format!("Unsupported workspace entry {}", source.display()));
    }
    Ok(())
}

fn write_private_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    fs::write(path, bytes).map_err(|error| format!("write {}: {error}", path.display()))?;
    set_private_file_permissions(path)
}

#[cfg(unix)]
fn create_path_symlink(source: &Path, target: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(source, target)
}

#[cfg(windows)]
fn create_path_symlink(source: &Path, target: &Path) -> std::io::Result<()> {
    if source.is_dir() {
        std::os::windows::fs::symlink_dir(source, target)
    } else {
        std::os::windows::fs::symlink_file(source, target)
    }
}

#[cfg(not(any(unix, windows)))]
fn create_path_symlink(_source: &Path, _target: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "symlinks are not supported on this platform",
    ))
}

#[cfg(unix)]
fn set_private_dir_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("protect directory {}: {error}", path.display()))
}

#[cfg(not(unix))]
fn set_private_dir_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("protect file {}: {error}", path.display()))
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn skill(name: &str, body: &str) -> AgentSkill {
        AgentSkill {
            skill_md: format!(
                "---\nname: {name}\ndescription: Instructions for {name}.\n---\n{body}\n"
            ),
            assets: Vec::new(),
        }
    }

    #[test]
    fn validates_skill_frontmatter_names_assets_and_bundle_limit() {
        assert_eq!(
            parse_agent_skill(&skill("company-analyst", "Review evidence.").skill_md)
                .unwrap()
                .name,
            "company-analyst"
        );
        assert!(parse_agent_skill(&skill("Company Analyst", "Review evidence.").skill_md).is_err());
        assert!(validate_skill_asset_path("../outside.txt").is_err());
        assert!(validate_skill_asset_path("folder/SKILL.md").is_ok());

        let asset_bytes = BASE64.encode(vec![0; MAX_SKILL_ASSET_BYTES]);
        let with_assets = |name: &str| {
            let mut value = skill(name, "instructions");
            value.assets = (0..4)
                .map(|index| AgentSkillAsset {
                    path: format!("asset-{index}.bin"),
                    content_base64: asset_bytes.clone(),
                })
                .collect();
            value
        };
        assert!(
            validate_agent_skills(&[with_assets("first-skill"), with_assets("second-skill"),])
                .unwrap_err()
                .contains("total bundle limit")
        );
    }

    #[test]
    fn skill_fingerprint_tracks_content_and_is_order_independent() {
        let mut first = skill("company-analyst", "Review sources.");
        first.assets.push(AgentSkillAsset {
            path: "reference.txt".into(),
            content_base64: BASE64.encode(b"source note"),
        });
        let second = skill("business-planner", "Plan next steps.");
        let forward = agent_skills_fingerprint(&[first.clone(), second.clone()]).unwrap();
        let reverse = agent_skills_fingerprint(&[second.clone(), first.clone()]).unwrap();
        assert_eq!(forward, reverse);

        let mut changed = skill("company-analyst", "Review sources.");
        changed.assets.push(AgentSkillAsset {
            path: "reference.txt".into(),
            content_base64: BASE64.encode(b"changed source note"),
        });
        assert_ne!(
            forward,
            agent_skills_fingerprint(&[changed, second]).unwrap()
        );
    }

    #[test]
    fn child_process_discovers_only_selected_skills_from_agent_workspace() {
        if std::env::var_os("BUZZ_AGENT_SKILL_DISCOVERY_PROBE").is_some() {
            let workspace = std::env::current_dir().unwrap();
            let discovery = workspace.join(".codex/skills");
            assert!(discovery.join("company-analyst/SKILL.md").is_file());
            assert!(discovery.join("buzz-cli/SKILL.md").is_file());
            assert!(!discovery.join("private-unselected/SKILL.md").exists());
            assert!(workspace.join("AGENTS.md").is_file());
            assert!(workspace.join("RESEARCH").is_dir());
            return;
        }

        let temp = tempfile::tempdir().unwrap();
        let shared = temp.path().join("shared");
        fs::create_dir_all(&shared).unwrap();
        fs::write(shared.join("AGENTS.md"), "Shared Buzz guidance.\n").unwrap();
        for name in [
            "GUIDES",
            "RESEARCH",
            "PLANS",
            "WORK_LOGS",
            "OUTBOX",
            "REPOS",
        ] {
            fs::create_dir_all(shared.join(name)).unwrap();
        }
        let bundled_cli = shared.join(".agents/skills/buzz-cli");
        fs::create_dir_all(&bundled_cli).unwrap();
        fs::write(
            bundled_cli.join("SKILL.md"),
            "---\nname: buzz-cli\ndescription: Buzz CLI help.\n---\nUse the CLI help.\n",
        )
        .unwrap();

        let workspace = prepare_agent_workspace(
            &shared,
            &"a".repeat(64),
            &[skill("company-analyst", "Review source evidence.")],
            Some(".codex/skills"),
        )
        .unwrap();
        assert!(!workspace.join(".agents/skills/private-unselected").exists());

        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .arg("child_process_discovers_only_selected_skills_from_agent_workspace")
            .arg("--nocapture")
            .current_dir(&workspace)
            .env("BUZZ_AGENT_SKILL_DISCOVERY_PROBE", "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "synthetic discovery child failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn unsupported_runtime_cannot_stage_selected_skills() {
        let temp = tempfile::tempdir().unwrap();
        let shared = temp.path().join("shared");
        fs::create_dir(&shared).unwrap();
        assert!(prepare_agent_workspace(
            &shared,
            &"b".repeat(64),
            &[skill("company-analyst", "Review source evidence.")],
            None,
        )
        .unwrap_err()
        .contains("does not support"));
    }

    #[test]
    fn bundled_agent_uses_canonical_skills_and_preserves_restart_staging() {
        let runtime = crate::managed_agents::known_acp_runtime("buzz-agent").unwrap();
        assert!(runtime.supports_skills);
        assert_eq!(runtime.skill_dir, Some(".agents/skills"));
        let temp = tempfile::tempdir().unwrap();
        let shared = temp.path().join("shared");
        let cli = shared.join(".agents/skills/buzz-cli");
        fs::create_dir_all(&cli).unwrap();
        fs::write(cli.join("SKILL.md"), "---\nname: buzz-cli\n---\nCLI help").unwrap();
        let mut selected = skill("company-analyst", "Use the selected company context.");
        selected.skill_md = selected.skill_md.replace('\n', "\r\n");
        let pubkey = "a".repeat(64);
        let workspace =
            prepare_agent_workspace(&shared, &pubkey, &[selected], runtime.skill_dir).unwrap();
        let staged =
            fs::read_to_string(workspace.join(".agents/skills/company-analyst/SKILL.md")).unwrap();
        assert!(staged.starts_with("---\n"));
        assert!(!staged.contains('\r'));
        prepare_agent_workspace(&shared, &pubkey, &[], runtime.skill_dir).unwrap();
        assert!(!workspace.join(".agents/skills/company-analyst").exists());
        assert!(workspace.join(".agents/skills/buzz-cli/SKILL.md").is_file());
    }
}
