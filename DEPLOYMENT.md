# Hostinger deployment checklist

Use a Hostinger Node.js application for `pickformehub.com`.

Application settings:

- Node.js: 20 or newer
- Application startup file: `server.js`
- Application port: use the port Hostinger provides
- Repository: `dannyvaziri/pickformehub`
- Branch: `main`

Environment variables:

- `AMAZON_ASSOCIATE_TAG=pickformehub-20`
- `GEMINI_API_KEY=<your free-tier Gemini key>`
- `GEMINI_MODEL=gemini-3.8-flash`

The Gemini key must be stored only in Hostinger environment settings. Never commit it to GitHub.

Verification after deployment:

- `GET /` should show the PickForMeHub homepage.
- `GET /health` should return JSON with `ok: true`.
- Submit a physical-product request and confirm the Amazon links include `tag=pickformehub-20`.
- Confirm the AI response includes sources and does not recommend SaaS or services.
