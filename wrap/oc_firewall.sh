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
#
# Add nftables for the outbound allowlist (Fedora/RHEL):
#   sudo dnf install nftables
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
# pasta creates a tap device and configures it with the host's addresses and
# routes, so the sandbox has outbound IPv4 connectivity.  An nftables allowlist
# installed inside that network namespace restricts outbound traffic to the
# configured hostnames and ports (https://example.com by default).
#
# Local traffic still uses pasta's socket-splicing bypass: connections the
# sandbox makes to 127.0.0.1 are delivered to services bound to the host's
# 127.0.0.1.  --tcp-ns auto/--udp-ns auto enable sandbox -> host forwarding
# for ports bound on the host loopback; --tcp-ports none and --udp-ports none
# keep the host from reaching into the sandbox.
#
# --ipv4-only limits pasta to IPv4.  curl/c-ares may resolve a name to an IPv6
# address first; without IPv6 configured that attempt fails immediately and
# curl falls back to IPv4.
#
# If you want to allow only the model server port instead of every host-loopback port, replace:
# --tcp-ns auto --udp-ns auto
# with:
# --tcp-ns 8000 --udp-ns none
#
# DNS uses the host's systemd-resolved stub at 127.0.0.53 through the same
# host-loopback forwarding.  On systems without systemd-resolved, point the
# resolv.conf entry below at whatever resolver the host exposes on its
# loopback.
#
# The seccomp filter built by make_bpf.py is orthogonal: it filters syscalls,
# not packets.  pasta runs outside bwrap, so the filter does not apply to it.
# The nftables rules live in pasta's network namespace and therefore apply to
# bwrap and everything it runs.
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

# Outbound network allowlist.  nftables rules are installed in pasta's network
# namespace before bwrap starts, so only these IPv4 destinations on the listed
# TCP ports are reachable from the sandbox.  Loopback is always allowed so DNS
# and host-local services keep working.  Hostnames are resolved once, when the
# script starts; restart the sandbox if their addresses change.
#
allowed_hosts=( example.com )
allowed_tcp_ports=( 443 )

if ! command -v getent >/dev/null 2>&1; then
    printf 'missing getent - install glibc-common\n' >&2
    exit 1
fi

nft_bin=$(command -v nft || true)
if [[ -z $nft_bin && -x /usr/sbin/nft ]]; then
    nft_bin=/usr/sbin/nft
fi
if [[ -z $nft_bin ]]; then
    printf 'missing nft - install the nftables package\n' >&2
    exit 1
fi

if (( ${#allowed_hosts[@]} == 0 || ${#allowed_tcp_ports[@]} == 0 )); then
    printf 'network allowlist is empty\n' >&2
    exit 1
fi

allowed_ips=()
declare -A seen_ips=()
for host in "${allowed_hosts[@]}"; do
    while read -r ip _; do
        [[ $ip =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || continue
        [[ -n ${seen_ips[$ip]:-} ]] && continue
        seen_ips[$ip]=1
        allowed_ips+=( "$ip" )
    done < <(getent ahostsv4 -- "$host" 2>/dev/null || true)
done

if (( ${#allowed_ips[@]} == 0 )); then
    printf 'could not resolve any IPv4 address for allowlist: %s\n' \
        "${allowed_hosts[*]}" >&2
    exit 1
fi

allowed_ips_csv=${allowed_ips[*]}
allowed_ips_csv=${allowed_ips_csv// /,}
allowed_ports_csv=${allowed_tcp_ports[*]}
allowed_ports_csv=${allowed_ports_csv// /,}

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
# Its tap device provides outbound network access, restricted by the nftables
# allowlist installed above; host-loopback traffic is handled by pasta's local
# socket-splicing bypass.
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
    --ipv4-only \
    --tcp-ports none --udp-ports none \
    --tcp-ns auto --udp-ns auto \
    bash -c '
        set -e
        exec 11<"$1"
        exec 12<<< "nameserver 127.0.0.53"
        exec 13<<< "$(printf "127.0.0.1 localhost\n")"
        exec 14<<< "hosts: files dns"
        "$4" -f - <<EOF
table inet sandbox {
    set allowed_hosts {
        type ipv4_addr
        elements = { $2 }
    }
    set allowed_tcp_ports {
        type inet_service
        elements = { $3 }
    }
    chain output {
        type filter hook output priority 0; policy drop;
        oifname "lo" accept
        ct state established,related accept
        ip daddr @allowed_hosts tcp dport @allowed_tcp_ports accept
        meta l4proto tcp reject with tcp reset
    }
}
EOF
        shift 4
        exec "$@"
    ' _ "$bpf" "$allowed_ips_csv" "$allowed_ports_csv" "$nft_bin" bwrap \
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
#   curl -vI https://example.com     # should succeed: in the allowlist
#   curl -vI https://example.org     # should fail: not in the allowlist

