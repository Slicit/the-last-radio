# YouTube relay

For a radio server whose address YouTube blocks ("Sign in to confirm you're
not a bot"). A machine with an ordinary connection (at home, say) runs this
container: it dials a WireGuard tunnel to the server and offers, on the tunnel
only, a proxy that talks to YouTube and nothing else. The radio sends YouTube
links and searches through it (`YOUTUBE_PROXY`); every other site goes direct.

## On the radio server (WireGuard end, public address)

```bash
sudo apt-get install -y wireguard-tools
wg genkey | sudo tee /etc/wireguard/server.key | wg pubkey   # → server public key
wg genkey | tee relay.key | wg pubkey                        # → relay public key (keep relay.key for the relay)
sudo tee /etc/wireguard/wg0.conf <<CONF
[Interface]
Address = 10.66.0.1/24
ListenPort = 51820
PostUp = wg set %i private-key /etc/wireguard/server.key

[Peer]
PublicKey = <relay public key>
AllowedIPs = 10.66.0.2/32
CONF
sudo systemctl enable --now wg-quick@wg0
```

Then in the radio's `.env`: `YOUTUBE_PROXY=http://10.66.0.2:8888`, and `scripts/deploy.sh`.

## On the relay machine

```bash
cat > relay.env <<ENV
WG_PRIVATE_KEY=<contents of relay.key>
WG_SERVER_PUBLIC_KEY=<server public key>
WG_SERVER_ENDPOINT=<server address>:51820
ENV
chmod 600 relay.env
docker compose up -d --build
```

Check from the server: `ping 10.66.0.2`, and
`curl -x http://10.66.0.2:8888 -sI https://www.youtube.com | head -1`
(any other site answers 403 Filtered).

## Without Docker (a small Debian VM or LXC container)

The same relay runs directly on Debian: WireGuard dials out, tinyproxy listens
on the tunnel address only, and both start on boot.

```bash
apt-get install -y wireguard-tools tinyproxy
wg genkey > /etc/wireguard/relay.key && chmod 600 /etc/wireguard/relay.key
wg pubkey < /etc/wireguard/relay.key      # → add as a [Peer] on the server (AllowedIPs = <relay tunnel IP>/32)
```

`/etc/wireguard/wg0.conf`:

```ini
[Interface]
Address = 10.66.0.2/24
PostUp = wg set %i private-key /etc/wireguard/relay.key

[Peer]
PublicKey = <server public key>
Endpoint = <server address>:51820
AllowedIPs = 10.66.0.1/32
PersistentKeepalive = 25
```

Copy `tinyproxy.conf` (set `Listen` to the relay's tunnel IP, `Allow` to the
server's) and `filter` to `/etc/tinyproxy/`, and make tinyproxy wait for the
tunnel with `/etc/systemd/system/tinyproxy.service.d/after-wg.conf`:

```ini
[Unit]
After=wg-quick@wg0.service
Requires=wg-quick@wg0.service
PartOf=wg-quick@wg0.service
```

Then `systemctl daemon-reload && systemctl enable --now wg-quick@wg0 tinyproxy`.
On Proxmox, an unprivileged container works (the host's kernel provides
WireGuard); set it to start on boot (`pct set <id> --onboot 1`).
