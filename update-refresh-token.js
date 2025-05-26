import http from 'http';
import { parse as parseUrl } from 'url';
import fetch from 'node-fetch';
import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

async function updateDevVars(refreshToken) {
    const devVarsPath = '.dev.vars';
    let content = '';
    try {
        content = await fs.readFile(devVarsPath, 'utf8');
    } catch (error) {
        console.log('.dev.vars not found, creating new file');
    }

    const lines = content.split('\n');
    const updatedLines = lines.filter(line => !line.startsWith('DROPBOX_REFRESH_TOKEN='));
    updatedLines.push(`DROPBOX_REFRESH_TOKEN=${refreshToken}`);

    await fs.writeFile(devVarsPath, updatedLines.join('\n').trim() + '\n');
    console.log('Updated .dev.vars with new DROPBOX_REFRESH_TOKEN');
}

async function updateWranglerSecret(refreshToken) {
    try {
		console.log('trying to update the wrangler secret');
        const child = exec(`wrangler secret put DROPBOX_REFRESH_TOKEN`);
		child.stdin.write(refreshToken + '\n');
		child.stdin.end();

        const { stdout, stderr } = await new Promise((resolve, reject) => {
            child.on('error', reject);
            child.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`wrangler exited with code ${code}`));
                } else {
                    resolve({ stdout: child.stdout.read() || '', stderr: child.stderr.read() || '' });
                }
            });
        });
        
        console.log('Wrangler stdout:', stdout);
        if (stderr) console.warn('Wrangler stderr:', stderr);
        console.log('Updated DROPBOX_REFRESH_TOKEN in Cloudflare Worker secrets');    } catch (error) {
        console.error('Error updating Wrangler secret:', error.message);
        throw error;
    }
}

async function getRefreshToken(clientId, clientSecret, authCode, redirectUri) {
    const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            code: authCode,
            grant_type: 'authorization_code',
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
        }).toString(),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get refresh token: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.refresh_token;
}

function startServer(clientId, clientSecret) {
    return new Promise((resolve, reject) => {
        const redirectUri = 'http://localhost:3000/oauth2/callback';
        const authUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${clientId}&response_type=code&token_access_type=offline&redirect_uri=${encodeURIComponent(redirectUri)}`;

        console.log('First you need to set the following redirect URI in the Dropbox App Console for this application: http://localhost:3000/oauth2/callback');
        console.log('Then please visit this URL to authorize the application:', authUrl);
        console.log('After authorizing, you will be redirected to a local server.');

        const server = http.createServer(async (req, res) => {
            const parsedUrl = parseUrl(req.url, true);
            if (parsedUrl.pathname === '/oauth2/callback') {
                const authCode = parsedUrl.query.code;
                if (authCode) {
                    try {
                        const refreshToken = await getRefreshToken(clientId, clientSecret, authCode, redirectUri);
                        res.writeHead(200, { 'Content-Type': 'text/plain' });
                        res.end('Success! You can close this page.');
                        server.close();
                        resolve(refreshToken);
                    } catch (error) {
                        res.writeHead(500, { 'Content-Type': 'text/plain' });
                        res.end('Error obtaining refresh token.');
                        server.close();
                        reject(error);
                    }
                } else {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('No authorization code provided.');
                    server.close();
                    reject(new Error('No authorization code provided'));
                }
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not found');
            }
        });

        server.listen(3000, () => {
            console.log('Local server running at http://localhost:3000');
        });

        server.on('error', (error) => {
            reject(new Error(`Server error: ${error.message}`));
        });
    });
}

async function main() {
    const clientId = 'w6ol0q8x42ic8sb'; // From wrangler.jsonc
    let clientSecret;

    // Read DROPBOX_CLIENT_SECRET from .dev.vars
    try {
        const devVarsContent = await fs.readFile('.dev.vars', 'utf8');
        const secretLine = devVarsContent.split('\n').find(line => line.startsWith('DROPBOX_CLIENT_SECRET='));
        if (!secretLine) {
            throw new Error('DROPBOX_CLIENT_SECRET not found in .dev.vars');
        }
        clientSecret = secretLine.split('=')[1].trim();
    } catch (error) {
        console.error('Error reading .dev.vars:', error.message);
        console.log('Please ensure .dev.vars exists and contains DROPBOX_CLIENT_SECRET');
        process.exit(1);
    }

    try {
        const refreshToken = await startServer(clientId, clientSecret);
        console.log(`Obtained new refresh token, ${refreshToken.length} characters.`);
        await updateDevVars(refreshToken);
        await updateWranglerSecret(refreshToken);

        console.log('All updates completed successfully!');
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

main();