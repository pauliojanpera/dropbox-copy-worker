# Dropbox Copy Worker

This project is a Cloudflare Worker that periodically synchronizes specific files from a source Dropbox folder to designated target and archive folders, ensuring the latest versions are available. It supports both JPG files (copied to a target folder) and PDF files (archived to year-based subfolders), with conditional deletion of source files and folders to keep the source clean. The worker uses Dropbox's OAuth2 refresh token flow for authentication, caches tokens in Cloudflare KV, and runs on a cron schedule (every 5 minutes by default). It is designed to be lightweight, reliable, and easily adaptable.

This guide is for developers who want to repurpose this code for their own Dropbox file-syncing needs or adapt it for other Cloudflare Worker-based automation tasks.

## Features
- **Scheduled File Synchronization**:
  - Copies specified JPG files from `/Tulostus/Järjestelmä` to `/Tulostettavat iltarastikartat` every 5 minutes.
  - Archives PDF files from year-prefixed subfolders (e.g., `2023_something`) in the source to corresponding subfolders in `/Tulostettavat iltarastikartat/Arkisto/<year>` (e.g., `/Arkisto/2023/2023_something`), if the archive subfolder exists.
- **Source Cleanup**:
  - Deletes source JPGs after confirming a recent copy (existing or just forwarded) exists in the target folder.
  - Deletes source PDF subfolders after all PDFs are successfully transferred to the archive, provided the archive subfolder exists.
- **Conditional Archiving**: Only processes PDF subfolders if the corresponding archive year and subfolder (created by a coordinator) exist, ensuring selective archiving.
- **Token Management**: Automatically refreshes and caches Dropbox access tokens using Cloudflare KV.
- **Error Handling**: Robust error handling for Dropbox API calls, file operations, and folder checks.
- **Configurable**: Easily modify source/target/archive folders, file lists, year patterns, and cron schedules.
- **Local Development**: Supports local testing with Miniflare via `wrangler dev`.

## Prerequisites
Before setting up the project, ensure you have the following:
- **Node.js** (v18 or later) and **npm** installed.
- A **Cloudflare account** with access to Workers and KV namespaces.
- A **Dropbox account** and a Dropbox App created in the [Dropbox App Console](https://www.dropbox.com/developers/apps).
- **Wrangler CLI** installed globally (`npm install -g wrangler`).
- Basic familiarity with TypeScript, Cloudflare Workers, and OAuth2 authentication.

## Getting Started

### 1. Clone the Repository
Clone this repository to your local machine:
```bash
git clone https://github.com/your-username/dropbox-copy-worker.git
cd dropbox-copy-worker
```

### 2. Install Dependencies
Install the required Node.js dependencies:
```bash
npm install
```

### 3. Configure Dropbox App
1. Go to the [Dropbox App Console](https://www.dropbox.com/developers/apps) and create a new app.
2. Choose **Scoped access** and select permissions including `files.metadata.read`, `files.content.read`, `files.content.write`, and `files.delete`.
3. Set the redirect URI to `http://localhost:3000/oauth2/callback` in the app settings.
4. Note down the **Client ID** and **Client Secret** for your app.

### 4. Set Up Environment Variables
Create a `.dev.vars` file in the project root to store sensitive environment variables for local development:
```bash
touch .dev.vars
```

Add the following content to `.dev.vars`:
```
DROPBOX_CLIENT_SECRET=your_dropbox_client_secret
DROPBOX_REFRESH_TOKEN=your_dropbox_refresh_token
```

- Replace `your_dropbox_client_secret` with the Client Secret from your Dropbox App.
- The `DROPBOX_REFRESH_TOKEN` will be generated in the next step using the provided script.

Update the `wrangler.jsonc` file with your Dropbox Client ID and Cloudflare KV namespace ID:
- Set `DROPBOX_CLIENT_ID` in the `vars` section to your Dropbox App's Client ID.
- Update the `kv_namespaces` section with your Cloudflare KV namespace ID (create one via the Cloudflare dashboard if needed).

Example `wrangler.jsonc` snippet:
```json
"vars": {
  "DROPBOX_CLIENT_ID": "your_dropbox_client_id"
},
"kv_namespaces": [
  {
    "binding": "STATE",
    "id": "your_kv_namespace_id"
  }
]
```

### 5. Obtain a Dropbox Refresh Token
Run the provided `update-refresh-token.js` script to authenticate with Dropbox and obtain a refresh token:
```bash
node update-refresh-token.js
```

1. The script starts a local server at `http://localhost:3000`.
2. It outputs a Dropbox authorization URL. Open this URL in your browser.
3. Authorize the app, and you’ll be redirected to `http://localhost:3000/oauth2/callback`.
4. The script will automatically:
   - Exchange the authorization code for a refresh token.
   - Update `.dev.vars` with the new `DROPBOX_REFRESH_TOKEN`.
   - Store the refresh token in Cloudflare Worker secrets for deployment.

If you need to update the refresh token later (e.g., due to token revocation), rerun the `update-refresh-token.js` script.

### 6. Customize the Worker
Modify `src/index.ts` to suit your needs:
- **Folders**:
  - Update `sourceFolder` (e.g., `/Tulostus/Järjestelmä`) and `targetFolder` (e.g., `/Tulostettavat iltarastikartat`) for JPGs.
  - Adjust `archiveFolder` (e.g., `/Tulostettavat iltarastikartat/Arkisto`) for PDFs.
- **File List**: Modify the `jpgEntries` array (e.g., `['a-rata.jpg', 'b-rata.jpg']`) to specify JPG files to copy.
- **PDF Subfolders**: Change the `yearRegex` (e.g., `/^20[0-9][0-9]$/`) to match your subfolder naming convention (currently matches `20XX` prefixes).
- **Archiving Logic**: Adjust the `folderExists` checks in `forwardPdfs` to change how archive subfolders are validated (e.g., require different folder structures).
- **Deletion Logic**:
  - Modify `forwardJpg` to change JPG deletion conditions (e.g., require additional checks before deletion).
  - Update `forwardPdfs` to alter subfolder deletion criteria (e.g., delete even if no PDFs are present).
- **Cron Schedule**: Change the `crons` schedule in `wrangler.jsonc` (e.g., `"0/10 * * * *"` for every 10 minutes).

Example customization in `src/index.ts`:
```typescript
const sourceFolder = '/Your/Source/Folder';
const targetFolder = '/Your/Target/Folder';
const archiveFolder = '/Your/Archive/Folder';
const jpgEntries = ['file1.jpg', 'file2.jpg'];
const yearRegex = /^20[0-9][0-9]_.*$/; // Match folders like "2023_anything"
```

### 7. Local Development with Miniflare
Wrangler uses [Miniflare](https://miniflare.dev/) to simulate the Cloudflare Workers runtime locally, allowing you to test your Worker without deploying it.

#### Run the Worker Locally
Start the local development server with Miniflare:
```bash
npm run start
```
This runs `wrangler dev --test-scheduled`, which:
- Starts a local server (typically at `http://localhost:8787`).
- Enables the `--test-scheduled` flag to allow manual triggering of the scheduled event.
- Loads environment variables from `.dev.vars` and bindings from `wrangler.jsonc`.

#### Test the Scheduled Event
The Worker is configured to run on a cron schedule, but you can manually trigger the `scheduled` handler to test it:
```bash
curl "http://localhost:8787/__scheduled?cron=0/5%20*%20*%20*%20*"
```
- This simulates the cron trigger (`0/5 * * * *`) defined in `wrangler.jsonc`.
- Check the terminal output for logs about token refreshes, file/folder metadata checks, file transfers, and deletions.

#### Miniflare Features
- **KV Simulation**: Miniflare emulates the `STATE` KV namespace for storing the Dropbox access token.
- **Cron Testing**: The `--test-scheduled` flag allows manual invocation of the cron job.
- **Hot Reloading**: Changes to `src/index.ts` are automatically reloaded during development.
- **Debugging**: Use `console.log` statements in `src/index.ts` to debug; output appears in the terminal.

#### Tips for Miniflare
- Ensure `.dev.vars` contains valid `DROPBOX_CLIENT_SECRET` and `DROPBOX_REFRESH_TOKEN`.
- If you encounter binding errors, verify that the `kv_namespaces` ID in `wrangler.jsonc` is correct or omit the `id` field for local KV simulation.
- To test different cron schedules, update the `crons` array in `wrangler.jsonc` and restart the dev server.
- Test folder deletion by setting up mock Dropbox folders and verifying deletion logs.

### 8. Deploy to Cloudflare
Once you’ve tested the Worker locally, deploy it to Cloudflare’s production environment.

#### Prerequisites for Deployment
- Log in to Cloudflare using Wrangler:
  ```bash
  wrangler login
  ```
  This opens a browser window to authenticate your Cloudflare account.
- Ensure the KV namespace ID in `wrangler.jsonc` matches a KV namespace created in your Cloudflare dashboard.
- Verify that the `DROPBOX_REFRESH_TOKEN` is set in the Cloudflare Worker secrets (handled by `update-refresh-token.js`).

#### Deploy the Worker
Run the deployment command:
```bash
npm run deploy
```
This executes `wrangler deploy`, which:
- Bundles and uploads the Worker code (`src/index.ts`) to Cloudflare.
- Configures the Worker with settings from `wrangler.jsonc` (e.g., cron triggers, KV bindings, environment variables).
- Publishes the Worker under the name `dropbox-copy-worker` (as defined in `wrangler.jsonc`).

#### Post-Deployment
- The Worker will automatically run every 5 minutes based on the cron schedule (`0/5 * * * *`).
- View logs and observability data in the Cloudflare dashboard (enabled via `"observability": { "enabled": true }` in `wrangler.jsonc`).
- To update the Worker, make changes to the code or configuration and redeploy with `npm run deploy`.

#### Verifying Deployment
- Check the Cloudflare Workers dashboard to confirm the Worker is active.
- Monitor logs in the dashboard or use `wrangler tail` to stream real-time logs:
  ```bash
  wrangler tail
  ```
- Verify that JPGs are copied to the target folder, PDFs are archived, and source files/folders are deleted by checking the Dropbox folders.

## Adapting the Code
To repurpose this Worker for other use cases:
- **Different File Types**: Modify `jpgEntries` for other file extensions or update `forwardPdfs` to handle additional formats (e.g., `.docx`).
- **Custom Folder Structures**: Change the archive folder hierarchy in `forwardPdfs` (e.g., remove year subfolders).
- **Alternative Deletion Rules**: Adjust deletion conditions in `forwardJpg` or `forwardPdfs` (e.g., delete based on file size or age).
- **Other APIs**: Replace Dropbox API calls with another service’s API, updating token refresh logic as needed.
- **Additional Bindings**: Add Cloudflare bindings (e.g., R2, D1) in `wrangler.jsonc` for more complex workflows.

Refer to the [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/) and [Dropbox API documentation](https://www.dropbox.com/developers/documentation/http/documentation) for more details.

## Troubleshooting
- **Token Refresh Errors**: Ensure `DROPBOX_CLIENT_ID`, `DROPBOX_CLIENT_SECRET`, and `DROPBOX_REFRESH_TOKEN` are correctly set in `.dev.vars`. Rerun `update-refresh-token.js` if the token is invalid.
- **File/Folder Not Found (409)**: Verify that source files, subfolders, and archive folders exist in Dropbox.
- **Deletion Failures**: Check Dropbox API permissions for `files.delete` and ensure no locks on source files/folders.
- **KV Issues**: Confirm the KV namespace ID in `wrangler.jsonc` matches your Cloudflare dashboard or is omitted for local testing.
- **Cron Not Triggering**: Check the `compatibility_date` in `wrangler.jsonc` (should be recent, e.g., `2025-05-25`) and ensure the cron syntax is valid.
- **Miniflare Errors**: If bindings fail, ensure `wrangler.jsonc` is correctly configured and restart the dev server.
- **Deployment Errors**: Run `wrangler whoami` to verify your Cloudflare account and check for typos in `wrangler.jsonc`.

## Contributing
Feel free to open issues or submit pull requests with improvements, such as:
- Support for additional file types or Dropbox API features.
- Enhanced logging for auditing file transfers and deletions.
- Integration with other cloud storage services.

## License
This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.