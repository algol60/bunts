#!/usr/bin/env bash
#
# Bubblewrap wrapper around OpenCode.
#
# bwrap uses --seccomp to install a Berkeley Packet Filter program that denies
# a handful of sandbox-escape syscalls (keyctl, ptrace, mount, bpf, ...).
# See make_bpf.py to build the BPF program.
#
# Add Python seccomp bindings (Fedora/RHEL):
#   sudo dnf install libseccomp-python
# Description
# : The libseccomp library provides an easy to use interface to the Linux Kernel's
# : syscall filtering mechanism, seccomp.  The libseccomp API allows an application
# : to specify which syscalls, and optionally which syscall arguments, the
# : application is allowed to execute, all of which are enforced by the Linux
# : Kernel.
#
# See also https://github.com/seccomp/libseccomp/
#
# This script targets Fedora/RHEL: the sandbox uses the usr-merged layout
# (/bin -> usr/bin, /lib -> usr/lib, /lib64 -> usr/lib64) and keeps its CA
# bundle under /etc/pki.
#
# Network: pasta (from the passt package) creates a private user+network
# namespace without root or capabilities, and runs bwrap inside it.  bwrap
# must therefore share that network namespace (--share-net) instead of
# creating another one.
#
# --splice-only gives the sandbox no tap device or route to the outside: pasta
# only splices loopback traffic between the two namespaces.  Connections the
# sandbox makes to 127.0.0.1 are therefore delivered to services bound to the
# host's 127.0.0.1.  --tcp-ns auto/--udp-ns auto enable sandbox -> host
# forwarding for ports bound on the host loopback; --tcp-ports none and
# --udp-ports none keep the host from reaching into the sandbox.
#
# --ipv4-only disables the IPv6 side of that loopback splice.  curl/c-ares may
# resolve "localhost" to ::1 before 127.0.0.1; without an IPv6 splice listener
# that attempt fails immediately and curl falls back to IPv4.
#
# If you want to allow only the model server port instead of every host-loopback port, replace:
# --tcp-ns auto --udp-ns auto
# with:
# --tcp-ns 8000 --udp-ns none
#
# DNS uses the host's systemd-resolved stub at 127.0.0.53 over that same
# loopback splice.  On systems without systemd-resolved, point the resolv.conf
# entry below at whatever resolver the host exposes on its loopback.
#
# The seccomp filter built by make_bpf.py is orthogonal: it filters syscalls,
# not packets.  pasta runs outside bwrap, so the filter does not apply to it.
#

set -euo pipefail

here=$(cd -- "$(dirname -- "$0")" && pwd)
bpf="$here/keyctl.bpf"
if [[ ! -r $bpf ]]; then
    printf 'missing %s - run %s\n' "$bpf" "$here/make_bpf.py" >&2
    exit 1
fi

# pasta ships in the passt package and needs no root or capabilities.
#
if ! command -v pasta >/dev/null 2>&1; then
    printf 'missing pasta - install the passt package\n' >&2
    exit 1
fi

# The read-write user directories we want to see in the sandbox.
# Note: this will require adjustment, depending on whether opencode
# is installed in ~/.local/bin or ~/.bun/bin. Dependencies are in ../install.
#
rw_dirs=(
    "$HOME/tmp"
    "$HOME/Projects"
    "$HOME/.cache/opencode"
    "$HOME/.config/opencode"
    "$HOME/.local/state/opencode"
    "$HOME/.local/share/opencode"
)

# Toolchain directories are read-only so the sandboxed process cannot replace
# the opencode binary it will run next time.
#
ro_dirs=(
    "$HOME/.local/bin"
    "$HOME/.bun"
)

# Identity and shell configuration files from $HOME. ~/.ssh is deliberately
# not bound.
#
ro_files=(
    "$HOME/.gitconfig"
    "$HOME/.bashrc"
    "$HOME/.npmrc"
)

binds=()
for dir in "${rw_dirs[@]}"; do
    mkdir -p -- "$dir"
    binds+=( --bind "$dir" "$dir" )
done
for dir in "${ro_dirs[@]}"; do
    [[ -d $dir ]] && binds+=( --ro-bind "$dir" "$dir" )
done
for file in "${ro_files[@]}"; do
    [[ -e $file ]] && binds+=( --ro-bind "$file" "$file" )
done

# System paths needed by the toolchain and for TLS. Fedora keeps its CA bundle
# under /etc/pki, so bind that as well as /etc/ssl.
#
system_binds=()
for dir in /usr /etc/ssl /etc/pki /etc/alternatives /etc/crypto-policies; do
    [[ -d $dir ]] && system_binds+=( --ro-bind "$dir" "$dir" )
done

# Use this to experiment with the sandboxed process, e.g. `exe=(bash)`.
#
# Use this to start opencode.
#
#exe=( opencode --standalone )
exe=( bash )

# pasta creates the user+network namespace, then runs bwrap in that namespace.
# Only loopback traffic is spliced through; there is no tap, gateway, or route
# to the external network.
#
# pasta closes all inherited file descriptors above stderr before it execs its
# command.  That would also close the descriptors bwrap needs for --seccomp and
# --ro-bind-data, which bwrap reports as a misleading "Bad file descriptor"
# write error.  Run a small shell as pasta's command instead: it reopens the
# descriptors after pasta has closed them, then execs bwrap.
#
# pasta runs its command as uid 0 in a user namespace that maps the host user
# to 0.  Ask bwrap to create a nested user namespace and switch to the host
# uid/gid, so the sandboxed process does not run as root inside the sandbox.
#
exec pasta \
    --config-net \
    --splice-only \
    --ipv4-only \
    --tcp-ports none --udp-ports none \
    --tcp-ns auto --udp-ns auto \
    bash -c '
        set -e
        exec 11<"$1"
        exec 12<<< "nameserver 127.0.0.53"
        exec 13<<< "$(printf "127.0.0.1 localhost\n")"
        exec 14<<< "hosts: files dns"
        shift
        exec "$@"
    ' _ "$bpf" bwrap \
    --proc /proc \
    --dev /dev \
    --tmpfs /tmp \
    --chmod 1777 /tmp \
    --unshare-pid \
    --unshare-uts \
    --unshare-ipc \
    --share-net \
    --unshare-cgroup \
    --hostname sandbox \
    --new-session \
    --unshare-user \
    --uid "$(id -u)" \
    --gid "$(id -g)" \
    --die-with-parent \
    --clearenv \
    --setenv HOME "$HOME" \
    --setenv PATH "/usr/local/bin:/usr/bin:$HOME/.local/bin:$HOME/.bun/bin" \
    --setenv TMPDIR /tmp \
    --setenv TERM "${TERM:-xterm-256color}" \
    --setenv OPENCODE_MODELS_URL 'http://127.0.0.1:8000' \
    --symlink usr/lib /lib \
    --symlink usr/bin /bin \
    --symlink usr/lib64 /lib64 \
    "${system_binds[@]}" \
    "${binds[@]}" \
    --chdir "$HOME/Projects" \
    --ro-bind-data 12 /etc/resolv.conf \
    --ro-bind-data 13 /etc/hosts \
    --ro-bind-data 14 /etc/nsswitch.conf \
    --seccomp 11 \
    "${exe[@]}" "$@"

# To debug, use exe=(bash) and run:
#   /usr/sbin/ip addr
#   /usr/sbin/ip route
#   getent hosts example.com
#   curl -vI http://127.0.0.1:8000   # host loopback service
#   curl -vI https://example.com     # should fail: no external route

