# PG Mate

Daily-use app for PG/hostel residents and owners.

- Residents: today's menu, skip a meal, notices, complaints with status, rent status
- Owners: set menu, see meal counts, post notices, manage complaints, create rent and mark paid, invite code

## Run locally
```
npm install
npm start
```
Open http://localhost:3000. Sign up with "I own a PG", then use the invite code to join from another browser as a resident.

## Deploy backend (Render)
1. Push this folder to GitHub.
2. Render > New Web Service > connect repo. Build: `npm install`. Start: `npm start`.
3. Environment variables: `JWT_SECRET` (long random string), `DB_FILE=/data/pgmate.db`.
4. Add a Persistent Disk mounted at `/data` (free instances lose SQLite data on restart).
   For serious use, move to PostgreSQL (Neon/Supabase).
5. Your app is live at `https://<name>.onrender.com`. That is your shareable web link.

## Android app (Play Store) with Capacitor
1. In `public/index.html`, set `window.API_BASE = 'https://<name>.onrender.com'`.
2. In this folder:
```
npm i -D @capacitor/cli && npm i @capacitor/core @capacitor/android
npx cap init PGMate com.yourname.pgmate --web-dir=public
npx cap add android
npx cap sync
npx cap open android
```
3. In Android Studio: Build > Generate Signed Bundle (AAB). Keep your keystore safe.
4. Play Console ($25 one-time): create app, upload AAB, add privacy policy URL, Data Safety form,
   run closed test with 12+ testers for 14 days, then request production.

## Next features
Laundry slots, expense splitter, push notifications (Firebase), Razorpay/UPI payment links,
owner subscription billing, PostgreSQL.
