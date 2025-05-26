async function refreshAccessToken(env) {
    try {
        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: env.DROPBOX_REFRESH_TOKEN,
            client_id: env.DROPBOX_CLIENT_ID,
            client_secret: env.DROPBOX_CLIENT_SECRET,
        }).toString();
        console.log('Request body:', body); // Debug
        const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body,
        });

        if (!response.ok) {
            const errorText = await response.text(); // Get error details
            throw new Error(`Failed to refresh token: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        return {
            access_token: data.access_token,
            expires_at: Date.now() + (data.expires_in * 1000),
        };
    } catch (error) {
        console.error('Error refreshing access token:', error);
        throw error;
    }
}

async function getValidToken(env) {
    const EXPIRY_BUFFER_MS = 600000; // 10 minutes buffer (600,000 ms)
    
    // Check KV for stored token
    const stored = await env.STATE.get('dropbox_access_token', { type: 'json' });
    if (stored && stored.expires_at > Date.now() + EXPIRY_BUFFER_MS) {
        return stored.access_token; // Token is still valid with buffer
    }

    // Refresh token if expired or close to expiry
    const newToken = await refreshAccessToken(env);
    // Store new token in KV with expiration
    await env.STATE.put('dropbox_access_token', JSON.stringify(newToken), {
        expirationTtl: Math.floor((newToken.expires_at - Date.now()) / 1000), // Set KV expiry
    });
    console.log(`Refreshed Dropbox access token, expires at ${new Date(newToken.expires_at).toISOString()}`);
    return newToken.access_token;
}

function asciiSafe(s:string) {
	return s.replace(/[\u007F-\uFFFF]/g, function(chr) {
		return "\\u" + ("0000" + chr.charCodeAt(0).toString(16)).substr(-4)
	});
}

export default {
    async fetch(req) {
        const url = new URL(req.url);
        url.pathname = '/__scheduled';
        url.searchParams.append('cron', '0/5 * * * *');
        return new Response(
            `To test the scheduled handler, ensure you have used the "--test-scheduled" then try running "curl ${url.href}".`
        );
    },

    async scheduled(event, env, ctx) {
        const sourceFolder = '/Tulostus/Järjestelmä';
        const targetFolder = '/Tulostettavat iltarastikartat';
        const entries = ['a-rata.jpg', 'b-rata.jpg', 'c-rata.jpg', 'opetusrata.jpg', 'kaikki rastit.jpg'];

        // Get valid access token
        const accessToken = await getValidToken(env);

        const getFileMetadata = async (filePath) => {
            try {
                const response = await fetch('https://api.dropboxapi.com/2/files/get_metadata', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ path: filePath }),
                });

                if (!response.ok) {
                    if (response.status === 409) return null; // File doesn't exist
                    throw new Error(`Failed to get metadata for ${filePath}: ${response.status}`);
                }

                const data = await response.json();
                return new Date(data.client_modified);
            } catch (error) {
                console.error(`Error getting metadata for ${filePath}:`, error);
                return null;
            }
        };

        const streamFile = async (source, target) => {
            try {
                const downloadArg = asciiSafe(JSON.stringify({ path: source }));
                const uploadArg = asciiSafe(JSON.stringify({ path: target, mode: 'overwrite', autorename: false }));

                const downloadResponse = await fetch('https://content.dropboxapi.com/2/files/download', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Dropbox-API-Arg': downloadArg,
                    },
                });

                if (!downloadResponse.ok || !downloadResponse.body) {
                    throw new Error(`Failed to download ${source}: ${downloadResponse.status}`);
                }

                const uploadResponse = await fetch('https://content.dropboxapi.com/2/files/upload', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/octet-stream',
                        'Dropbox-API-Arg': uploadArg,
                    },
                    body: downloadResponse.body,
                });

                if (!uploadResponse.ok) {
                    throw new Error(`Failed to upload ${target}: ${uploadResponse.status}`);
                }

                console.log(`Successfully streamed ${source} to ${target}`);
            } catch (error) {
                console.error(`Error streaming ${source} to ${target}:`, error);
            }
        };

        const forward = async (file) => {
            const source = `${sourceFolder}/${file}`;
            const target = `${targetFolder}/${file}`;
            const sourceModTime = await getFileMetadata(source);
            const targetModTime = await getFileMetadata(target);

            if (sourceModTime && (!targetModTime || sourceModTime > targetModTime)) {
                await streamFile(source, target);
            } else {
                console.log('Skipping', { source, sourceModTime, targetModTime });
            }
        };

        await Promise.all(entries.map(forward));
    },
} satisfies ExportedHandler<Env>;