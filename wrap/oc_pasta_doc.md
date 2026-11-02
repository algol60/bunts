# Running OpenCode in bwrap with pasta networking

## Summary

Use **pasta as the outer process**, not inside bubblewrap:

```text
pasta (creates unprivileged user+network namespace, configures tap)
  └── bwrap (shares that network namespace; keeps filesystem/PID/etc. isolation)
        └── opencode
```

pasta needs no root, setuid binary, or file capabilities. It creates the
namespace using the same unprivileged user-namespace mechanism bwrap already
uses.

`oc.sh` was updated to do this:

- `exec pasta ... bwrap ...`
- `--unshare-net` was replaced with `--share-net`
- DNS files are supplied with `--ro-bind-data`
- `/etc/crypto-policies` is bound read-only for Fedora OpenSSL
- pasta's automatic port forwarding is disabled
- `--no-map-gw` keeps host-loopback services invisible

## Core change

```bash
exec pasta \
    --config-net \
    --dns-forward 169.254.1.1 \
    --no-map-gw \
    --tcp-ports none --udp-ports none \
    --tcp-ns none --udp-ns none \
    bwrap \
    ...
    --share-net \
    ...
    --ro-bind-data 12 /etc/resolv.conf \
    --ro-bind-data 13 /etc/hosts \
    --ro-bind-data 14 /etc/nsswitch.conf \
    --seccomp 11 \
    "${exe[@]}" "$@" \
    11< "$bpf" \
    12<<< 'nameserver 169.254.1.1' \
    13<<< $'127.0.0.1 localhost\n::1 localhost' \
    14<<< 'hosts: files dns'
```

## Why this works

- pasta creates a new user and network namespace and configures a tap
  interface with addresses and routes (`--config-net`).
- bwrap runs inside that namespace. `--share-net` tells bwrap to keep it
  instead of creating another network namespace.
- bwrap still creates its own PID, mount, UTS, IPC, and cgroup namespaces.
- The sandbox still has a private loopback: `127.0.0.1` and `::1` inside the
  sandbox are the sandbox's own, not the host's.
- HTTPS works because it is ordinary TCP/443. The existing `/etc/pki` and
  `/etc/ssl` binds provide the CA bundle. `/etc/crypto-policies` is also
  needed on Fedora because the OpenSSL configuration references it.

## DNS

Do not simply bind the host's `/etc/resolv.conf` if it contains
`127.0.0.53` (systemd-resolved). Inside the sandbox, that address means the
sandbox's own loopback, so DNS resolution fails.

Instead, the sandbox receives a small `resolv.conf`:

```text
nameserver 169.254.1.1
```

pasta's `--dns-forward 169.254.1.1` maps that address to the host's first
configured resolver. This works even when the host uses systemd-resolved.

The sandbox also gets minimal `/etc/hosts` and `/etc/nsswitch.conf` files:

```text
127.0.0.1 localhost
::1 localhost
```

```text
hosts: files dns
```

## Host services and the model server

`oc.sh` keeps `--no-map-gw`, so services bound to the host's `127.0.0.1`
remain invisible to the sandbox.

To allow the sandbox to reach a host-local service such as
`http://127.0.0.1:8000`:

1. Remove `--no-map-gw` from the pasta arguments.
2. Find the default gateway address inside the sandbox with
   `/usr/sbin/ip route`.
3. Set `OPENCODE_MODELS_URL` to `http://<gateway>:8000`, not
   `http://127.0.0.1:8000`.

pasta maps the sandbox's default-gateway address to the host's loopback by
default. `127.0.0.1` inside the sandbox will never refer to the host.

Allowing this exposes every service bound to the host's loopback to the
sandbox, so leave `--no-map-gw` in place unless you need it.

## Install and test

Install the passt package:

```bash
sudo dnf install passt
```

Running pasta itself still needs no root or capabilities.

To test, temporarily change:

```bash
exe=( opencode --standalone )
#exe=( bash )
```

Then run the sandbox and use:

```bash
/usr/sbin/ip addr
/usr/sbin/ip route
getent hosts example.com
curl -vI https://example.com
```

## Why not the alternatives?

### pasta inside bwrap

bwrap's seccomp filter denies `mount`, and pasta needs `/dev/net/tun` to
create the tap. It can be made to work with extra bind mounts and
`--no-pidns`, but it is more fragile and conflicts with the sandbox policy.

### pasta attached to bwrap's PID from outside

bwrap with `--dev` creates two layers of user namespaces. pasta's PID mode
joins the inner user namespace, which does not own the network namespace,
and fails with `Operation not permitted`. Running pasta outside avoids this
problem entirely.

## Security note

pasta runs outside bwrap, so bwrap's filesystem and seccomp restrictions do
not apply to pasta itself. pasta is designed to be a network boundary and
runs unprivileged, but keep the passt package updated. Inside the sandbox,
bwrap's seccomp filter still applies to OpenCode.
