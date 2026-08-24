const express = require('express');
const cors = require('cors');
const youtubedl = require('youtube-dl-exec');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const COOKIES_PATH = path.resolve(__dirname, 'cookies.txt');

const getOptions = () => {
  const options = {
    noCheckCertificates: true,
    noWarnings: true,
    preferFreeFormats: true,
    // 👇 Key Fix: Pretend to be YouTube Android app to bypass bot checks
    extractorArgs: 'youtube:player_client=android,web',
  };

  if (fs.existsSync(COOKIES_PATH)) {
    options.cookies = COOKIES_PATH;
  }

  return options;
};

// --- ROOT ROUTE ---
app.get('/', (req, res) => {
  res.send('<h1>✅ YouTube Downloader API is Running</h1>');
});

// --- 1. ENDPOINT TO FETCH VIDEO INFO ---
app.post('/api/info', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Please provide a valid YouTube URL.' });
  }

  console.log(`[INFO] Fetching info for: ${url}`);

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

    // Keep unique quality labels (e.g. 720p, 1080p, 360p)
    const uniqueFormats = Array.from(
      new Map(formats.map((f) => [f.quality, f])).values()
    );

    console.log(`[SUCCESS] Found ${uniqueFormats.length} formats for: ${info.title}`);

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
      error: error.stderr || error.message || 'Failed to retrieve video info from YouTube.' 
    });
  }
});

// --- 2. ENDPOINT TO STREAM DOWNLOAD ---
app.get('/api/download', (req, res) => {
  const { url, itag, title } = req.query;

  console.log(`[DOWNLOAD] Starting download for itag ${itag}: ${url}`);

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
    console.log(`yt-dlp log: ${data.toString()}`);
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