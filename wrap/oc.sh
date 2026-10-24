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
# Network isolation: --unshare-net below gives the sandbox its own network
# namespace.  The only interface in it is loopback, which bwrap brings up
# itself, so 127.0.0.1/::1 work and nothing outside the namespace is
# reachable (no routes and no other links exist at all).  This needs no root:
# it rides on the unprivileged user namespace bwrap already creates.
#
# Note that this is a private loopback, not the host's.  A server listening
# on 127.0.0.1 inside the sandbox is invisible to the host, and host-local
# services (a model server, a proxy) are invisible to the sandbox.
#
# The seccomp filter built by make_bpf.py is orthogonal: it filters syscalls,
# not packets.
#

set -euo pipefail

here=$(cd -- "$(dirname -- "$0")" && pwd)
bpf="$here/keyctl.bpf"
if [[ ! -r $bpf ]]; then
    printf 'missing %s - run %s\n' "$bpf" "$here/make_bpf.py" >&2
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
for dir in /usr /etc/ssl /etc/pki /etc/alternatives; do
    [[ -d $dir ]] && system_binds+=( --ro-bind "$dir" "$dir" )
done

# Use this to experiment with the sandboxed process, e.g. `exe=(bash)`.
#
# Use this to start opencode.
#
exe=( opencode --standalone )
#exe=( bash )

exec bwrap \
    --proc /proc \
    --dev /dev \
    --tmpfs /tmp \
    --chmod 1777 /tmp \
    --unshare-pid \
    --unshare-uts \
    --unshare-ipc \
    --unshare-cgroup \
    --hostname sandbox \
    --new-session \
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
    --seccomp 11 \
    "${exe[@]}" "$@" \
    11< "$bpf"

# --new-session
# --unshare-net

