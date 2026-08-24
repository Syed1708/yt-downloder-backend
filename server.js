const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// List of public Invidious instances for reliable fallback
const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://yt.chocolatemoo53.com',
  'https://invidious.tiekoetter.com',
];

// Helper to extract YouTube Video ID
const extractVideoId = (url) => {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
};

// Fetch video data with automatic instance fallback
const fetchInvidiousData = async (videoId) => {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const response = await fetch(`${instance}/api/v1/videos/${videoId}`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000), // 5 second timeout per instance
      });

      if (response.ok) {
        const data = await response.json();
        if (data && data.formatStreams && data.formatStreams.length > 0) {
          return data;
        }
      }
    } catch (e) {
      console.warn(`Instance ${instance} failed, trying next...`);
    }
  }
  throw new Error('All stream engines are currently busy. Please try again.');
};

// --- ROOT ROUTE ---
app.get('/', (req, res) => {
  res.send('<h1>✅ YouTube Downloader API is Live</h1>');
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
      url: f.url, // direct CDN stream URL
    }));

    // Deduplicate format qualities
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
    console.error('Extraction error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to load video.' });
  }
});

// --- 2. ENDPOINT TO STREAM DOWNLOAD DIRECTLY ---
app.get('/api/download', async (req, res) => {
  const { url, itag, title } = req.query;
  const videoId = extractVideoId(url);

  if (!videoId) {
    return res.status(400).send('Invalid video URL');
  }

  console.log(`[DOWNLOAD] Processing download for ID: ${videoId}`);

  try {
    const data = await fetchInvidiousData(videoId);
    
    // Find selected format or fallback to best available progressive format
    const format = (data.formatStreams || []).find((f) => String(f.itag) === String(itag)) || data.formatStreams[0];

    if (!format || !format.url) {
      return res.status(404).send('Selected format stream not available.');
    }

    const safeTitle = (title || data.title || 'video').replace(/[^a-zA-Z0-9_-]/g, '_');

    res.header('Content-Disposition', `attachment; filename="${safeTitle}.mp4"`);
    res.header('Content-Type', 'video/mp4');

    // Pipe the direct CDN video stream to the mobile app
    const videoStream = await fetch(format.url);
    
    if (!videoStream.ok) {
      return res.status(videoStream.status).send('Failed to read video stream from CDN.');
    }

    // Convert fetch stream to Node stream and pipe
    const { Readable } = require('stream');
    Readable.fromWeb(videoStream.body).pipe(res);
  } catch (err) {
    console.error('Download stream error:', err.message);
    res.status(500).send('Failed to download video stream.');
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});