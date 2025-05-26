export default {
	async fetch(req) {
		const url = new URL(req.url);
		url.pathname = '/__scheduled';
		url.searchParams.append('cron', '* * * * *');
		return new Response(
			`To test the scheduled handler, ensure you have used the "--test-scheduled" then try running "curl ${url.href}".`
		);
	},

	async scheduled(event, env, ctx): Promise<void> {
		const sourceFolder = '/Tulostus/Järjestelmä';
		const targetFolder = '/Tulostettavat iltarastikartat';
		const entries = ['a-rata.jpg', 'b-rata.jpg', 'c-rata.jpg', 'opetusrata.jpg', 'kaikki rastit.jpg'];

		const getFileMetadata = async (filePath: string) => {
			try {
				const response = await fetch('https://api.dropboxapi.com/2/files/get_metadata', {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${env.DROPBOX_TOKEN}`,
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

		const streamFile = async (source: string, target: string) => {
			try {
				// Ensure ASCII-compatible JSON encoding for Dropbox-API-Arg
				const downloadArg = JSON.stringify({ path: source });
				const uploadArg = JSON.stringify({ path: target, mode: 'overwrite', autorename: false });

				// Initiate download stream
				const downloadResponse = await fetch('https://content.dropboxapi.com/2/files/download', {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${env.DROPBOX_TOKEN}`,
						'Dropbox-API-Arg': downloadArg,
					},
				});

				if (!downloadResponse.ok || !downloadResponse.body) {
					throw new Error(`Failed to download ${source}: ${downloadResponse.status}`);
				}

				// Stream the download directly to the upload
				const uploadResponse = await fetch('https://content.dropboxapi.com/2/files/upload', {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${env.DROPBOX_TOKEN}`,
						'Content-Type': 'application/octet-stream',
						'Dropbox-API-Arg': uploadArg,
					},
					body: downloadResponse.body, // Stream the body directly
				});

				if (!uploadResponse.ok) {
					throw new Error(`Failed to upload ${target}: ${uploadResponse.status}`);
				}

				console.log(`Successfully streamed ${source} to ${target}`);
			} catch (error) {
				console.error(`Error streaming ${source} to ${target}:`, error);
			}
		};

		const forward = async (file: string) => {
			const source = `${sourceFolder}/${file}`;
			const target = `${targetFolder}/${file}`;
			const sourceModTime = await getFileMetadata(source);
			const targetModTime = await getFileMetadata(target);

			if (sourceModTime && (!targetModTime || sourceModTime > targetModTime)) {
				await streamFile(source, target);
			} else {
				console.log('Skipping', source);
			}
		};

		await Promise.all(entries.map(forward));
	},
} satisfies ExportedHandler<Env>;