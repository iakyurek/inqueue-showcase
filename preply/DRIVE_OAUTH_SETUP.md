# Preply → Google Drive source-PNG upload (OAuth user mode)

## Why this exists

The NorthWindUS Drive folder (`1yLwANKnAlqLAseGJotuCqR1mGEF1WHiV`) lives in a
**personal My Drive**, not a Shared Drive. A **service account has zero My Drive
storage quota**, so it can create the SKU folder (0 bytes) but can never store a
file inside it — Google returns `403 storageQuotaExceeded`. This is a Google
limitation, not a Preply bug.

The fix: upload **as a real Google user** (who has storage quota) via OAuth.
Folder creation and PNG upload both run as that user, who owns the parent folder.

## One-time setup

1. **Create an OAuth client** in Google Cloud Console
   (APIs & Services → Credentials → Create credentials → OAuth client ID →
   *Web application*).
   - Authorized redirect URI: `http://localhost:3001/api/drive/oauth/callback`
   - Enable the **Google Drive API** for the project.
2. **Download** the client JSON and save it as:
   `preply/google-oauth-client.json`
   (or set `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` env vars).
3. **Launch Preply in OAuth mode:**
   ```bash
   cd preply
   GOOGLE_DRIVE_AUTH_MODE=oauth node server.js
   ```
4. In the **Current Batch** tab, click **Connect Google Drive**. Sign in with the
   Google account that owns the store folders and approve Drive access. The
   refresh token is stored in `preply/data/google-oauth-token.json`.

After connecting, exports create/reuse the SKU folder and upload the raw source
PNG (`D001.png`) into that exact folder, owned by your user.

## Notes
- `NorthWindUS = Store_A`, SKU prefix `CU`, Batchly ZIP format unchanged.
- Service-account mode (`GOOGLE_DRIVE_AUTH_MODE=service_account`) still works for
  folder creation and Batchly ZIP, but PNG upload will fail with the accurate
  `storageQuotaExceeded` message until you move the folder to a Shared Drive.
- `data/google-oauth-token.json` and `google-oauth-client.json` are secrets —
  keep them out of version control.
