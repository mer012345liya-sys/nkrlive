module.exports = {
  // X / Twitter — developer.x.com (Basic tier required for recent search)
  TWITTER_BEARER_TOKEN: process.env.TWITTER_BEARER_TOKEN || '',

  // NewsAPI — newsapi.org (free dev key, 100 req/day)
  NEWS_API_KEY: process.env.NEWS_API_KEY || '',

  // CricAPI — cricapi.com (free tier: 100 req/day)
  CRIC_API_KEY: process.env.CRIC_API_KEY || '',

  // YouTube Data API v3 — console.cloud.google.com (10,000 units/day free)
  YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY || '',

  // Gemini API — aistudio.google.com (free tier; also powers Vision image analysis)
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',

  // Google Custom Search — developers.google.com/custom-search/v1
  // Create a Programmable Search Engine at cse.google.com (free: 100 queries/day)
  // Set it to search ALL the web; site: operator handles scoping per query.
  GOOGLE_CSE_API_KEY: process.env.GOOGLE_CSE_API_KEY || '',
  GOOGLE_CSE_CX:      process.env.GOOGLE_CSE_CX      || '', // your Search Engine ID (cx)
};
