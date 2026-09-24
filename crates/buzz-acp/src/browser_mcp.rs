//! Credential-scrubbed launcher for the opt-in local Playwright MCP server.
//!
//! Node and Chromium stay attached to the ACP-owned process group or Windows
//! Job Object so stopping the agent also cleans up the browser process tree.

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};

use anyhow::{bail, Context, Result};
use clap::Parser;

const PLAYWRIGHT_MCP_PACKAGE: &str = "@playwright/mcp@0.0.82";
// Pinned to the dependency version declared by the reviewed MCP release so
// the downloaded Chromium revision matches the Playwright MCP server.
const PLAYWRIGHT_RUNTIME_PACKAGE: &str = "playwright@1.64.0-alpha-1789764292000";

#[derive(Debug, Parser)]
#[command(
    name = "buzz-acp browser-mcp",
    about = "Launch Buzz's isolated, credential-scrubbed Playwright MCP server"
)]
struct BrowserMcpArgs {
    /// Buzz-managed Node executable supplied by the Desktop runtime.
    #[arg(long, env = "BUZZ_ACP_BROWSER_NODE_PATH", hide = true)]
    node_path: Option<PathBuf>,

    /// App-owned cache root for npm, Playwright browsers, and the temporary HOME.
    #[arg(long, env = "BUZZ_ACP_BROWSER_DATA_DIR", hide = true)]
    data_dir: Option<PathBuf>,

    /// Run Chromium headlessly for controlled local checks.
    #[arg(long)]
    headless: bool,
}

struct BrowserDataDirs {
    root: PathBuf,
    home: PathBuf,
    temp: PathBuf,
    npm_cache: PathBuf,
    npm_prefix: PathBuf,
    npm_config: PathBuf,
    npm_global_config: PathBuf,
    browser_cache: PathBuf,
    appdata: PathBuf,
    local_appdata: PathBuf,
}

impl BrowserDataDirs {
    fn prepare(root: PathBuf) -> Result<Self> {
        let dirs = Self {
            home: root.join("home"),
            temp: root.join("tmp"),
            npm_cache: root.join("npm-cache"),
            npm_prefix: root.join("npm-prefix"),
            npm_config: root.join("npmrc"),
            npm_global_config: root.join("global-npmrc"),
            browser_cache: root.join("browsers"),
            appdata: root.join("appdata"),
            local_appdata: root.join("local-appdata"),
            root,
        };

        for directory in [
            &dirs.root,
            &dirs.home,
            &dirs.temp,
            &dirs.npm_cache,
            &dirs.npm_prefix,
            &dirs.browser_cache,
            &dirs.appdata,
            &dirs.local_appdata,
        ] {
            fs::create_dir_all(directory).with_context(|| {
                format!("create browser runtime directory {}", directory.display())
            })?;
        }

        // npm reads user and global config files even for an npx invocation.
        // Keep both paths inside Buzz's cache and empty so ~/.npmrc tokens are
        // never copied into the Playwright process environment or config chain.
        fs::write(&dirs.npm_config, "")
            .with_context(|| format!("reset {}", dirs.npm_config.display()))?;
        fs::write(&dirs.npm_global_config, "")
            .with_context(|| format!("reset {}", dirs.npm_global_config.display()))?;

        Ok(dirs)
    }
}

pub(crate) fn run_cli(args: impl IntoIterator<Item = OsString>) -> Result<()> {
    let args = BrowserMcpArgs::parse_from(args);
    let node_path = args.node_path.ok_or_else(|| {
        anyhow::anyhow!(
            "Browser access needs Buzz's managed Node.js runtime. Install or repair the managed runtime, then restart the agent."
        )
    })?;
    if !node_path.is_file() {
        bail!(
            "Buzz's managed Node.js runtime is missing at {}; install or repair the managed runtime, then restart the agent",
            node_path.display()
        );
    }

    let root = args
        .data_dir
        .unwrap_or_else(|| std::env::temp_dir().join("buzz-playwright-mcp"));
    let dirs = BrowserDataDirs::prepare(root)?;
    let npm_cli = npx_cli_path(&node_path)?;
    if !npm_cli.is_file() {
        bail!(
            "Buzz's managed Node.js runtime is missing npm's npx launcher at {}; repair the managed runtime, then restart the agent",
            npm_cli.display()
        );
    }

    let inherited_env: Vec<_> = std::env::vars_os().collect();
    let install_status = install_chromium(&node_path, &npm_cli, &dirs, inherited_env.clone())?;
    if !install_status.success() {
        bail!(
            "Could not install Chromium for Playwright MCP; check network access to the npm registry and Playwright browser downloads, then restart the agent to retry"
        );
    }

    let status = launch_playwright_mcp(&node_path, &npm_cli, &dirs, args.headless, inherited_env)?;
    if !status.success() {
        bail!(
            "Playwright MCP exited with {status}; check network access for the pinned MCP package and Chromium download, then retry the browser tool or restart the agent"
        );
    }
    Ok(())
}

fn install_chromium(
    node_path: &Path,
    npm_cli: &Path,
    dirs: &BrowserDataDirs,
    inherited_env: impl IntoIterator<Item = (OsString, OsString)>,
) -> Result<ExitStatus> {
    let environment = browser_process_environment(node_path, dirs, inherited_env)?;
    let status = Command::new(node_path)
        .arg(npm_cli)
        .args(["--yes", PLAYWRIGHT_RUNTIME_PACKAGE, "install", "chromium"])
        .current_dir(&dirs.home)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .env_clear()
        .envs(environment)
        .status()
        .context("install Chromium through Buzz-managed Node.js")?;
    Ok(status)
}

fn npx_cli_path(node_path: &Path) -> Result<PathBuf> {
    let node_dir = node_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("managed Node.js path has no parent directory"))?;
    #[cfg(windows)]
    let relative = Path::new("node_modules/npm/bin/npx-cli.js");
    #[cfg(not(windows))]
    let relative = Path::new("lib/node_modules/npm/bin/npx-cli.js");
    Ok(node_dir.join(relative))
}

fn launch_playwright_mcp(
    node_path: &Path,
    npm_cli: &Path,
    dirs: &BrowserDataDirs,
    headless: bool,
    inherited_env: impl IntoIterator<Item = (OsString, OsString)>,
) -> Result<ExitStatus> {
    let environment = browser_process_environment(node_path, dirs, inherited_env)?;
    let mut command = Command::new(node_path);
    command
        .arg(npm_cli)
        .args([
            "--yes",
            PLAYWRIGHT_MCP_PACKAGE,
            "--isolated",
            "--browser=chromium",
            "--no-webmcp",
        ])
        .args(headless.then_some("--headless"))
        .current_dir(&dirs.home)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .env_clear()
        .envs(environment);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
        .status()
        .context("start the pinned Playwright MCP server through Buzz-managed Node.js")
}

fn browser_process_environment(
    node_path: &Path,
    dirs: &BrowserDataDirs,
    _inherited_env: impl IntoIterator<Item = (OsString, OsString)>,
) -> Result<Vec<(OsString, OsString)>> {
    let node_dir = node_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("managed Node.js path has no parent directory"))?;
    #[cfg(windows)]
    let inherited: Vec<(OsString, OsString)> = _inherited_env.into_iter().collect();
    let mut path_entries = vec![node_dir.to_path_buf()];

    #[cfg(unix)]
    path_entries.extend([
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
        PathBuf::from("/usr/sbin"),
        PathBuf::from("/sbin"),
    ]);

    #[cfg(windows)]
    let system_root = inherited
        .iter()
        .find(|(key, _)| key.to_string_lossy().eq_ignore_ascii_case("SystemRoot"))
        .map(|(_, value)| PathBuf::from(value))
        .ok_or_else(|| anyhow::anyhow!("Windows SystemRoot is unavailable to launch Chromium"))?;

    #[cfg(windows)]
    path_entries.push(system_root.join("System32"));

    let path = std::env::join_paths(path_entries)
        .context("construct the restricted Playwright process PATH")?;
    #[allow(unused_mut)]
    let mut environment = vec![
        (OsString::from("PATH"), path),
        (OsString::from("HOME"), dirs.home.clone().into_os_string()),
        (OsString::from("TMPDIR"), dirs.temp.clone().into_os_string()),
        (
            OsString::from("npm_config_cache"),
            dirs.npm_cache.clone().into_os_string(),
        ),
        (
            OsString::from("npm_config_prefix"),
            dirs.npm_prefix.clone().into_os_string(),
        ),
        (
            OsString::from("npm_config_userconfig"),
            dirs.npm_config.clone().into_os_string(),
        ),
        (
            OsString::from("npm_config_globalconfig"),
            dirs.npm_global_config.clone().into_os_string(),
        ),
        (
            OsString::from("npm_config_update_notifier"),
            OsString::from("false"),
        ),
        (OsString::from("npm_config_fund"), OsString::from("false")),
        (OsString::from("npm_config_audit"), OsString::from("false")),
        (
            OsString::from("PLAYWRIGHT_BROWSERS_PATH"),
            dirs.browser_cache.clone().into_os_string(),
        ),
        (
            OsString::from("XDG_CONFIG_HOME"),
            dirs.home.join(".config").into_os_string(),
        ),
        (
            OsString::from("XDG_CACHE_HOME"),
            dirs.home.join(".cache").into_os_string(),
        ),
        (
            OsString::from("XDG_DATA_HOME"),
            dirs.home.join(".local/share").into_os_string(),
        ),
    ];

    #[cfg(windows)]
    {
        let system_root_os = system_root.into_os_string();
        let system_root_string = system_root_os.to_string_lossy().into_owned();
        let system_drive = Path::new(&system_root_string)
            .components()
            .next()
            .map(|component| component.as_os_str().to_os_string())
            .unwrap_or_else(|| OsString::from("C:"));
        environment.extend([
            (OsString::from("SystemRoot"), system_root_os.clone()),
            (OsString::from("WINDIR"), system_root_os),
            (OsString::from("SYSTEMDRIVE"), system_drive),
            (
                OsString::from("ComSpec"),
                system_root.join("System32/cmd.exe").into_os_string(),
            ),
            (
                OsString::from("PATHEXT"),
                OsString::from(".COM;.EXE;.BAT;.CMD"),
            ),
            (
                OsString::from("USERPROFILE"),
                dirs.home.clone().into_os_string(),
            ),
            (
                OsString::from("APPDATA"),
                dirs.appdata.clone().into_os_string(),
            ),
            (
                OsString::from("LOCALAPPDATA"),
                dirs.local_appdata.clone().into_os_string(),
            ),
            (OsString::from("TEMP"), dirs.temp.clone().into_os_string()),
            (OsString::from("TMP"), dirs.temp.clone().into_os_string()),
        ]);
    }

    Ok(environment)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_environment_does_not_copy_parent_credentials_or_home() {
        let root = std::env::temp_dir().join(format!("buzz-browser-env-{}", uuid::Uuid::new_v4()));
        let dirs = BrowserDataDirs::prepare(root.clone()).expect("prepare test dirs");
        let node = if cfg!(windows) {
            root.join("node.exe")
        } else {
            root.join("bin/node")
        };
        let inherited = vec![
            (
                OsString::from("BUZZ_PRIVATE_KEY"),
                OsString::from("sentinel-key"),
            ),
            (
                OsString::from("BUZZ_AUTH_TAG"),
                OsString::from("sentinel-auth"),
            ),
            (
                OsString::from("OPENAI_API_KEY"),
                OsString::from("sentinel-openai"),
            ),
            (
                OsString::from("ANTHROPIC_API_KEY"),
                OsString::from("sentinel-anthropic"),
            ),
            (
                OsString::from("NODE_OPTIONS"),
                OsString::from("--require=secret.js"),
            ),
            (OsString::from("HOME"), OsString::from("/private/user-home")),
            (OsString::from("PATH"), OsString::from("/private/user-bin")),
            #[cfg(windows)]
            (OsString::from("SystemRoot"), OsString::from("C:\\Windows")),
        ];

        let environment = browser_process_environment(&node, &dirs, inherited)
            .expect("build browser environment");
        let names: Vec<String> = environment
            .iter()
            .map(|(name, _)| name.to_string_lossy().to_ascii_lowercase())
            .collect();
        assert!(!names.iter().any(|name| name.starts_with("buzz_")));
        assert!(!names.iter().any(|name| name.contains("api_key")));
        assert!(!names.iter().any(|name| name == "node_options"));
        assert!(!names.iter().any(|name| name == "https_proxy"));
        assert!(environment.iter().any(|(name, value)| {
            name == std::ffi::OsStr::new("HOME") && value == dirs.home.as_os_str()
        }));
        assert!(environment.iter().any(|(name, value)| {
            name == std::ffi::OsStr::new("PATH")
                && !value.to_string_lossy().contains("/private/user-bin")
        }));

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn launched_child_observes_scrubbed_environment() {
        use std::os::unix::fs::PermissionsExt;

        let root =
            std::env::temp_dir().join(format!("buzz-browser-launch-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create fixture directory");
        let dirs = BrowserDataDirs::prepare(root.join("data")).expect("prepare test dirs");
        let node = root.join("fake-node");
        let captured_env = root.join("child-env.txt");
        fs::write(&node, "#!/bin/sh\n/usr/bin/env > \"$1\"\n").expect("write fake Node executable");
        let mut permissions = fs::metadata(&node)
            .expect("read fixture metadata")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&node, permissions).expect("make fixture executable");

        let status = launch_playwright_mcp(
            &node,
            &captured_env,
            &dirs,
            true,
            [
                (
                    OsString::from("BUZZ_PRIVATE_KEY"),
                    OsString::from("sentinel-key"),
                ),
                (
                    OsString::from("BUZZ_AUTH_TAG"),
                    OsString::from("sentinel-auth"),
                ),
                (
                    OsString::from("AWS_SECRET_ACCESS_KEY"),
                    OsString::from("sentinel-aws"),
                ),
                (
                    OsString::from("OPENAI_API_KEY"),
                    OsString::from("sentinel-openai"),
                ),
                (
                    OsString::from("ANTHROPIC_API_KEY"),
                    OsString::from("sentinel-anthropic"),
                ),
                (
                    OsString::from("NODE_OPTIONS"),
                    OsString::from("--require=secret.js"),
                ),
                (OsString::from("HOME"), OsString::from("/private/user-home")),
                (OsString::from("PATH"), OsString::from("/private/user-bin")),
            ],
        )
        .expect("launch fake Node child");
        assert!(status.success());

        let child_env = fs::read_to_string(&captured_env).expect("read child environment");
        for secret in [
            "sentinel-key",
            "sentinel-auth",
            "sentinel-aws",
            "sentinel-openai",
            "sentinel-anthropic",
            "secret.js",
            "/private/user-home",
            "/private/user-bin",
        ] {
            assert!(!child_env.contains(secret), "child inherited {secret}");
        }
        assert!(child_env.contains(&dirs.home.display().to_string()));
        assert!(child_env.contains(&dirs.browser_cache.display().to_string()));

        let _ = fs::remove_dir_all(root);
    }
}
