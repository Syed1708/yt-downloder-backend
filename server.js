const express = require('express');
const cors = require('cors');
const youtubedl = require('youtube-dl-exec');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// Locate cookies file (Render places Secret Files in /etc/secrets/)
const getCookiesPath = () => {
  const renderSecretPath = '/etc/secrets/cookies.txt';
  const localPath = path.resolve(__dirname, 'cookies.txt');

  if (fs.existsSync(renderSecretPath)) {
    return renderSecretPath;
  }
  if (fs.existsSync(localPath)) {
    return localPath;
  }
  return null;
};

const getOptions = () => {
  const cookiePath = getCookiesPath();
  const options = {
    noCheckCertificates: true,
    noWarnings: true,
    preferFreeFormats: true,
    // Use Android/iOS clients which bypass desktop web bot challenges
    extractorArgs: 'youtube:player_client=android,ios',
  };

  if (cookiePath) {
    options.cookies = cookiePath;
  }

  return options;
};

// --- ROOT ROUTE ---
app.get('/', (req, res) => {
  const hasCookies = Boolean(getCookiesPath());
  res.send(`
    <h1>YouTube Downloader API is Running</h1>
    <p>Cookie Status: ${hasCookies ? '✅ Loaded' : '❌ Not Found'}</p>
  `);
});

// --- 1. ENDPOINT TO FETCH VIDEO INFO ---
app.post('/api/info', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Please provide a valid YouTube URL.' });
  }

  console.log(`[INFO] Fetching metadata for: ${url}`);

  try {
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      ...getOptions(),
    });

    const formats = (info.formats || [])
      .filter((f) => f.vcodec !== 'none' && f.resolution)
      .map((f) => ({
        itag: f.format_id,
        quality: f.resolution || f.format_note || 'Video',
        container: f.ext || 'mp4',
      }));

    const uniqueFormats = Array.from(
      new Map(formats.map((f) => [f.quality, f])).values()
    );

    console.log(`[SUCCESS] Extracted: "${info.title}"`);

    res.json({
      title: info.title,
      thumbnail: info.thumbnail,
      duration: String(info.duration),
      formats: uniqueFormats,
    });
  } catch (error) {
    console.error('--- EXTRACTION ERROR ---');
    console.error(error.stderr || error.message || error);
    console.error('------------------------');

    res.status(500).json({
      error: error.stderr || error.message || 'Failed to retrieve video metadata.',
    });
  }
});

// --- 2. ENDPOINT TO STREAM DOWNLOAD ---
app.get('/api/download', (req, res) => {
  const { url, itag, title } = req.query;

  const safeTitle = (title || 'video').replace(/[^a-zA-Z0-9_-]/g, '_');

  res.header('Content-Disposition', `attachment; filename="${safeTitle}.mp4"`);
  res.header('Content-Type', 'video/mp4');

  const subprocess = youtubedl.exec(url, {
    format: `${itag}+bestaudio/best`,
    output: '-',
    ...getOptions(),
  });

  subprocess.stdout.pipe(res);

  subprocess.stderr.on('data', (data) => {
    console.log(`yt-dlp: ${data.toString()}`);
  });

  subprocess.on('error', (err) => {
    console.error('[DOWNLOAD ERROR]:', err);
  });

  req.on('close', () => {
    subprocess.kill('SIGTERM');
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});