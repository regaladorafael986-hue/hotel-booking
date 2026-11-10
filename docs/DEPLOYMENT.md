# Deployment guide

StayEase is a single Node.js process that serves the API and the static frontend from one origin. Any host that runs Node 20+ and can reach MySQL 8 / MariaDB 10.4+ will work, such as a VPS (Ubuntu + Nginx), Render, Railway or Fly.io.

## 1. Production database
1. Create a managed MySQL database (or install MySQL on the server) and a dedicated user:
   ```sql
   CREATE DATABASE stayease_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'stayease'@'%' IDENTIFIED BY '<strong password>';
   GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES, LOCK TABLES ON stayease_db.* TO 'stayease'@'%';
   ```
2. Set `DATABASE_URL=mysql://stayease:<password>@<host>:3306/stayease_db` (add `?sslaccept=strict` if your provider requires TLS).
3. Apply migrations with `npm run db:deploy`. **Do not run the seed in production**; the script refuses when `NODE_ENV=production`.
4. Create the first administrator from the server shell:
   ```bash
   node -e "const b=require('bcryptjs'),p=require('./src/config/prisma');b.hash(process.argv[1],12).then(h=>p.user.create({data:{firstName:'Admin',lastName:'User',email:process.argv[2],passwordHash:h,role:'ADMIN',emailVerifiedAt:new Date()}})).then(()=>process.exit())" '<password>' admin@yourhotel.com
   ```
   Then sign in, open **Hotel settings** to enter the hotel profile, and create room categories and rooms.

## 2. Environment (`backend/.env`)
```
NODE_ENV=production
PORT=4000
APP_URL=https://www.yourhotel.com
TRUST_PROXY=true
SESSION_SECRET=<64+ random characters>
DATABASE_URL=mysql://…
HOTEL_TIMEZONE=Asia/Manila
BREVO_API_KEY=…            MAIL_FROM_EMAIL=reservations@yourhotel.com   MAIL_FROM_NAME=Your Hotel
CLOUDINARY_CLOUD_NAME=…    CLOUDINARY_API_KEY=…   CLOUDINARY_API_SECRET=…
PAYMENT_PROVIDER=paymongo  PAYMONGO_SECRET_KEY=sk_live_…   PAYMONGO_WEBHOOK_SECRET=whsk_…   PAYMONGO_LIVE_MODE=true
```
With `NODE_ENV=production`, startup **fails** if `SESSION_SECRET` is missing or `PAYMENT_PROVIDER=mock`. Session cookies become `Secure`, and CSP adds `upgrade-insecure-requests`.

In Brevo, verify the sender domain (SPF/DKIM) so emails reach inboxes.

## 3. Run the app (VPS example)
```bash
git clone <repo> /srv/stayease && cd /srv/stayease/backend
npm ci --omit=dev && npx prisma generate && npm run db:deploy
sudo npm i -g pm2
pm2 start src/server.js --name stayease && pm2 save && pm2 startup
```
With several instances, set `RUN_JOBS=false` on all but one, so holds are expired and reminders sent exactly once.

## 4. HTTPS and the domain (Nginx + Let's Encrypt)
```nginx
server {
  server_name www.yourhotel.com;
  client_max_body_size 12m;            # image uploads (5 MB × several)
  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```
```bash
sudo certbot --nginx -d www.yourhotel.com
```
Point the domain's DNS A record at the server, and keep `TRUST_PROXY=true` so secure cookies and the rate limiter see real client IPs.

## 5. Payment webhooks
In the PayMongo dashboard, register `https://www.yourhotel.com/api/v1/payments/webhook` for `checkout_session.payment.paid`, `payment.failed` and `payment.refund.updated`. Copy its secret into `PAYMONGO_WEBHOOK_SECRET`. Webhook events are verified, de-duplicated and logged in `payment_events`.

## 6. Backups
`npm run db:backup` writes `storage/backups/stayease_db-<timestamp>.sql.gz` and keeps the newest `BACKUP_RETENTION` (default 14). Schedule it daily and copy the files off the server:
```cron
15 2 * * * cd /srv/stayease/backend && /usr/bin/npm run db:backup >> /var/log/stayease-backup.log 2>&1
```
To restore: `gunzip -c stayease_db-YYYYMMDD-HHMMSS.sql.gz | mysql -u stayease -p stayease_db`. Test a restore regularly, and also enable your database provider's point-in-time backups if available.

If images use local storage (no Cloudinary), also back up `backend/storage/uploads/`.

## 7. Release checklist
- [ ] `npm test` passes against a staging database
- [ ] `NODE_ENV=production` and all secrets set; `.env` is not committed (see `.gitignore`)
- [ ] HTTPS active; HTTP redirects to HTTPS
- [ ] PayMongo live keys and webhook secret set; one real low-value payment and refund verified
- [ ] Brevo sender verified; test email received
- [ ] Admin password changed from any temporary value; demo accounts absent
- [ ] Daily backup job running; a restore tested
- [ ] Monitoring and uptime checks on `GET /api/health`
