//! Credential-scrubbed launcher for the opt-in local Playwright MCP server.
//!
//! Node and Chromium stay attached to the ACP-owned process group or Windows
//! Job Object so stopping the agent also cleans up the browser process tree.

#[cfg(unix)]
use std::collections::{HashMap, HashSet, VecDeque};
use std::ffi::OsString;
use std::fs;
#[cfg(unix)]
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use clap::Parser;

const PLAYWRIGHT_MCP_PACKAGE: &str = "@playwright/mcp@0.0.82";
// Pinned to the dependency version declared by the reviewed MCP release so
// the downloaded Chromium revision matches the Playwright MCP server.
const PLAYWRIGHT_RUNTIME_PACKAGE: &str = "playwright@1.64.0-alpha-1789764292000";
const PROVISIONING_TIMEOUT: Duration = Duration::from_secs(180);
const INSTALLER_POLL_INTERVAL: Duration = Duration::from_millis(100);
const INSTALLER_TERM_GRACE: Duration = Duration::from_secs(1);
const INSTALLER_KILL_WAIT: Duration = Duration::from_secs(1);
#[cfg(unix)]
const MAX_PROCESS_SNAPSHOT_BYTES: usize = 8 * 1024 * 1024;
#[cfg(unix)]
const MAX_PROCESS_RECORDS: usize = 100_000;

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

    let root = args.data_dir.ok_or_else(|| {
        anyhow::anyhow!(
            "Browser access needs an app-owned cache directory; restart the agent from Buzz"
        )
    })?;
    let dirs = BrowserDataDirs::prepare(root)?;
    let npm_cli = npx_cli_path(&node_path)?;
    if !npm_cli.is_file() {
        bail!(
            "Buzz's managed Node.js runtime is missing npm's npx launcher at {}; repair the managed runtime, then restart the agent",
            npm_cli.display()
        );
    }

    let socket_dir = create_short_socket_dir()?;
    let provisioning_deadline = Instant::now() + PROVISIONING_TIMEOUT;
    let inherited_env: Vec<_> = std::env::vars_os().collect();
    let package_status = prepare_playwright_mcp(
        &node_path,
        &npm_cli,
        &dirs,
        socket_dir.path(),
        inherited_env.clone(),
        provisioning_deadline,
    )?;
    if !package_status.success() {
        bail!(
            "Could not prepare the pinned Playwright MCP package; check network access to the npm registry, then restart the agent to retry"
        );
    }

    let install_status = install_chromium(
        &node_path,
        &npm_cli,
        &dirs,
        socket_dir.path(),
        inherited_env.clone(),
        provisioning_deadline,
    )?;
    if !install_status.success() {
        bail!(
            "Could not install Chromium for Playwright MCP; check network access to the npm registry and Playwright browser downloads, then restart the agent to retry"
        );
    }

    let status = launch_playwright_mcp(
        &node_path,
        &npm_cli,
        &dirs,
        socket_dir.path(),
        args.headless,
        inherited_env,
    )?;
    if !status.success() {
        bail!(
            "Playwright MCP exited with {status}; check network access for the pinned MCP package and Chromium download, then retry the browser tool or restart the agent"
        );
    }
    Ok(())
}

fn prepare_playwright_mcp(
    node_path: &Path,
    npm_cli: &Path,
    dirs: &BrowserDataDirs,
    socket_dir: &Path,
    inherited_env: impl IntoIterator<Item = (OsString, OsString)>,
    deadline: Instant,
) -> Result<ExitStatus> {
    let environment = browser_process_environment(node_path, dirs, socket_dir, inherited_env)?;
    let mut command = Command::new(node_path);
    command
        .arg(npm_cli)
        .args(["--yes", PLAYWRIGHT_MCP_PACKAGE, "--help"])
        .current_dir(&dirs.home)
        .stdin(Stdio::null())
        .stdout(stderr_stdio()?)
        .stderr(Stdio::inherit())
        .env_clear()
        .envs(environment);

    run_provisioning_command(
        command,
        deadline,
        "prepare the pinned Playwright MCP package",
    )
}

fn install_chromium(
    node_path: &Path,
    npm_cli: &Path,
    dirs: &BrowserDataDirs,
    socket_dir: &Path,
    inherited_env: impl IntoIterator<Item = (OsString, OsString)>,
    deadline: Instant,
) -> Result<ExitStatus> {
    let environment = browser_process_environment(node_path, dirs, socket_dir, inherited_env)?;
    let mut command = Command::new(node_path);
    command
        .arg(npm_cli)
        .args(["--yes", PLAYWRIGHT_RUNTIME_PACKAGE, "install", "chromium"])
        .current_dir(&dirs.home)
        .stdin(Stdio::null())
        // stdout is reserved for the MCP JSON-RPC stream during first-run
        // downloads, so route installer output to stderr.
        .stdout(stderr_stdio()?)
        .stderr(Stdio::inherit())
        .env_clear()
        .envs(environment);

    run_provisioning_command(command, deadline, "install the pinned Chromium build")
}

fn stderr_stdio() -> Result<Stdio> {
    #[cfg(unix)]
    {
        use std::os::fd::AsFd;
        Ok(Stdio::from(
            std::io::stderr()
                .as_fd()
                .try_clone_to_owned()
                .context("clone stderr for the Playwright installer")?,
        ))
    }

    #[cfg(windows)]
    {
        use std::os::windows::io::AsHandle;
        Ok(Stdio::from(
            std::io::stderr()
                .as_handle()
                .try_clone_to_owned()
                .context("clone stderr for the Playwright installer")?,
        ))
    }
}

fn npx_cli_path(node_path: &Path) -> Result<PathBuf> {
    let node_dir = node_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("managed Node.js path has no parent directory"))?;
    #[cfg(windows)]
    let relative = Path::new("node_modules/npm/bin/npx-cli.js");
    #[cfg(not(windows))]
    let relative = Path::new("../lib/node_modules/npm/bin/npx-cli.js");
    Ok(node_dir.join(relative))
}

fn create_short_socket_dir() -> Result<tempfile::TempDir> {
    // macOS AF_UNIX sockets have a short path limit. `/tmp` itself is shared,
    // so create an unpredictable, private child rather than reusing a fixed
    // directory name there.
    #[cfg(unix)]
    let parent = Path::new("/tmp");
    #[cfg(not(unix))]
    let parent = std::env::temp_dir();

    let mut builder = tempfile::Builder::new();
    builder.prefix("bzpw-").rand_bytes(16);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        builder.permissions(fs::Permissions::from_mode(0o700));
    }
    let socket_dir = builder
        .tempdir_in(parent)
        .context("create a private short Playwright socket directory")?;

    #[cfg(target_os = "macos")]
    if socket_dir.path().to_string_lossy().len() >= 60 {
        bail!("temporary Playwright socket directory is not short enough on macOS");
    }

    Ok(socket_dir)
}

fn run_provisioning_command(
    mut command: Command,
    deadline: Instant,
    operation: &str,
) -> Result<ExitStatus> {
    if Instant::now() >= deadline {
        bail!("Playwright provisioning deadline expired before {operation}");
    }

    let mut child = command
        .spawn()
        .with_context(|| format!("{operation} through Buzz-managed Node.js"))?;
    loop {
        let observed = match child.try_wait() {
            Ok(observed) => observed,
            Err(wait_error) => {
                let cleanup = terminate_provisioning_child(&mut child);
                if let Err(cleanup_error) = cleanup {
                    return Err(wait_error).with_context(|| {
                        format!("wait for {operation}; process-tree cleanup also failed: {cleanup_error:#}")
                    });
                }
                return Err(wait_error).with_context(|| format!("wait for {operation}"));
            }
        };
        if let Some(status) = observed {
            return Ok(status);
        }

        let now = Instant::now();
        if now >= deadline {
            if let Err(error) = terminate_provisioning_child(&mut child) {
                bail!(
                    "{operation} exceeded the overall Playwright provisioning deadline and its process tree could not be fully stopped: {error:#}"
                );
            }
            bail!("{operation} exceeded the overall Playwright provisioning deadline; check network access and restart the agent to retry");
        }

        thread::sleep(INSTALLER_POLL_INTERVAL.min(deadline.saturating_duration_since(now)));
    }
}

fn terminate_provisioning_child(child: &mut std::process::Child) -> Result<()> {
    // Do not move provisioning into a separate process group: the parent ACP
    // owns this MCP process group (and the Windows Job Object), so detaching
    // would let an installer survive agent shutdown. ACP's existing group
    // killer is too broad for a single timed-out installer; stop only this
    // command's descendants instead.
    let cleanup_error = terminate_install_process_tree(child.id()).err();
    if cleanup_error.is_some() {
        let _ = child.kill();
    }

    if let Err(first_reap_error) = wait_for_provisioning_child(child) {
        let direct_kill = child.kill();
        if let Err(reap_error) = wait_for_provisioning_child(child) {
            return if let Some(cleanup_error) = cleanup_error {
                Err(reap_error).context(format!(
                    "reap installer root after tree cleanup failed: {cleanup_error:#}; first reap failed: {first_reap_error:#}; direct kill: {direct_kill:?}"
                ))
            } else {
                Err(reap_error).context(format!(
                    "reap installer root after process-tree cleanup; first reap failed: {first_reap_error:#}; direct kill: {direct_kill:?}"
                ))
            };
        }
    }

    if let Some(error) = cleanup_error {
        return Err(error).context("reaped the installer root after tree cleanup failed");
    }
    Ok(())
}

fn wait_for_provisioning_child(child: &mut std::process::Child) -> Result<()> {
    let deadline = Instant::now() + INSTALLER_KILL_WAIT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return Ok(()),
            Ok(None) if Instant::now() >= deadline => {
                bail!("installer root did not exit within the bounded reap interval");
            }
            Err(error) => return Err(error).context("wait for installer root"),
            Ok(None) => thread::sleep(INSTALLER_POLL_INTERVAL),
        }
    }
}

#[cfg(unix)]
#[derive(Clone)]
struct ProcessInfo {
    parent: u32,
    identity: String,
    zombie: bool,
}

#[cfg(unix)]
fn terminate_install_process_tree(root_pid: u32) -> Result<()> {
    use nix::errno::Errno;
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;

    let term_deadline = Instant::now() + INSTALLER_TERM_GRACE;
    let kill_deadline = term_deadline + INSTALLER_KILL_WAIT;
    let mut known = HashMap::<u32, (String, usize)>::new();

    loop {
        let snapshot = unix_process_snapshot()?;
        if !snapshot.contains_key(&root_pid) && known.is_empty() {
            bail!("installer root was absent from the bounded process snapshot");
        }
        for (pid, depth) in process_tree(&snapshot, root_pid) {
            if let Some(info) = snapshot.get(&pid) {
                known
                    .entry(pid)
                    .or_insert_with(|| (info.identity.clone(), depth));
            }
        }

        let mut active: Vec<_> = known
            .iter()
            .filter_map(|(pid, (identity, depth))| {
                snapshot.get(pid).and_then(|info| {
                    (!info.zombie && info.identity.as_str() == identity.as_str())
                        .then_some((*pid, *depth))
                })
            })
            .collect();
        if active.is_empty() {
            return Ok(());
        }
        active.sort_by_key(|(_, depth)| std::cmp::Reverse(*depth));

        let signal = if Instant::now() < term_deadline {
            Signal::SIGTERM
        } else {
            Signal::SIGKILL
        };
        for (pid, _) in active {
            let pid = i32::try_from(pid).context("installer process ID exceeds Unix PID range")?;
            match kill(Pid::from_raw(pid), signal) {
                Ok(()) | Err(Errno::ESRCH) => {}
                Err(error) => {
                    return Err(error).context("signal a Playwright installer descendant")
                }
            }
        }

        if Instant::now() >= kill_deadline {
            bail!("installer descendants remained after bounded SIGKILL cleanup");
        }
        thread::sleep(INSTALLER_POLL_INTERVAL);
    }
}

#[cfg(unix)]
fn unix_process_snapshot() -> Result<HashMap<u32, ProcessInfo>> {
    let ps = [Path::new("/bin/ps"), Path::new("/usr/bin/ps")]
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| anyhow::anyhow!("could not locate ps to stop installer descendants"))?;
    let mut command = Command::new(ps);
    command
        .args(["-axo", "pid=,ppid=,stat=,lstart="])
        .env_clear()
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    let mut child = command
        .spawn()
        .context("list local processes to stop installer descendants")?;
    let mut output = Vec::new();
    let read_result = child
        .stdout
        .take()
        .context("read local process list")?
        .take((MAX_PROCESS_SNAPSHOT_BYTES + 1) as u64)
        .read_to_end(&mut output);
    if let Err(error) = read_result {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error).context("read local process list");
    }
    if output.len() > MAX_PROCESS_SNAPSHOT_BYTES {
        let _ = child.kill();
        let _ = child.wait();
        bail!("local process list exceeded its 8 MiB safety bound");
    }
    let status = child.wait().context("wait for local process list")?;
    if !status.success() {
        bail!("ps failed while locating Playwright installer descendants");
    }

    let output = String::from_utf8(output).context("parse local process list as UTF-8")?;
    let mut snapshot = HashMap::new();
    for line in output.lines() {
        let fields: Vec<_> = line.split_whitespace().collect();
        // `lstart` is five fields and remains stable if a child execs another
        // program. Command names and arguments are not captured.
        if fields.len() < 8 {
            continue;
        }
        let (Ok(pid), Ok(parent)) = (fields[0].parse::<u32>(), fields[1].parse::<u32>()) else {
            continue;
        };
        let identity = fields[3..8].join(" ");
        snapshot.insert(
            pid,
            ProcessInfo {
                parent,
                identity,
                zombie: fields[2].starts_with('Z'),
            },
        );
        if snapshot.len() > MAX_PROCESS_RECORDS {
            bail!("local process count exceeded its 100,000 record safety bound");
        }
    }
    Ok(snapshot)
}

#[cfg(unix)]
fn process_tree(snapshot: &HashMap<u32, ProcessInfo>, root_pid: u32) -> Vec<(u32, usize)> {
    if !snapshot.contains_key(&root_pid) {
        return Vec::new();
    }

    let mut children = HashMap::<u32, Vec<u32>>::new();
    for (pid, info) in snapshot {
        children.entry(info.parent).or_default().push(*pid);
    }

    let mut queue = VecDeque::from([(root_pid, 0)]);
    let mut seen = HashSet::from([root_pid]);
    let mut tree = Vec::new();
    while let Some((parent, depth)) = queue.pop_front() {
        tree.push((parent, depth));
        if let Some(descendants) = children.get(&parent) {
            for pid in descendants {
                if seen.insert(*pid) {
                    queue.push_back((*pid, depth + 1));
                }
            }
        }
    }
    tree
}

#[cfg(windows)]
fn terminate_install_process_tree(root_pid: u32) -> Result<()> {
    let system_root = std::env::var_os("SystemRoot")
        .ok_or_else(|| anyhow::anyhow!("Windows SystemRoot is unavailable for taskkill"))?;
    let system32 = PathBuf::from(&system_root).join("System32");
    let taskkill = system32.join("taskkill.exe");
    let mut command = Command::new(taskkill);
    command
        .args(["/PID", &root_pid.to_string(), "/T", "/F"])
        .env_clear()
        .env("SystemRoot", &system_root)
        .env("WINDIR", &system_root)
        .env("PATH", &system32)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = command
        .spawn()
        .context("start taskkill for the Playwright installer process tree")?;
    let deadline = Instant::now() + INSTALLER_KILL_WAIT;
    loop {
        if let Some(status) = child.try_wait().context("wait for taskkill")? {
            if status.success() {
                return Ok(());
            }
            bail!("taskkill could not stop the Playwright installer process tree");
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            bail!("taskkill exceeded the bounded installer cleanup deadline");
        }
        thread::sleep(INSTALLER_POLL_INTERVAL);
    }
}

#[cfg(not(any(unix, windows)))]
fn terminate_install_process_tree(_root_pid: u32) -> Result<()> {
    bail!("bounded installer process-tree cleanup is unsupported on this platform");
}

fn launch_playwright_mcp(
    node_path: &Path,
    npm_cli: &Path,
    dirs: &BrowserDataDirs,
    socket_dir: &Path,
    headless: bool,
    inherited_env: impl IntoIterator<Item = (OsString, OsString)>,
) -> Result<ExitStatus> {
    let environment = browser_process_environment(node_path, dirs, socket_dir, inherited_env)?;
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
        .envs(environment)
        // Provisioning populated this app-owned npm cache under the deadline;
        // MCP startup must not begin another unbounded network resolution.
        .env("npm_config_offline", "true");

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
    socket_dir: &Path,
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
            OsString::from("npm_config_fetch_timeout"),
            OsString::from("30000"),
        ),
        (
            OsString::from("npm_config_fetch_retries"),
            OsString::from("1"),
        ),
        (
            OsString::from("PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT"),
            OsString::from("30000"),
        ),
        (
            OsString::from("PLAYWRIGHT_BROWSERS_PATH"),
            dirs.browser_cache.clone().into_os_string(),
        ),
        (
            OsString::from("PWTEST_SOCKETS_DIR"),
            socket_dir.to_path_buf().into_os_string(),
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
        let system_root_os = system_root.clone().into_os_string();
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
    fn npx_path_matches_the_managed_node_archive_layout() {
        let root = Path::new("managed-node");
        #[cfg(windows)]
        let (node, npx) = (
            root.join("node.exe"),
            root.join("node_modules/npm/bin/npx-cli.js"),
        );
        #[cfg(not(windows))]
        let (node, npx) = (
            root.join("bin/node"),
            root.join("bin/../lib/node_modules/npm/bin/npx-cli.js"),
        );
        assert_eq!(npx_cli_path(&node).unwrap(), npx);
    }

    #[test]
    fn socket_directory_is_private_and_short_on_macos() {
        let socket_dir = create_short_socket_dir().expect("create private socket directory");

        #[cfg(unix)]
        {
            #[cfg(target_os = "macos")]
            assert!(socket_dir.path().to_string_lossy().len() < 60);
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(socket_dir.path())
                .expect("read socket directory permissions")
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o700);
        }
    }

    #[cfg(unix)]
    #[test]
    fn provisioning_timeout_stops_installer_descendants() {
        let fixture = tempfile::tempdir().expect("create process fixture");
        let child_pid_path = fixture.path().join("child-pid");
        let mut command = Command::new("/bin/sh");
        command
            .args([
                "-c",
                "/bin/sleep 30 & echo $! > \"$1\"; wait",
                "provisioning-timeout-fixture",
            ])
            .arg(&child_pid_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        let result = run_provisioning_command(
            command,
            Instant::now() + Duration::from_millis(250),
            "test installer",
        );
        assert!(result.is_err(), "the bounded operation must time out");

        let child_pid: u32 = fs::read_to_string(child_pid_path)
            .expect("read spawned descendant PID")
            .trim()
            .parse()
            .expect("parse spawned descendant PID");
        let snapshot = unix_process_snapshot().expect("read process table after timeout");
        assert!(snapshot
            .get(&child_pid)
            .map_or(true, |process| process.zombie));
    }

    #[test]
    fn browser_environment_does_not_copy_parent_credentials_or_home() {
        let root = std::env::temp_dir().join(format!("buzz-browser-env-{}", uuid::Uuid::new_v4()));
        let dirs = BrowserDataDirs::prepare(root.clone()).expect("prepare test dirs");
        let socket_dir = create_short_socket_dir().expect("create socket directory");
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

        let environment = browser_process_environment(&node, &dirs, socket_dir.path(), inherited)
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
        assert!(environment.iter().any(|(name, value)| {
            name == std::ffi::OsStr::new("PWTEST_SOCKETS_DIR")
                && value == socket_dir.path().as_os_str()
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
        let socket_dir = create_short_socket_dir().expect("create socket directory");
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
            socket_dir.path(),
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
