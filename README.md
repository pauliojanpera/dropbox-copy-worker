# Dropbox Copy Worker

This project is a Cloudflare Worker that periodically copies specific files from one Dropbox folder to another, ensuring the target folder contains the latest versions of the files. It uses Dropbox's OAuth2 refresh token flow to maintain a valid access token and Cloudflare's KV storage to cache the token. The worker runs on a cron schedule (every 5 minutes by default) and is designed to be lightweight and reliable.

This guide is for developers who want to repurpose this code for their own Dropbox file-syncing needs or adapt it for other Cloudflare Worker-based automation tasks.

## Features
- **Scheduled File Copying**: Copies specified files from a source Dropbox folder to a target folder every 5 minutes.
- **Token Management**: Automatically refreshes and caches Dropbox access tokens using Cloudflare KV.
- **Error Handling**: Robust error handling for Dropbox API calls and file operations.
- **Configurable**: Easily modify source/target folders, file lists, and cron schedules.
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
2. Choose **Scoped access** and select the appropriate permissions (e.g., `files.metadata.read`, `files.content.read`, `files.content.write`).
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

If you need to update the refresh token later (e.g., due to token revocation), rerun the `update-refresh-token.js` script to generate and store a new token.

### 6. Customize the Worker
Modify `src/index.ts` to suit your needs:
- **Source and Target Folders**: Update `sourceFolder` and `targetFolder` to your Dropbox folder paths.
- **File List**: Adjust the `entries` array to include the files you want to copy.
- **Cron Schedule**: Change the `crons` schedule in `wrangler.jsonc` (e.g., `"0/10 * * * *"` for every 10 minutes).
- **Logic**: Extend the `scheduled` function for additional Dropbox API operations or other tasks.

Example customization in `src/index.ts`:
```typescript
const sourceFolder = '/Your/Source/Folder';
const targetFolder = '/Your/Target/Folder';
const entries = ['file1.pdf', 'file2.png', 'file3.txt'];
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
- Check the terminal output for logs about token refreshes, file metadata checks, and file copying.

#### Miniflare Features
- **KV Simulation**: Miniflare emulates the `STATE` KV namespace for storing the Dropbox access token.
- **Cron Testing**: The `--test-scheduled` flag allows manual invocation of the cron job.
- **Hot Reloading**: Changes to `src/index.ts` are automatically reloaded during development.
- **Debugging**: Use `console.log` statements in `src/index.ts` to debug; output appears in the terminal.

#### Tips for Miniflare
- Ensure `.dev.vars` contains valid `DROPBOX_CLIENT_SECRET` and `DROPBOX_REFRESH_TOKEN`.
- If you encounter binding errors, verify that the `kv_namespaces` ID in `wrangler.jsonc` is correct or use a local KV namespace by omitting the `id` field (Miniflare will simulate it).
- To test different cron schedules, update the `crons` array in `wrangler.jsonc` and restart the dev server.

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
- Verify that files are being copied in Dropbox by checking the target folder.

## Adapting the Code
To repurpose this Worker for other use cases:
- **Different File Operations**: Modify the `streamFile` function to perform other Dropbox API actions (e.g., delete, move, or list files).
- **Other APIs**: Replace Dropbox API calls with another service’s API, updating the token refresh logic as needed.
- **Custom Schedules**: Adjust the `crons` array in `wrangler.jsonc` for different schedules.
- **Additional Bindings**: Add Cloudflare bindings (e.g., R2, D1) in `wrangler.jsonc` for more complex workflows.

Refer to the [Cloudflare Workers documentation](https://developers.cloudflare.com/workers/) and [Dropbox API documentation](https://www.dropbox.com/developers/documentation/http/documentation) for more details.

## Troubleshooting
- **Token Refresh Errors**: Ensure `DROPBOX_CLIENT_ID`, `DROPBOX_CLIENT_SECRET`, and `DROPBOX_REFRESH_TOKEN` are correctly set in `.dev.vars`. Rerun `update-refresh-token.js` if the token is invalid.
- **File Not Found (409)**: Verify that the source files and folders exist in Dropbox.
- **KV Issues**: Confirm the KV namespace ID in `wrangler.jsonc` matches your Cloudflare dashboard or is omitted for local testing.
- **Cron Not Triggering**: Check the `compatibility_date` in `wrangler.jsonc` (should be recent, e.g., `2025-05-25`) and ensure the cron syntax is valid.
- **Miniflare Errors**: If bindings fail, ensure `wrangler.jsonc` is correctly configured and restart the dev server.
- **Deployment Errors**: Run `wrangler whoami` to verify your Cloudflare account and check for typos in `wrangler.jsonc`.

## Contributing
Feel free to open issues or submit pull requests with improvements, such as:
- Additional Dropbox API features.
- Enhanced error handling or logging.
- Support for other cloud storage services.

## License
This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.