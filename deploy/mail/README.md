# Mail server

Postfix with DKIM signing, for apps on this host that need to send email
(confirmation links and the like). From the internet it only receives mail
for a few addresses (bounces, postmaster, abuse), which it forwards to a real
mailbox; everything else is refused, and it never relays for strangers.

## Install

```bash
docker network create --subnet 172.29.0.0/24 mail
cp .env.example .env                        # set MAIL_HOSTNAME and ALLOWED_SENDER_DOMAINS
cp inbound/virtual.example inbound/virtual  # the addresses to receive, and where they go
docker compose up -d
```

Apps join the external `mail` network and send to `smtp://postfix:587`
without a password. For The Last Radio, add `docker-compose.mail.yml` to
`COMPOSE_FILE` and set in its `.env`:

```bash
SMTP_URL=smtp://postfix:587
MAIL_FROM=The Last Radio <radio@example.com>
MAIL_RETURN_PATH=bounces@example.com
```

## DNS, for each sending domain

| Record | Name | Value |
|---|---|---|
| A | `MAIL_HOSTNAME` | the server's IPv4 |
| MX | the domain | `10 MAIL_HOSTNAME.` (so bounces and abuse reports reach you) |
| PTR (reverse DNS, at the hosting provider) | the server's IPv4 | `MAIL_HOSTNAME` |
| TXT (SPF) | the domain | `v=spf1 ip4:<server IPv4> -all` |
| TXT (DKIM) | `<selector>._domainkey.<domain>` | from `docker compose exec postfix sh -c 'cat /etc/opendkim/keys/*.txt'` |
| TXT (DMARC) | `_dmarc.<domain>` | `v=DMARC1; p=quarantine; adkim=s; aspf=s` (add `rua=mailto:…` for reports) |

The return path (bounce address) should be on the same domain as From, so SPF
and DMARC line up. Mail goes out over IPv4 only, so no IPv6 records are needed.

## Check

- `dig +short TXT <domain>`, `dig +short TXT <selector>._domainkey.<domain>`,
  `dig +short -x <server IP>`
- Send a message to an address from https://www.mail-tester.com and read the score.
- `docker compose logs -f postfix` shows each delivery (`status=sent`).
- From another machine, relaying must be refused:
  `swaks --server <server> --to someone@gmail.com` → `554 Relay access denied`,
  while `swaks --server <server> --to postmaster@<domain>` is accepted and forwarded.
