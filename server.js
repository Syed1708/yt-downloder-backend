const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// List of public Invidious instances with automatic fallback
const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://yewtu.be',
  'https://invidious.privacydev.net',
  'https://iv.melmac.space',
  'https://invidious.nerdvpn.de',
];

// Helper to extract YouTube Video ID
const extractVideoId = (url) => {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
};

// Fetch video data across multiple instances
const fetchInvidiousData = async (videoId) => {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      console.log(`[ENGINE] Trying instance: ${instance}`);
      const response = await fetch(`${instance}/api/v1/videos/${videoId}`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(6000),
      });

      if (response.ok) {
        const data = await response.json();
        if (data && data.formatStreams && data.formatStreams.length > 0) {
          console.log(`[ENGINE] ✅ Success using: ${instance}`);
          return data;
        }
      }
    } catch (e) {
      console.warn(`[ENGINE] ⚠️ Instance ${instance} failed: ${e.message}`);
    }
  }
  throw new Error('All media engines are currently busy. Please try again in a moment.');
};

// --- ROOT ROUTE ---
app.get('/', (req, res) => {
  res.send('<h1>✅ YouTube Downloader API is Live (Invidious Engine)</h1>');
});

// --- 1. ENDPOINT TO FETCH VIDEO INFO ---
app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  const videoId = extractVideoId(url);

  if (!videoId) {
    return res.status(400).json({ error: 'Please provide a valid YouTube URL.' });
  }

  console.log(`[INFO] Fetching metadata for ID: ${videoId}`);

  try {
    const data = await fetchInvidiousData(videoId);

    // Extract playable MP4 progressive streams (video + audio merged)
    const formats = (data.formatStreams || []).map((f) => ({
      itag: f.itag || f.qualityLabel,
      quality: f.qualityLabel || f.resolution || 'MP4 Video',
      container: f.container || 'mp4',
    }));

    // Keep unique quality options (e.g. 720p, 360p)
    const uniqueFormats = Array.from(
      new Map(formats.map((f) => [f.quality, f])).values()
    );

    const thumbnails = data.videoThumbnails || [];
    const bestThumbnail = thumbnails.length > 0 
      ? thumbnails[0].url 
      : `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

    res.json({
      title: data.title || 'YouTube Video',
      thumbnail: bestThumbnail,
      duration: String(data.lengthSeconds || 0),
      formats: uniqueFormats,
    });
  } catch (err) {
    console.error('[EXTRACTION ERROR]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- 2. ENDPOINT TO STREAM DOWNLOAD DIRECTLY ---
app.get('/api/download', async (req, res) => {
  const { url, itag, title } = req.query;
  const videoId = extractVideoId(url);

  if (!videoId) {
    return res.status(400).send('Invalid video URL');
  }

  console.log(`[DOWNLOAD] Streaming video ID: ${videoId}`);

  try {
    const data = await fetchInvidiousData(videoId);
    
    // Find requested format or fallback to best available
    const format = (data.formatStreams || []).find((f) => String(f.itag) === String(itag)) || data.formatStreams[0];

    if (!format || !format.url) {
      return res.status(404).send('Stream format not available.');
    }

    const safeTitle = (title || data.title || 'video').replace(/[^a-zA-Z0-9_-]/g, '_');

    res.header('Content-Disposition', `attachment; filename="${safeTitle}.mp4"`);
    res.header('Content-Type', 'video/mp4');

    // Fetch video stream from direct CDN
    const videoStream = await fetch(format.url);
    
    if (!videoStream.ok) {
      return res.status(videoStream.status).send('Failed to read video stream from CDN.');
    }

    // Pipe the web stream to response
    const { Readable } = require('stream');
    Readable.fromWeb(videoStream.body).pipe(res);
  } catch (err) {
    console.error('[DOWNLOAD ERROR]:', err.message);
    res.status(500).send('Failed to download video stream.');
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});