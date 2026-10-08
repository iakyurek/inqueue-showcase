# Preply

Preply prepares PNG design batches before Batchly. It validates design ZIPs, collects listing intake, reserves SKUs from Google Drive, places designs on mockups, stamps store/shipping logos, creates a manifest, and exports a Batchly-ready ZIP.

## Run

```bash
npm install
npm start
```

Open:

```text
http://localhost:3001
```

## Google Drive Setup

Preply supports two Drive modes:

```env
GOOGLE_DRIVE_AUTH_MODE=service_account
GOOGLE_SERVICE_ACCOUNT_KEY_PATH=./google-service-account.json
```

or offline mock mode:

```env
GOOGLE_DRIVE_AUTH_MODE=mock
```

Setup steps:

1. Create a Google Cloud project.
2. Enable the Google Drive API.
3. Create a service account.
4. Download the JSON key.
5. Place it at `./google-service-account.json` or set `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`.
6. Create `.env` from `.env.example`.
7. Share each store SKU root folder with the service account email as Editor.
8. Paste each store SKU root folder ID into Store Settings.
9. Restart the server.
10. Click **Test Connection** and **Scan Latest SKU** for each store.

Preply never logs or exposes the service account private key. The key file, `.env`, `credentials/`, and `*.pem` are ignored by git.

## Store SKU Folders

Each store needs its own Google Drive SKU root folder. Inside that folder, SKU folders should be named as prefix + number:

```text
CU229/
CU230/
CU231/
```

Preply scans only folders matching the store prefix and numeric suffix. It ignores files and unrelated folders such as `Archive`, `Old Designs`, or `CU231 copy`.

During batch creation, Preply scans Drive and reserves the next SKUs locally. It does not create Drive folders until export. During export, Preply rescans Drive, stops on conflicts, creates SKU folders, and uploads the matching source design PNG into each folder.

## Project Folders

```text
BlankMockups/
StoreLogos/
FreeShippingLogo/
data/
logs/
```

Mockup placement presets are stored in `BlankMockups/placement.json`.
Global stamp presets are stored in `BlankMockups/stamp-placement.json`.
Favorite mockup selection presets are stored in `data/mockup-presets.json`.
