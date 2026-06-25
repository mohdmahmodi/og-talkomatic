# Putting this online (Hetzner + Cloudflare + pm2)

This guide sets up `og.talkomatic.co` on a Hetzner VPS, with the domain on
Cloudflare, nginx in front, and the app run by pm2. It is written so the same
server can host many sites side by side under `/var/www`.

How the pieces fit together:

```
visitor -> Cloudflare (DNS + HTTPS) -> nginx on the VPS (port 80/443)
            -> routes by domain name to a local Node app run by pm2
               og.talkomatic.co  ->  127.0.0.1:4001  (this app)
               other.site.co      ->  127.0.0.1:4002  (another app)
               static.site.co     ->  /var/www/static-site (files, no Node)
```

nginx is the only thing exposed to the internet. Each Node app listens on
`127.0.0.1` on its own port, so nothing else is reachable directly.

The example VPS here is a Hetzner `cpx52` with IPv4 `23.88.47.253`.

---

## Part 1: One-time server setup

Do this once per server. Skip to Part 2 if it is already done.

### Install Node, nginx, git, and pm2

```bash
sudo apt update
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx git
sudo npm install -g pm2
node -v
```

### Create the web root

Every site lives in its own folder under `/var/www`.

```bash
sudo mkdir -p /var/www
sudo chown -R $USER:$USER /var/www
```

So you will end up with something like:

```
/var/www/
  og-talkomatic/      this repo
  another-site/       a different project
  static-site/        plain HTML files
```

### Firewall

Open SSH, HTTP, and HTTPS only. The Node ports (4001, 4002, ...) stay private.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

---

## Part 2: Deploy og-talkomatic

### Get the code

```bash
cd /var/www
git clone https://github.com/mohdmahmodi/og-talkomatic.git
cd og-talkomatic/server
npm install --omit=dev
```

### Start it with pm2

Give the app a name and a private port. This app uses `4001`. `HOST=127.0.0.1`
keeps it reachable only through nginx.

```bash
cd /var/www/og-talkomatic/server
PORT=4001 HOST=127.0.0.1 pm2 start server.js --name og-talkomatic
```

Make pm2 start on boot and remember the running app:

```bash
pm2 startup        # prints a command starting with "sudo env ..."; run that command
pm2 save
```

Check it:

```bash
pm2 status
curl localhost:4001/roominfo.json     # should print room JSON
```

> Tip: give every site its own port. og-talkomatic is on 4001; the next Node app
> can use 4002, and so on. nginx is what maps a domain to a port.

### nginx for this site

Talkomatic uses WebSockets (through Socket.IO). The proxy must pass the
`Upgrade` and `Connection` headers or the chat will not update in real time.
This config does that.

Create `/etc/nginx/sites-available/og.talkomatic.co`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name og.talkomatic.co;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name og.talkomatic.co;

    ssl_certificate     /etc/ssl/cloudflare/talkomatic.co.pem;
    ssl_certificate_key /etc/ssl/cloudflare/talkomatic.co.key;

    location / {
        proxy_pass http://127.0.0.1:4001;
        proxy_http_version 1.1;

        # Required for Socket.IO WebSockets:
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
```

You will create the certificate files in Part 3. Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/og.talkomatic.co /etc/nginx/sites-enabled/
sudo nginx -t          # test the config (will warn until certs exist)
```

---

## Part 3: Cloudflare DNS and HTTPS

### DNS records

In the Cloudflare dashboard for `talkomatic.co`, add:

| Type | Name | Content        | Proxy        |
| ---- | ---- | -------------- | ------------ |
| A    | `og` | `23.88.47.253` | Proxied (on) |

That is enough. IPv6 is optional: run `ip -6 addr show` on the VPS, take the
address it shows (one address out of your `/64`), and add an `AAAA` record for
`og` pointing at it, also proxied.

### HTTPS with a Cloudflare Origin Certificate

This is the simplest path with Cloudflare and it never needs renewing.

1. In Cloudflare, go to **SSL/TLS > Overview** and set the mode to
   **Full (strict)**.
2. Go to **SSL/TLS > Origin Server > Create Certificate**. Leave the defaults
   (it covers `talkomatic.co` and `*.talkomatic.co`). Cloudflare shows you a
   certificate and a private key.
3. On the VPS, save them:

   ```bash
   sudo mkdir -p /etc/ssl/cloudflare
   sudo nano /etc/ssl/cloudflare/talkomatic.co.pem   # paste the certificate
   sudo nano /etc/ssl/cloudflare/talkomatic.co.key   # paste the private key
   sudo chmod 600 /etc/ssl/cloudflare/talkomatic.co.key
   ```

4. Reload nginx:

   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```

5. Back in Cloudflare, under **SSL/TLS > Edge Certificates**, turn on
   **Always Use HTTPS**.

Open `https://og.talkomatic.co`. The lobby should load and chat should work.
Cloudflare passes WebSockets through on proxied records by default, so there is
nothing extra to enable there.

> Prefer Let's Encrypt instead? Set the `og` record to DNS-only (grey cloud),
> run `sudo apt install -y certbot python3-certbot-nginx` and
> `sudo certbot --nginx -d og.talkomatic.co`, then turn the proxy back on. The
> Origin Certificate path above avoids the renewals, so it is the default here.

---

## Updating the site later

This matches a normal pull-and-restart:

```bash
cd /var/www/og-talkomatic
git pull origin main
cd server && npm install --omit=dev
pm2 restart og-talkomatic
```

You can also restart by id, for example `pm2 restart 0`. Use `pm2 list` to see
names and ids, and `pm2 logs og-talkomatic` to read output.

---

## Adding more sites to the same server

The pattern for each new site:

1. Put it in its own folder under `/var/www`.
2. If it is a Node app, start it with pm2 on a new port and a new name:

   ```bash
   cd /var/www/another-site
   PORT=4002 HOST=127.0.0.1 pm2 start server.js --name another-site
   pm2 save
   ```

3. Add an nginx server block for its domain in
   `/etc/nginx/sites-available/<domain>`, proxying to that port (copy the
   og-talkomatic block and change `server_name` and the `proxy_pass` port).
4. Add the Cloudflare DNS record for the subdomain.
5. Enable and reload:

   ```bash
   sudo ln -s /etc/nginx/sites-available/<domain> /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

For a plain static site (just HTML, no Node), skip pm2 and serve the folder
directly:

```nginx
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name static.site.co;

    ssl_certificate     /etc/ssl/cloudflare/talkomatic.co.pem;
    ssl_certificate_key /etc/ssl/cloudflare/talkomatic.co.key;

    root /var/www/static-site;
    index index.html;
}
```

The same Origin Certificate covers every `*.talkomatic.co` subdomain, so you can
reuse those cert files for all of them.

---

## Troubleshooting

- **Chat does not update**: the WebSocket headers in the nginx block are missing,
  or nginx was not reloaded. Recheck the `Upgrade` and `Connection` lines and run
  `sudo systemctl reload nginx`.
- **502 Bad Gateway**: the app is not running or nginx points at the wrong port.
  Check `pm2 status` and `pm2 logs og-talkomatic`, and confirm the `proxy_pass`
  port matches the app's `PORT`.
- **App gone after a reboot**: you missed `pm2 startup` or `pm2 save`. Run both
  again.
- **Certificate or redirect errors**: the Cloudflare SSL mode must be
  **Full (strict)** when using the Origin Certificate.
- **Port already in use**: another app holds that port. Pick a free one and
  update both the pm2 `PORT` and the nginx `proxy_pass`.

## A note on scale

The server keeps all room state in memory in a single process. That is fine for
a site like this. Running several copies for load would need a shared Socket.IO
adapter and sticky sessions, which this project does not set up.
