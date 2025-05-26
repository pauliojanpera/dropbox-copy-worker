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
    const MINUTE = 60000;
    const EXPIRY_BUFFER_MS = MINUTE * 20;
    
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

function asciiSafe(s: string) {
    return s.replace(/[\u007F-\uFFFF]/g, function(chr) {
        return "\\u" + ("0000" + chr.charCodeAt(0).toString(16)).substr(-4);
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
        const archiveFolder = '/Tulostettavat iltarastikartat/Arkisto';
        const jpgEntries = ['a-rata.jpg', 'b-rata.jpg', 'c-rata.jpg', 'opetusrata.jpg', 'kaikki rastit.jpg'];

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
                return true;
            } catch (error) {
                console.error(`Error streaming ${source} to ${target}:`, error);
                return false;
            }
        };

        // Delete a file or folder
        const deletePath = async (path) => {
            try {
                const response = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ path }),
                });

                if (!response.ok) {
                    throw new Error(`Failed to delete ${path}: ${response.status}`);
                }

                console.log(`Successfully deleted ${path}`);
                return true;
            } catch (error) {
                console.error(`Error deleting ${path}:`, error);
                return false;
            }
        };

        // Handle JPG files
        const forwardJpg = async (file) => {
            const source = `${sourceFolder}/${file}`;
            const target = `${targetFolder}/${file}`;
            const sourceModTime = await getFileMetadata(source);
            let targetModTime = await getFileMetadata(target);

            if (!sourceModTime) {
                console.log(`Skipping JPG ${source}: source file does not exist`);
                return;
            }

            if (!targetModTime || sourceModTime > targetModTime) {
                const success = await streamFile(source, target);
                if (success) {
                    targetModTime = sourceModTime; // After successful transfer, target has source's mod time
                } else {
                    console.log(`Not deleting ${source}: transfer failed`);
                    return;
                }
            } else {
                console.log('Skipping JPG transfer', { source, sourceModTime, targetModTime });
            }

            // Delete source if target exists and is at least as recent
            if (targetModTime && targetModTime >= sourceModTime) {
                const deleted = await deletePath(source);
                if (!deleted) {
                    console.log(`Failed to delete ${source}, but target copy is recent`);
                }
            } else {
                console.log(`Not deleting ${source}: target copy is not recent`);
            }
        };

        // List subfolders in sourceFolder
        const listFolder = async (folderPath) => {
            try {
                const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ path: folderPath }),
                });

                if (!response.ok) {
                    throw new Error(`Failed to list folder ${folderPath}: ${response.status}`);
                }

                const data = await response.json();
                return data.entries;
            } catch (error) {
                console.error(`Error listing folder ${folderPath}:`, error);
                return [];
            }
        };

        // Check if folder exists
        const folderExists = async (folderPath) => {
            try {
                const response = await fetch('https://api.dropboxapi.com/2/files/get_metadata', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ path: folderPath }),
                });

                if (!response.ok) {
                    if (response.status === 409) return false; // Folder doesn't exist
                    throw new Error(`Failed to check folder ${folderPath}: ${response.status}`);
                }

                const data = await response.json();
                return data['.tag'] === 'folder';
            } catch (error) {
                console.error(`Error checking folder ${folderPath}:`, error);
                return false;
            }
        };

        // Handle PDF files in year-prefixed subfolders
        const forwardPdfs = async () => {
            const subfolders = await listFolder(sourceFolder);
            const yearRegex = /^20[0-9][0-9]$/;

            for (const entry of subfolders) {
                if (entry['.tag'] !== 'folder') continue;
                const year = entry.name.split('-')[0]; // Extract year from folder name (e.g., "2023-something")
                if (!yearRegex.test(year)) continue;

                const subfolderPath = `${sourceFolder}/${entry.name}`;
                const archiveYearFolder = `${archiveFolder}/${year}`;
                const archiveSubfolder = `${archiveYearFolder}/${entry.name}`;

                // Check if archive year folder and subfolder exist
                const yearFolderExists = await folderExists(archiveYearFolder);
                if (!yearFolderExists) {
                    console.log(`Skipping subfolder ${subfolderPath}: archive year folder ${archiveYearFolder} does not exist`);
                    continue;
                }

                const subfolderExists = await folderExists(archiveSubfolder);
                if (!subfolderExists) {
                    console.log(`Skipping subfolder ${subfolderPath}: archive subfolder ${archiveSubfolder} does not exist`);
                    continue;
                }

                // List PDF files in subfolder
                const files = await listFolder(subfolderPath);
                const pdfFiles = files.filter(file => file['.tag'] === 'file' && file.name.toLowerCase().endsWith('.pdf'));
                let allProcessedSuccessfully = true;

                for (const file of pdfFiles) {
                    const source = `${subfolderPath}/${file.name}`;
                    const target = `${archiveSubfolder}/${file.name}`;
                    const sourceModTime = await getFileMetadata(source);
                    const targetModTime = await getFileMetadata(target);

                    if (sourceModTime && (!targetModTime || sourceModTime > targetModTime)) {
                        const success = await streamFile(source, target);
                        if (!success) {
                            allProcessedSuccessfully = false;
                        }
                    } else {
                        console.log('Skipping PDF', { source, sourceModTime, targetModTime });
                        // If skipped because target is newer or exists, consider it processed
                    }
                }

                // Delete source subfolder if all PDFs were processed successfully
                if (allProcessedSuccessfully && pdfFiles.length > 0) {
                    const deleted = await deletePath(subfolderPath);
                    if (!deleted) {
                        console.log(`Failed to delete subfolder ${subfolderPath}, but PDFs were processed`);
                    }
                } else if (pdfFiles.length === 0) {
                    console.log(`No PDFs found in ${subfolderPath}, skipping deletion`);
                } else {
                    console.log(`Not deleting ${subfolderPath} due to processing errors`);
                }
            }
        };

        // Execute both JPG and PDF forwarding
        await Promise.all([
            ...jpgEntries.map(forwardJpg),
            forwardPdfs(),
        ]);
    },
} satisfies ExportedHandler<Env>;