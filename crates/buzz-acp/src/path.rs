//! Native PATH composition for ACP child processes.

use std::{
    ffi::{OsStr, OsString},
    path::Path,
};

/// Put the harness-owned Git wrappers first, packaged sibling binaries second,
/// and the caller's PATH last. `join_paths` keeps the native separator and
/// preserves Windows drive-letter colons as part of their path entries.
pub(crate) fn build_agent_path(
    git_helper_dir: &Path,
    executable: &Path,
    inherited_path: &OsStr,
) -> Result<OsString, std::env::JoinPathsError> {
    let mut paths = vec![git_helper_dir.to_path_buf()];
    if let Some(sidecar_dir) = executable
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        paths.push(sidecar_dir.to_path_buf());
    }
    paths.extend(std::env::split_paths(inherited_path));
    std::env::join_paths(paths)
}

#[cfg(test)]
mod tests {
    use super::build_agent_path;
    use std::path::PathBuf;

    #[test]
    fn git_helpers_and_sidecars_precede_inherited_path() {
        let helpers = PathBuf::from("temporary git helpers");
        let sidecars = PathBuf::from("application bundle/Contents/MacOS");
        let executable = sidecars.join("buzz-acp");
        let inherited_entries = [
            PathBuf::from("runtime tools"),
            PathBuf::from("system tools"),
        ];
        let inherited = std::env::join_paths(inherited_entries).expect("join inherited PATH");

        let path = build_agent_path(&helpers, &executable, &inherited).expect("compose PATH");

        assert_eq!(
            std::env::split_paths(&path).collect::<Vec<_>>(),
            [
                helpers,
                sidecars,
                PathBuf::from("runtime tools"),
                PathBuf::from("system tools"),
            ]
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_drive_letters_stay_inside_native_path_entries() {
        let helpers = PathBuf::from(r"C:\Temp\buzz-acp-git-fixture");
        let sidecars = PathBuf::from(r"C:\Program Files\Buzz\resources");
        let executable = sidecars.join("buzz-acp.exe");
        let inherited_entries = [
            PathBuf::from(r"C:\Windows\System32"),
            PathBuf::from(r"C:\Users\Agent\bin"),
        ];
        let inherited = std::env::join_paths(inherited_entries).expect("join inherited PATH");

        let path = build_agent_path(&helpers, &executable, &inherited).expect("compose PATH");

        assert_eq!(
            std::env::split_paths(&path).collect::<Vec<_>>(),
            [
                helpers,
                sidecars,
                PathBuf::from(r"C:\Windows\System32"),
                PathBuf::from(r"C:\Users\Agent\bin"),
            ]
        );
    }
}
