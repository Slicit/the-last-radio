#!/bin/sh
# Brings up the tunnel to the radio server, then serves the proxy on it.
set -eu
: "${WG_PRIVATE_KEY:?}" "${WG_SERVER_PUBLIC_KEY:?}" "${WG_SERVER_ENDPOINT:?}"
ADDRESS="${WG_ADDRESS:-10.66.0.2/24}"
SERVER_IP="${WG_SERVER_IP:-10.66.0.1}"

ip link del wg0 2>/dev/null || true
ip link add wg0 type wireguard
key=$(mktemp) && printf '%s' "$WG_PRIVATE_KEY" > "$key"
# Only the server's tunnel address may come through; we dial out and keep the
# path open, so no port needs opening on this side.
wg set wg0 private-key "$key" \
  peer "$WG_SERVER_PUBLIC_KEY" endpoint "$WG_SERVER_ENDPOINT" allowed-ips "$SERVER_IP/32" persistent-keepalive 25
rm -f "$key"
ip address add "$ADDRESS" dev wg0
ip link set wg0 up

sed -i "s/^Listen .*/Listen ${ADDRESS%/*}/; s/^Allow .*/Allow $SERVER_IP/" /etc/tinyproxy/tinyproxy.conf
exec tinyproxy -d -c /etc/tinyproxy/tinyproxy.conf
