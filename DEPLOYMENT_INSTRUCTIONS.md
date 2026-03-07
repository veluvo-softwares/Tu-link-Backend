# Tu-Link Backend Deployment Instructions

## 1. Update Caddyfile (Required First)

SSH to your server and update the Caddyfile:

```bash
ssh root@157.230.36.105
nano /root/tulink-traefik/config/caddy/Caddyfile
```

Change:
```
api.dev.tulink.xyz {
    reverse_proxy api-dev:80
}
```

To:
```
api.dev.tulink.xyz {
    reverse_proxy api-dev:3000
}
```

Restart Caddy:
```bash
cd /root/tulink-traefik
docker compose restart caddy
```

## 2. Deploy Tu-Link Backend

Copy deployment script to server:
```bash
scp deploy-to-server.sh root@157.230.36.105:/root/
```

SSH to server and run deployment:
```bash
ssh root@157.230.36.105
chmod +x /root/deploy-to-server.sh
cd /root
./deploy-to-server.sh
```

## 3. Configure Environment

When prompted, edit `.env` with your Firebase credentials:
- Copy values from your local `.env` file
- Ensure `REDIS_HOST=redis` (connects to existing Redis container)

## 4. Verify Deployment

After deployment completes:
- Public API: https://api.dev.tulink.xyz/health
- API Docs: https://api.dev.tulink.xyz/api
- Local check: http://localhost:3000/health

The Tu-Link backend will now replace the nginx placeholder and be accessible via your domain.