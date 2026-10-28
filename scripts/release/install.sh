#!/bin/sh
# Install the complete Ownloom desktop app from a verified GitHub Release.
# Keep execution at the end so an interrupted download cannot run half a script.
set -eu

say() { printf 'Ownloom: %s\n' "$*"; }
die() { say "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Install Ownloom for Apple Silicon macOS.

  curl -fsSL https://github.com/h-yu-u/Ownloom/releases/latest/download/install.sh | sh
  sh install.sh [--version vX.Y.Z] [--install-dir /path/to/Applications]

Defaults to the latest release and /Applications, or ~/Applications when
/Applications is not writable. --install-dir must be an existing directory.
Quit Ownloom before installing. Your models and application data are preserved.
EOF
}

valid_tag() {
  case "$1" in ''|*[!v0-9.]*) return 1 ;; esac
  printf '%s\n' "$1" | grep -Eq '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
}

arguments() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --help|-h) usage; exit 0 ;;
      --version)
        [ "$#" -ge 2 ] || die '--version requires vX.Y.Z'
        tag=$2; valid_tag "$tag" || die 'Invalid version; use vX.Y.Z without a suffix'
        shift 2 ;;
      --install-dir)
        [ "$#" -ge 2 ] || die '--install-dir requires an absolute directory'
        install_dir=$2; shift 2
        case "$install_dir" in /*) ;; *) die '--install-dir must be absolute' ;; esac
        while [ "$install_dir" != / ] && [ "${install_dir%/}" != "$install_dir" ]; do install_dir=${install_dir%/}; done
        [ -d "$install_dir" ] && [ ! -L "$install_dir" ] || die '--install-dir must be an existing, non-symlink directory'
        ;;
      *) die "Unknown option: $1 (use --help)" ;;
    esac
  done
}

require_host() {
  [ "$(uname -s)" = Darwin ] || die 'Ownloom requires Apple Silicon macOS'
  case "$(uname -m)" in
    arm64|aarch64) ;;
    x86_64) [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ] || die 'Intel Macs are not supported' ;;
    *) die 'Ownloom requires an Apple Silicon Mac' ;;
  esac
  for tool in curl plutil shasum hdiutil ditto codesign file pgrep awk; do
    command -v "$tool" >/dev/null 2>&1 || die "Missing macOS tool: $tool"
  done
}

ensure_stopped() {
  if pgrep -x ownloom >/dev/null 2>&1; then
    die 'Quit Ownloom before installing, then run this command again'
  else
    [ "$?" -eq 1 ] || die 'Could not check whether Ownloom is running'
  fi
}

cleanup() {
  result=$?
  trap - 0 HUP INT TERM
  set +e
  if [ -n "$stage" ] && [ -d "$stage/previous.app" ] && [ "$installed" -eq 0 ]; then
    if [ ! -e "$target" ] && [ ! -L "$target" ] && mv "$stage/previous.app" "$target"; then
      say 'Restored the previous application' >&2
    else
      say "Previous application retained at $stage/previous.app; restore it before retrying" >&2
      stage=''
      result=1
    fi
  fi
  if [ -n "$stage" ] && ! rm -rf "$stage"; then
    say "Could not remove temporary application files at $stage" >&2
    result=1
  fi
  if [ "$lock_owned" -eq 1 ] && ! rmdir "$lock_dir"; then
    say "Could not remove the installer lock at $lock_dir" >&2
    result=1
  fi
  if [ -n "$mount" ] && ! hdiutil detach "$mount" >/dev/null 2>&1; then
    # A failed attach may leave only an empty directory. Never remove a mounted volume.
    if ! rmdir "$mount" 2>/dev/null; then
      say "Could not detach $mount; temporary files retained at $work" >&2
      work=''
      result=1
    fi
  fi
  if [ -n "$work" ] && ! rm -rf "$work"; then
    say "Could not remove temporary downloads at $work" >&2
    result=1
  fi
  exit "$result"
}

fetch_small() {
  curl --fail --show-error --location --proto '=https' --proto-redir '=https' \
    --retry 2 --connect-timeout 20 --silent --max-time 60 --max-filesize 65536 \
    --output "$2" "$1" || die "Download failed: $1"
}

value() {
  plutil -extract "$1" raw -o - "$2" 2>/dev/null || die "Invalid metadata field: $1"
}

download_release() {
  if [ -z "$tag" ]; then
    fetch_small "$releases/latest/download/release-metadata.json" "$work/latest.json"
    tag=$(value tag "$work/latest.json")
    valid_tag "$tag" || die 'Latest release has an invalid version tag'
  fi
  base="$releases/download/$tag"
  say "Downloading $tag for Apple Silicon"
  fetch_small "$base/SHA256SUMS" "$work/SHA256SUMS"
  fetch_small "$base/release-metadata.json" "$work/release-metadata.json"
  curl --fail --show-error --location --proto '=https' --proto-redir '=https' \
    --retry 2 --connect-timeout 20 --progress-bar --max-time 1800 \
    --output "$work/$asset" "$base/$asset" || die 'Application download failed'
}

verify_downloads() {
  # Only check downloaded targets: install.sh may have arrived through a pipe.
  awk '
    NF != 2 || length($1) != 64 || $1 !~ /^[0-9a-f]+$/ { bad=1; exit }
    $2 != "ownloom-darwin-arm64.dmg" && $2 != "release-metadata.json" && $2 != "install.sh" { bad=1; exit }
    seen[$2]++ { bad=1; exit }
    $2 != "install.sh" { print $1 "  " $2 }
    END {
      if (bad || seen["ownloom-darwin-arm64.dmg"] != 1 || seen["release-metadata.json"] != 1) exit 1
    }
  ' "$work/SHA256SUMS" > "$work/downloads.sha256" || die 'Invalid or incomplete SHA256SUMS'
  (cd "$work" && shasum -a 256 -c downloads.sha256) || die 'Download checksum verification failed'
  metadata="$work/release-metadata.json"
  version=${tag#v}
  [ "$(value tag "$metadata")" = "$tag" ] || die 'Release tag does not match metadata'
  [ "$(value version "$metadata")" = "$version" ] || die 'Release version does not match metadata'
  [ "$(value platform "$metadata")" = macOS ] || die 'Release is not for macOS'
  [ "$(value architecture "$metadata")" = aarch64 ] || die 'Release is not for Apple Silicon'
  expected=$(awk '$2 == "ownloom-darwin-arm64.dmg" { print $1 }' "$work/downloads.sha256")
  [ "$(value dmgSha256 "$metadata")" = "$expected" ] || die 'DMG checksum does not match metadata'
  signing=$(value signing "$metadata")
  notarized=$(value notarized "$metadata")
  case "$notarized" in true|false) ;; *) die 'Release notarization status is invalid' ;; esac
}

verify_app() {
  app=$1
  for path in "$app" "$app/Contents" "$app/Contents/MacOS"; do
    [ -d "$path" ] && [ ! -L "$path" ] || die 'Application has an invalid directory layout'
  done
  plist="$app/Contents/Info.plist"
  executable="$app/Contents/MacOS/ownloom"
  [ -f "$plist" ] && [ ! -L "$plist" ] || die 'Application metadata is missing or a symlink'
  [ -f "$executable" ] && [ -x "$executable" ] && [ ! -L "$executable" ] || die 'Application executable is invalid'
  [ "$(value CFBundleIdentifier "$plist")" = local.mlxstudio.app ] || die 'Application identity does not match Ownloom'
  [ "$(value CFBundleExecutable "$plist")" = ownloom ] || die 'Application executable does not match Ownloom'
  [ "$(value CFBundleShortVersionString "$plist")" = "$version" ] || die 'Application version does not match the release'
  case "$(file -b "$executable")" in *Mach-O*arm64*) ;; *) die 'Application executable is not ARM64 Mach-O' ;; esac
  codesign --verify --deep --strict "$app" || die 'Application signature integrity check failed'
}

select_destination() {
  if [ -z "$install_dir" ]; then
    if [ -d /Applications ] && [ ! -L /Applications ] && [ -w /Applications ]; then
      install_dir=/Applications
    else
      [ -n "${HOME:-}" ] || die 'HOME is not set; use --install-dir'
      case "$HOME" in /*) ;; *) die 'HOME must be absolute; use --install-dir' ;; esac
      install_dir="$HOME/Applications"
      [ ! -L "$install_dir" ] || die '~/Applications must not be a symlink'
    fi
  fi
  case "$install_dir" in *'
'*) die 'Installation directory must not contain a newline' ;; esac
  if [ ! -d "$install_dir" ]; then mkdir "$install_dir" || die 'Could not create ~/Applications'; fi
  [ ! -L "$install_dir" ] && [ -d "$install_dir" ] && [ -w "$install_dir" ] || die "Installation directory is not writable: $install_dir"
  install_dir=$(cd "$install_dir" && pwd -P) || die 'Could not resolve the installation directory'
  target="$install_dir/Ownloom.app"
  lock_dir="$install_dir/.ownloom-install.lock"
  mkdir "$lock_dir" 2>/dev/null || die "Another installer may be active; check $lock_dir before retrying"
  lock_owned=1
  verify_existing_app
}

verify_existing_app() {
  [ ! -L "$target" ] || die 'Existing Ownloom.app must not be a symlink'
  if [ -e "$target" ]; then
    [ -d "$target" ] || die 'Existing Ownloom.app is not an application directory'
    [ "$(value CFBundleIdentifier "$target/Contents/Info.plist")" = local.mlxstudio.app ] || die 'Refusing to replace an unrelated application'
    [ "$(value CFBundleExecutable "$target/Contents/Info.plist")" = ownloom ] || die 'Refusing to replace an unrelated executable'
  fi
}

install_app() {
  mount="$work/mount"
  mkdir "$mount"
  hdiutil attach "$work/$asset" -readonly -nobrowse -mountpoint "$mount" >/dev/null || die 'Could not mount the DMG'
  verify_app "$mount/Ownloom.app"
  select_destination
  stage=$(mktemp -d "$install_dir/.ownloom-install.XXXXXX") || die 'Could not prepare the new application'
  ditto "$mount/Ownloom.app" "$stage/Ownloom.app" || die 'Could not copy the application'
  verify_app "$stage/Ownloom.app"
  hdiutil detach "$mount" >/dev/null || die 'Could not detach the DMG'
  mount=''
  ensure_stopped
  verify_existing_app
  if [ -e "$target" ]; then
    mv "$target" "$stage/previous.app" || die 'Could not preserve the previous application'
  fi
  mv "$stage/Ownloom.app" "$target" || die 'Could not install the new application'
  installed=1
  say "Installed $version at $target"
  say 'Open Ownloom from your Applications folder, then download or import a model in Models.'
  if [ "$signing" = ad-hoc ] || [ "$notarized" != true ]; then
    say 'This release is not Apple notarized. macOS may require approval in System Settings > Privacy & Security.'
  fi
}

main() {
  tag=''; install_dir=''; work=''; stage=''; mount=''; target=''; lock_dir=''
  installed=0; lock_owned=0
  releases=https://github.com/h-yu-u/Ownloom/releases
  asset=ownloom-darwin-arm64.dmg
  arguments "$@"
  require_host
  ensure_stopped
  umask 077
  trap cleanup 0
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  work=$(mktemp -d "${TMPDIR:-/tmp}/ownloom-install.XXXXXX") || die 'Could not create temporary files'
  download_release
  verify_downloads
  install_app
}

main "$@"
