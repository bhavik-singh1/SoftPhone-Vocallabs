# TLS certificates for WSS (and the frontend HTTPS dev server)

WebRTC needs a secure context, so the browser must reach Kamailio over **WSS**
and the React app over **HTTPS**. We use [mkcert](https://github.com/FiloSottile/mkcert)
to make a locally-trusted cert.

## Generate (run inside WSL, from the repo root)

```bash
# 1. Install mkcert + the local CA (one-time)
sudo apt-get install -y libnss3-tools
curl -L https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-v1.4.4-linux-amd64 -o /usr/local/bin/mkcert
sudo chmod +x /usr/local/bin/mkcert
mkcert -install

# 2. Make a cert for the hostname in .env (PUBLIC_HOST) + your LAN IP
mkcert -cert-file infra/kamailio/certs/cert.pem \
       -key-file  infra/kamailio/certs/key.pem \
       softphone.local localhost 127.0.0.1 192.168.1.100
```

Then map the hostname so the browser resolves it:
add `127.0.0.1  softphone.local` to your hosts file
(Windows: `C:\Windows\System32\drivers\etc\hosts`).

The same `cert.pem` / `key.pem` are reused by the Vite dev server (mounted at
`/certs` in the frontend container) so both WSS and HTTPS trust the same CA.

> On a VPS, replace these with a real Let's Encrypt cert for your domain.
