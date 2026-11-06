# Connecting to a TCP server inside the sandbox

Not with the current configuration. In `oc.sh`, these options control opposite
directions:

```bash
--tcp-ports none --udp-ports none   # outside -> sandbox
--tcp-ns auto --udp-ns auto         # sandbox -> host loopback
```

`--tcp-ports none` disables pasta's host-to-sandbox port forwarding, so nothing
inside the sandbox is reachable from outside.

## To enable it

Change the forwarding options, for example:

```bash
--tcp-ports 28081 --udp-ports none \
--tcp-ns auto --udp-ns auto \
```

This maps host TCP port `28081` to sandbox TCP port `28081`. The host can then
connect with:

```bash
curl http://127.0.0.1:28081/
```

To map different ports:

```bash
--tcp-ports 28081:8080
```

means host port `28081` → sandbox port `8080`.

## Server bind address matters

- If the sandbox server listens on `0.0.0.0:28081` or the sandbox's
  pasta-assigned address, the forwarding above works.
- If it listens only on `127.0.0.1:28081`, add pasta's `--host-lo-to-ns-lo`
  option:

```bash
--tcp-ports 28081 --host-lo-to-ns-lo --udp-ports none \
```

Then a connection to host `127.0.0.1:28081` is delivered to loopback inside the
sandbox.

## Firewall interaction

The nftables allowlist does not need an inbound exception for replies: the
output chain already accepts `ct state established,related`, so responses from
the sandbox server are allowed. New outbound connections made by the server are
still restricted by the allowlist.

## Exposure

- `--tcp-ports 28081` exposes the port on all host interfaces, so other machines
  may reach it depending on the host firewall.
- `--tcp-ports 127.0.0.1/28081` limits it to the host's loopback only.

Verified with the current firewall enabled: a raw TCP server listening on
`0.0.0.0:28081` inside the sandbox was reachable from the host via both
`127.0.0.1:28081` and the host's LAN address.
