# Can the sandbox reconfigure its firewall?

No. The sandboxed process cannot modify the nftables allowlist that restricts
its network access.

## Test results from inside the sandbox

```text
id:          uid=1000 gid=1000
CapEff:      0000000000000000
NoNewPrivs:  1

/usr/sbin/nft list ruleset   -> Operation not permitted
/usr/sbin/nft add table ...  -> Operation not permitted
unshare -Ur nft ...          -> Operation not permitted
```

## Why it fails

- The nftables rules live in pasta's network namespace.
- That namespace is owned by the outer pasta user namespace.
- `bwrap` creates a **nested** user namespace and drops to the normal user UID,
  so the sandbox has no `CAP_NET_ADMIN` over pasta's namespace.
- nftables requires `CAP_NET_ADMIN` in the user namespace that owns the network
  namespace.

The sandbox can run this successfully:

```bash
unshare -Urn /usr/sbin/nft list ruleset
```

However, that only creates a **new, empty network namespace**. The sandbox
cannot move the tap interface into it, cannot change the rules on the original
namespace, and the new namespace has no external connectivity.

## Caveat: host loopback

The sandbox is still allowed to reach host loopback services, and
`--tcp-ns auto` exposes all host-loopback ports. If a proxy or SSH service is
listening on the host's loopback, it could act as an egress path.

To restrict host-loopback access to only the model server, change:

```bash
--tcp-ns auto --udp-ns auto
```

to:

```bash
--tcp-ns 8000 --udp-ns none
```
