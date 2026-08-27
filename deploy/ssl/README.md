# TaskMesh TLS certificates (nginx)

nginx terminates HTTPS on **:443** and proxies to Express on `127.0.0.1:3000`. Express stays on loopback; clients use `https://<host>/`.

## Certificate paths

| File | Purpose |
|------|---------|
| `/etc/nginx/ssl/taskmesh/fullchain.pem` | Certificate (or cert + chain) |
| `/etc/nginx/ssl/taskmesh/privkey.pem` | Private key |

These paths match [`deploy/nginx-taskmesh.conf`](../nginx-taskmesh.conf).

## Option A — Self-signed (private LAN)

Quick setup for a home lab. Browsers show a trust warning unless you import the CA.

```bash
sudo bash /srv/taskmesh/deploy/ssl/generate-self-signed.sh 192.168.1.50
sudo nginx -t && sudo systemctl reload nginx
```

Replace `192.168.1.50` with this server's LAN IP or DNS name clients use.

## Option B — mkcert (trusted LAN)

[mkcert](https://github.com/FiloSottile/mkcert) installs a local CA on your laptop so LAN devices trust the cert after installing the CA once.

```bash
mkcert -install
mkcert -cert-file fullchain.pem -key-file privkey.pem 192.168.1.50 localhost 127.0.0.1
sudo mkdir -p /etc/nginx/ssl/taskmesh
sudo cp fullchain.pem privkey.pem /etc/nginx/ssl/taskmesh/
sudo nginx -t && sudo systemctl reload nginx
```

## Option C — Public internet (Let's Encrypt)

For a hostname on the public internet, use **certbot** with nginx (not automated in TaskMesh yet):

1. Point DNS `A`/`AAAA` at this host.
2. Open **443** (and **80** for HTTP-01) in the firewall.
3. `sudo apt-get install -y certbot python3-certbot-nginx`
4. `sudo certbot --nginx -d taskmesh.example.com`
5. Set `server_name taskmesh.example.com;` in the nginx site (replace `_`).

Renewal: certbot installs a systemd timer; verify with `sudo certbot renew --dry-run`.

## Permissions

- Private key: `640` root:`root` or root:`www-data` (nginx user must read).
- Certificate: `644`.
- Never commit keys or `.env` to git.

## Verify

```bash
curl -fsSk https://127.0.0.1/api/health
curl -fsS http://127.0.0.1/api/health   # expect 301 → https
```

`npm run deploy:prod` health-checks both `:3000` and nginx HTTPS.
