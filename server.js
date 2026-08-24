const express = require('express');
const cors = require('cors');
const youtubedl = require('youtube-dl-exec');

const app = express();
app.use(cors());
app.use(express.json());

// --- ROOT ROUTE ---
app.get('/', (req, res) => {
  res.send('<h1>✅ YouTube Downloader API is running!</h1>');
});

// --- 1. ENDPOINT TO FETCH VIDEO INFO ---
app.post('/api/info', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'Please provide a valid YouTube URL.' });
    }

    // Extract complete video metadata using yt-dlp
    const info = await youtubedl(url, {
      dumpSingleJson: true,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
    });

    // Filter available video formats
    const formats = (info.formats || [])
      .filter((f) => f.vcodec !== 'none' && f.resolution)
      .map((f) => ({
        itag: f.format_id,
        quality: f.resolution || f.format_note || 'Video',
        container: f.ext || 'mp4',
      }));

    // Deduplicate format labels (e.g. 720p, 1080p, 360p)
    const uniqueFormats = Array.from(
      new Map(formats.map((f) => [f.quality, f])).values()
    );

    res.json({
      title: info.title,
      thumbnail: info.thumbnail,
      duration: String(info.duration),
      formats: uniqueFormats,
    });
  } catch (error) {
    console.error('Extraction Error:', error);
    res.status(500).json({ error: error.stderr || error.message || 'Failed to extract video' });
  }
});

// --- 2. ENDPOINT TO STREAM DOWNLOAD ---
app.get('/api/download', (req, res) => {
  const { url, itag, title } = req.query;

  const safeTitle = (title || 'video').replace(/[^a-zA-Z0-9_-]/g, '_');

  res.header('Content-Disposition', `attachment; filename="${safeTitle}.mp4"`);
  res.header('Content-Type', 'video/mp4');

  // Stream video directly to the client via stdout
  const subprocess = youtubedl.exec(url, {
    format: `${itag}+bestaudio/best`,
    output: '-', // Pipe output to stdout
  });

  subprocess.stdout.pipe(res);

  subprocess.stderr.on('data', (data) => {
    console.log(`yt-dlp: ${data.toString()}`);
  });

  req.on('close', () => {
    subprocess.kill('SIGTERM');
  });
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
});