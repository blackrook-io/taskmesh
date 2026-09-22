# Compose nginx TLS proxy

Terminates HTTPS for the default [`compose.yaml`](../../compose.yaml) stack and proxies to `app:3000`.

## Certs

```bash
bash docker/nginx/generate-certs.sh
# optional SANs: bash docker/nginx/generate-certs.sh localhost 127.0.0.1 192.168.1.50
```

Writes `docker/nginx/certs/fullchain.pem` and `privkey.pem` (gitignored). Reload/recreate the `proxy` service after regenerating.
