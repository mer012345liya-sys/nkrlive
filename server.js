const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const xml2js = require('xml2js');
const crypto = require('crypto');
const path = require('path');
const config = require('./config');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(__dirname));

// ---------- CONFIG ----------
const POLL_INTERVAL_MS = 12 * 1000; // poll every 12 seconds
const MAX_ITEMS_STORED = 300;

// Multiple sources for cross-verification
// SCOPE RULES:
//   vizagScope: true → only accepted if isStrictlyVizag(title) — VIZAG-ONLY stories
//   apScope: true    → only accepted if isStrictlyAP(title)    — AP (excl. Vizag overlap) stories
//   nkrScope: true   → only accepted if isStrictlyNKR(title)   — NKR-named stories only
const SOURCES = [
  // ── VIZAG: General ──────────────────────────────────────────────────────────
  { name: 'TOI - Vizag',           url: 'https://timesofindia.indiatimes.com/rssfeeds/4737368.cms',                                                                                                                                             type:'rss', category:'general',      vizagScope:true  },
  { name: 'GNews - Vizag General', url: 'https://news.google.com/rss/search?q=Visakhapatnam+OR+Vizag+when:1d&hl=en-IN&gl=IN&ceid=IN:en',                                                                                                       type:'rss', category:'general',      vizagScope:true  },

  // ── VIZAG: Sports ───────────────────────────────────────────────────────────
  { name: 'GNews - Vizag Sports',  url: 'https://news.google.com/rss/search?q=%22Visakhapatnam%22+OR+%22Vizag%22+sports+OR+cricket+OR+kabaddi+OR+football+OR+volleyball+OR+athletics+when:2d&hl=en-IN&gl=IN&ceid=IN:en',                       type:'rss', category:'sports',       vizagScope:true  },

  // ── VIZAG: Civic ────────────────────────────────────────────────────────────
  { name: 'GNews - Vizag Civic',   url: 'https://news.google.com/rss/search?q=%22Visakhapatnam%22+GVMC+OR+traffic+OR+roads+OR+water+OR+power+OR+civic+OR+metro+when:2d&hl=en-IN&gl=IN&ceid=IN:en',                                            type:'rss', category:'civic',        vizagScope:true  },

  // ── VIZAG: Politics ─────────────────────────────────────────────────────────
  { name: 'GNews - Vizag Politics',url: 'https://news.google.com/rss/search?q=%22Visakhapatnam%22+OR+%22Vizag%22+%22TDP%22+OR+%22YSRCP%22+OR+%22Jana+Sena%22+OR+%22MLA%22+OR+%22MP%22+OR+%22election%22+when:1d&hl=en-IN&gl=IN&ceid=IN:en', type:'rss', category:'politics',     vizagScope:true  },

  // ── VIZAG: Crime ────────────────────────────────────────────────────────────
  { name: 'GNews - Vizag Crime',   url: 'https://news.google.com/rss/search?q=%22Visakhapatnam%22+OR+%22Vizag%22+murder+OR+rape+OR+robbery+OR+fraud+OR+arrested+OR+kidnap+OR+drugs+OR+FIR+when:1d&hl=en-IN&gl=IN&ceid=IN:en',                 type:'rss', category:'crime',        vizagScope:true  },

  // ── VIZAG: Achievements ─────────────────────────────────────────────────────
  { name: 'GNews - Vizag Achieve', url: 'https://news.google.com/rss/search?q=%22Visakhapatnam%22+OR+%22Vizag%22+award+OR+medal+OR+topper+OR+UPSC+OR+JEE+OR+NEET+OR+record+OR+honour+when:3d&hl=en-IN&gl=IN&ceid=IN:en',                     type:'rss', category:'achievements', vizagScope:true  },

  // ── VIZAG: Agriculture ──────────────────────────────────────────────────────
  { name: 'GNews - Vizag Agri',    url: 'https://news.google.com/rss/search?q=%22Visakhapatnam%22+OR+%22Vizag%22+farmer+OR+fisheries+OR+aquaculture+OR+agriculture+OR+crop+OR+prawn+OR+harvest+when:2d&hl=en-IN&gl=IN&ceid=IN:en',            type:'rss', category:'agriculture', vizagScope:true  },

  // ── ANDHRA PRADESH: State / Districts ───────────────────────────────────────
  { name: 'The Hindu - AP',        url: 'https://www.thehindu.com/news/national/andhra-pradesh/feeder/default.rss',                                                                                                                             type:'rss', category:'andhra',       apScope:true  },
  { name: 'TOI - AP',             url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128833038.cms',                                                                                                                                          type:'rss', category:'andhra',       apScope:true  },
  { name: 'Deccan Chronicle - AP', url: 'https://www.deccanchronicle.com/feeds/andhra-pradesh.xml',                                                                                                                                             type:'rss', category:'andhra',       apScope:true  },
  { name: 'GNews - AP State',      url: 'https://news.google.com/rss/search?q=%22Andhra+Pradesh%22+when:1d&hl=en-IN&gl=IN&ceid=IN:en',                                                                                                        type:'rss', category:'andhra',       apScope:true  },
  { name: 'GNews - AP Coastal',    url: 'https://news.google.com/rss/search?q=%22Andhra+Pradesh%22+Anakapalli+OR+Bapatla+OR+Rajahmundry+OR+Eluru+OR+Guntur+OR+Kakinada+OR+Vijayawada+OR+Machilipatnam+OR+Ongole+OR+Nellore+OR+Bhimavaram+when:1d&hl=en-IN&gl=IN&ceid=IN:en', type:'rss', category:'andhra', apScope:true },
  { name: 'GNews - AP Rayalaseema',url: 'https://news.google.com/rss/search?q=%22Andhra+Pradesh%22+Anantapur+OR+Chittoor+OR+Kurnool+OR+Nandyal+OR+Tirupati+OR+Kadapa+OR+Srikakulam+OR+Vizianagaram+OR+Parvathipuram+when:1d&hl=en-IN&gl=IN&ceid=IN:en', type:'rss', category:'andhra', apScope:true },

  // ── ANDHRA PRADESH: Sports ──────────────────────────────────────────────────
  { name: 'GNews - AP Sports',     url: 'https://news.google.com/rss/search?q=%22Andhra+Pradesh%22+sports+OR+cricket+OR+kabaddi+OR+football+OR+volleyball+OR+athlete+OR+tournament+when:2d&hl=en-IN&gl=IN&ceid=IN:en',                        type:'rss', category:'sports',       apScope:true  },
  { name: 'GNews - Andhra Cricket',url: 'https://news.google.com/rss/search?q=%22Andhra+Cricket%22+OR+%22ACA%22+OR+%22Andhra+Pradesh%22+cricket+when:2d&hl=en-IN&gl=IN&ceid=IN:en',                                                           type:'rss', category:'sports',       apScope:true  },
  { name: 'GNews - AP Athletes',   url: 'https://news.google.com/rss/search?q=%22Andhra+Pradesh%22+medal+OR+championship+OR+badminton+OR+wrestling+OR+boxing+OR+kabaddi+OR+hockey+when:3d&hl=en-IN&gl=IN&ceid=IN:en',                         type:'rss', category:'sports',       apScope:true  },

  // ── ANDHRA PRADESH: Politics ────────────────────────────────────────────────
  { name: 'GNews - AP Politics',   url: 'https://news.google.com/rss/search?q=%22Andhra+Pradesh%22+%22TDP%22+OR+%22YSRCP%22+OR+%22Jana+Sena%22+OR+%22BJP%22+OR+%22MLA%22+OR+%22MP%22+when:1d&hl=en-IN&gl=IN&ceid=IN:en',                    type:'rss', category:'politics',     apScope:true  },
  { name: 'GNews - AP CM Cabinet', url: 'https://news.google.com/rss/search?q=%22Andhra+Pradesh%22+%22Chandrababu%22+OR+%22Pawan+Kalyan%22+OR+%22Chief+Minister%22+OR+%22cabinet%22+when:1d&hl=en-IN&gl=IN&ceid=IN:en',                       type:'rss', category:'politics',     apScope:true  },
  { name: 'GNews - AP Assembly',   url: 'https://news.google.com/rss/search?q=%22Andhra+Pradesh%22+%22assembly%22+OR+%22Lok+Sabha%22+OR+%22election%22+OR+%22by-election%22+when:1d&hl=en-IN&gl=IN&ceid=IN:en',                               type:'rss', category:'politics',     apScope:true  },
  { name: 'GNews - AP Govt Policy',url: 'https://news.google.com/rss/search?q=%22Andhra+Pradesh%22+government+policy+OR+budget+OR+scheme+OR+welfare+when:1d&hl=en-IN&gl=IN&ceid=IN:en',                                                       type:'rss', category:'politics',     apScope:true  },

  // ── ANDHRA PRADESH: Crime ───────────────────────────────────────────────────
  { name: 'GNews - AP Crime 1',    url: 'https://news.google.com/rss/search?q=%22Andhra+Pradesh%22+murder+OR+rape+OR+assault+OR+molestation+when:1d&hl=en-IN&gl=IN&ceid=IN:en',                                                               type:'rss', category:'crime',        apScope:true  },
  { name: 'GNews - AP Crime 2',    url: 'https://news.google.com/rss/search?q=%22Andhra+Pradesh%22+kidnap+OR+abduction+OR+missing+OR+trafficking+when:1d&hl=en-IN&gl=IN&ceid=IN:en',                                                          type:'rss', category:'crime',        apScope:true  },
  { name: 'GNews - AP Crime 3',    url: 'https://news.google.com/rss/search?q=%22Andhra+Pradesh%22+domestic+violence+OR+dowry+OR+suicide+when:1d&hl=en-IN&gl=IN&ceid=IN:en',                                                                  type:'rss', category:'crime',        apScope:true  },
  { name: 'GNews - AP Crime 4',    url: 'https://news.google.com/rss/search?q=%22Andhra+Pradesh%22+drugs+OR+ganja+OR+narcotics+OR+robbery+OR+fraud+OR+arrested+when:1d&hl=en-IN&gl=IN&ceid=IN:en',                                            type:'rss', category:'crime',        apScope:true  },

  // ── ANDHRA PRADESH: Achievements ────────────────────────────────────────────
  { name: 'GNews - AP Awards',     url: 'https://news.google.com/rss/search?q=%22Andhra+Pradesh%22+award+OR+honour+OR+medal+OR+record+OR+topper+when:3d&hl=en-IN&gl=IN&ceid=IN:en',                                                           type:'rss', category:'achievements', apScope:true  },
  { name: 'GNews - AP Education',  url: 'https://news.google.com/rss/search?q=%22Andhra+Pradesh%22+UPSC+OR+NEET+OR+JEE+OR+IIT+OR+civil+services+OR+topper+when:3d&hl=en-IN&gl=IN&ceid=IN:en',                                                 type:'rss', category:'achievements', apScope:true  },
  { name: 'GNews - AP Milestones', url: 'https://news.google.com/rss/search?q=%22Andhra+Pradesh%22+inauguration+OR+commissioned+OR+world+record+OR+first+in+India+OR+best+state+when:3d&hl=en-IN&gl=IN&ceid=IN:en',                           type:'rss', category:'achievements', apScope:true  },

  // ── ANDHRA PRADESH: Agriculture ─────────────────────────────────────────────
  { name: 'GNews - AP Farmers',    url: 'https://news.google.com/rss/search?q=%22Andhra+Pradesh%22+farmer+OR+paddy+OR+crop+OR+harvest+OR+kharif+OR+rabi+OR+agriculture+when:2d&hl=en-IN&gl=IN&ceid=IN:en',                                    type:'rss', category:'agriculture', apScope:true  },
  { name: 'GNews - AP Irrigation', url: 'https://news.google.com/rss/search?q=%22Andhra+Pradesh%22+OR+Polavaram+irrigation+OR+drought+OR+%22Krishna+river%22+OR+Godavari+OR+%22Nagarjuna+Sagar%22+when:2d&hl=en-IN&gl=IN&ceid=IN:en',         type:'rss', category:'agriculture', apScope:true  },
  { name: 'GNews - AP Fisheries',  url: 'https://news.google.com/rss/search?q=%22Andhra+Pradesh%22+fisheries+OR+aquaculture+OR+prawn+OR+shrimp+OR+horticulture+OR+mango+OR+groundnut+when:2d&hl=en-IN&gl=IN&ceid=IN:en',                      type:'rss', category:'agriculture', apScope:true  },

  // ── NKR: Nitish Kumar Reddy ONLY ────────────────────────────────────────────
  { name: 'GNews - NKR',           url: 'https://news.google.com/rss/search?q=%22Nitish+Kumar+Reddy%22+when:3d&hl=en-IN&gl=IN&ceid=IN:en',                                                                                                    type:'rss', category:'nkr',          nkrScope:true },
  { name: 'GNews - NKR Global',    url: 'https://news.google.com/rss/search?q=%22Nitish+Kumar+Reddy%22+cricket+when:3d&hl=en&gl=US&ceid=US:en',                                                                                               type:'rss', category:'nkr',          nkrScope:true },
  { name: 'GNews - Nitish Reddy',  url: 'https://news.google.com/rss/search?q=%22Nitish+Reddy%22+cricket+when:3d&hl=en-IN&gl=IN&ceid=IN:en',                                                                                                  type:'rss', category:'nkr',          nkrScope:true },
  { name: 'GNews - NKR SRH',       url: 'https://news.google.com/rss/search?q=%22Nitish+Kumar+Reddy%22+Sunrisers+when:3d&hl=en-IN&gl=IN&ceid=IN:en',                                                                                         type:'rss', category:'nkr',          nkrScope:true },
  { name: 'Reddit - NKR',          url: 'https://www.reddit.com/search.rss?q=%22Nitish+Kumar+Reddy%22&sort=new',                                                                                                                               type:'rss', category:'nkr',          nkrScope:true },
  { name: 'Reddit - Nitish Reddy', url: 'https://www.reddit.com/search.rss?q=%22Nitish+Reddy%22&sort=new',                                                                                                                                     type:'rss', category:'nkr',          nkrScope:true },
  { name: 'Cricbuzz - NKR',        url: 'https://news.google.com/rss/search?q=%22Nitish+Kumar+Reddy%22+site:cricbuzz.com+when:3d&hl=en-IN&gl=IN&ceid=IN:en',                                                                                  type:'rss', category:'nkr',          nkrScope:true },
  { name: 'ESPNcricinfo - NKR',    url: 'https://news.google.com/rss/search?q=%22Nitish+Kumar+Reddy%22+site:espncricinfo.com+when:3d&hl=en-IN&gl=IN&ceid=IN:en',                                                                              type:'rss', category:'nkr',          nkrScope:true },
  { name: 'GNews - NKR Presser',   url: 'https://news.google.com/rss/search?q=%22Nitish+Reddy%22+presser+OR+%22press+conference%22+OR+interview+when:3d&hl=en-IN&gl=IN&ceid=IN:en',                                                           type:'rss', category:'nkr',          nkrScope:true },
  { name: 'GNews - NKR Events',    url: 'https://news.google.com/rss/search?q=%22Nitish+Kumar+Reddy%22+event+OR+awards+OR+launch+OR+sponsor+when:7d&hl=en-IN&gl=IN&ceid=IN:en',                                                               type:'rss', category:'nkr',          nkrScope:true },
  { name: 'Reddit r/Cricket - NKR',url: 'https://www.reddit.com/r/Cricket/search.rss?q=Nitish+Reddy&sort=new&restrict_sr=1',                                                                                                                   type:'rss', category:'nkr',          nkrScope:true },
  { name: 'Reddit r/IndianCricket',url: 'https://www.reddit.com/r/IndianCricket/search.rss?q=Nitish+Reddy&sort=new&restrict_sr=1',                                                                                                             type:'rss', category:'nkr',          nkrScope:true },
];

// ---------- STATE ----------
const MAX_SEEN_HASHES = 4000; // cap to avoid unbounded memory growth
let seenHashes = new Set();
let seenOrder = []; // tracks insertion order so we can evict the oldest hashes
let newsItems = []; // newest first
let lastPollAt = null;
let lastPollError = null;
const startedAt = new Date();

function hashItem(title, link) {
  return crypto.createHash('md5').update((title + link).toLowerCase()).digest('hex');
}

function rememberHash(h) {
  seenHashes.add(h);
  seenOrder.push(h);
  if (seenOrder.length > MAX_SEEN_HASHES) {
    const evicted = seenOrder.shift();
    seenHashes.delete(evicted);
  }
}

// Strip the " - SourceName" / " | SourceName" suffix many feeds append, and
// normalize whitespace/punctuation so the same story from different outlets
// (or the same outlet re-served with a slightly different link) hashes the same.
function normalizeTitle(title) {
  return (title || '')
    .toLowerCase()
    .replace(/\s*[-|–—]\s*[a-z0-9.\s]+$/i, '') // trailing " - Cricbuzz", " | MSN", etc.
    .replace(/^watch:\s*/i, '')
    .replace(/^\[image analysis\]\s*/i, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Strip Google News redirect/tracking params so the same article re-served
// with a fresh redirect token doesn't look like a brand-new link.
function normalizeLink(link) {
  if (!link) return '';
  try {
    const u = new URL(link);
    if (u.hostname.includes('news.google.com')) {
      // Google News article links are opaque tokens that change on re-crawl;
      // collapse to host+pathname (drop query/fragment) to dedupe re-serves.
      return u.hostname + u.pathname;
    }
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return link;
  }
}


// ── STRICT SCOPE FILTERS ─────────────────────────────────────────────────────
// isStrictlyVizag: title MUST mention Vizag/Visakhapatnam explicitly
function isVizagRelated(title) {
  return /vizag|visakhapatnam|waltair|gajuwaka|rushikonda|simhachalam|bheemili|gvmc/i.test(title);
}
function isStrictlyVizag(title) {
  return /vizag|visakhapatnam|waltair|gajuwaka|rushikonda|simhachalam|bheemili|gvmc/i.test(title);
}

// isStrictlyAP: title must mention AP, an AP district/city, or AP-specific term.
// Excludes items that are purely about NKR personally (those go to NKR category).
// Also excludes Hyderabad (Telangana) unless combined with AP context.

// AP-wide keyword filter: any AP story should mention at least one of these
// terms in its headline. Used to drop off-topic items from apScope sources.
// AP_KEYWORDS: comprehensive set of AP identifiers so that sports and agri
// headlines that say "AP" or "SRH" or "Godavari" or "Sunrisers" still pass.
// Note: \bAP\b is intentionally included — it's the standard abbreviation used
// in all AP news. "Sunrisers Hyderabad" / "SRH" are the AP IPL team.
// Godavari, Krishna, Tungabhadra are AP rivers dominating agri headlines.
const AP_KEYWORDS = /andhra\s*pradesh|\bandhra\b|\bAP\b|visakhapatnam|vizag|vijayawada|guntur|nellore|tirupati|kurnool|kakinada|rajahmundry|rajamahendravaram|eluru|ongole|chittoor|kadapa|anantapur|srikakulam|vizianagaram|bhimavaram|machilipatnam|narasaraopet|bapatla|anakapalli|parvathipuram|amalapuram|konaseema|nandyal|palnadu|puttaparthi|chandrababu|pawan\s*kalyan|\bysrcp\b|\btdp\b|jana\s*sena|\bgvmc\b|polavaram|sunrisers\s*hyderabad|\bSRH\b|godavari|krishna\s*(river|district|waters|basin)|tungabhadra|nagarjuna\s*sagar|rythu|rytu|rabi\s*(crop|season|paddy)|kharif\s*(crop|season|paddy)/i;

function isAPRelated(title) {
  if (!AP_KEYWORDS.test(title)) return false;
  // Reject items that are only about Hyderabad/Telangana with no AP mention
  const t = title.toLowerCase();
  if (/\bhyderabad\b/.test(t) && !/andhra|\bap\b|visakhapatnam|vizag|vijayawada|guntur|nellore|tirupati/.test(t)) return false;
  return true;
}
function isStrictlyAP(title) { return isAPRelated(title); }

// ---------- ANDHRA PRADESH 26-DISTRICT MAP ----------
// Post-2022 reorganisation districts, grouped by region, with alias terms
// (old district names, HQ towns, common spellings) so headlines that mention
// a town rather than the formal district name still get matched correctly.
const AP_DISTRICTS = [
  // Coastal Andhra
  { key: 'anakapalli',        name: 'Anakapalli',                 region: 'Coastal Andhra', aliases: ['anakapalli', 'anakapalle'] },
  { key: 'bapatla',           name: 'Bapatla',                    region: 'Coastal Andhra', aliases: ['bapatla', 'chirala', 'tenali'] },
  { key: 'konaseema',         name: 'Dr. B.R. Ambedkar Konaseema', region: 'Coastal Andhra', aliases: ['konaseema', 'amalapuram', 'ambedkar konaseema'] },
  { key: 'east-godavari',     name: 'East Godavari',              region: 'Coastal Andhra', aliases: ['east godavari', 'rajahmundry', 'rajamahendravaram'] },
  { key: 'eluru',             name: 'Eluru',                      region: 'Coastal Andhra', aliases: ['eluru'] },
  { key: 'guntur',            name: 'Guntur',                     region: 'Coastal Andhra', aliases: ['guntur'] },
  { key: 'kakinada',          name: 'Kakinada',                   region: 'Coastal Andhra', aliases: ['kakinada'] },
  { key: 'krishna',           name: 'Krishna',                    region: 'Coastal Andhra', aliases: ['krishna district', 'machilipatnam'] },
  { key: 'ntr',               name: 'NTR',                        region: 'Coastal Andhra', aliases: ['ntr district', 'vijayawada'] },
  { key: 'palnadu',           name: 'Palnadu',                     region: 'Coastal Andhra', aliases: ['palnadu', 'narasaraopet', 'palnad'] },
  { key: 'prakasam',          name: 'Prakasam',                   region: 'Coastal Andhra', aliases: ['prakasam', 'ongole'] },
  { key: 'spsr-nellore',      name: 'Sri Potti Sriramulu Nellore', region: 'Coastal Andhra', aliases: ['nellore', 'spsr nellore', 'potti sriramulu nellore'] },
  { key: 'west-godavari',     name: 'West Godavari',              region: 'Coastal Andhra', aliases: ['west godavari', 'bhimavaram', 'eluru west'] },
  // Rayalaseema
  { key: 'ananthapuramu',     name: 'Ananthapuramu',              region: 'Rayalaseema',    aliases: ['anantapur', 'ananthapuramu', 'ananthapur'] },
  { key: 'annamayya',         name: 'Annamayya',                  region: 'Rayalaseema',    aliases: ['annamayya', 'rayachoti', 'rajampet'] },
  { key: 'chittoor',          name: 'Chittoor',                   region: 'Rayalaseema',    aliases: ['chittoor', 'chittor'] },
  { key: 'kurnool',           name: 'Kurnool',                    region: 'Rayalaseema',    aliases: ['kurnool'] },
  { key: 'nandyal',           name: 'Nandyal',                    region: 'Rayalaseema',    aliases: ['nandyal'] },
  { key: 'sri-sathya-sai',    name: 'Sri Sathya Sai',             region: 'Rayalaseema',    aliases: ['sri sathya sai', 'puttaparthi', 'penukonda', 'dharmavaram'] },
  { key: 'tirupati',          name: 'Tirupati',                   region: 'Rayalaseema',    aliases: ['tirupati', 'tirumala'] },
  { key: 'ysr-kadapa',        name: 'YSR Kadapa',                 region: 'Rayalaseema',    aliases: ['kadapa', 'ysr kadapa', 'cuddapah'] },
  // Uttarandhra (North Andhra)
  { key: 'alluri-sitharama-raju', name: 'Alluri Sitharama Raju',  region: 'Uttarandhra',    aliases: ['alluri sitharama raju', 'paderu', 'asr district'] },
  { key: 'parvathipuram-manyam',  name: 'Parvathipuram Manyam',   region: 'Uttarandhra',    aliases: ['parvathipuram manyam', 'parvathipuram', 'salur'] },
  { key: 'srikakulam',        name: 'Srikakulam',                 region: 'Uttarandhra',    aliases: ['srikakulam'] },
  { key: 'visakhapatnam',     name: 'Visakhapatnam',              region: 'Uttarandhra',    aliases: ['visakhapatnam', 'vizag', 'waltair', 'gajuwaka', 'rushikonda', 'simhachalam', 'bheemili', 'gvmc'] },
  { key: 'vizianagaram',      name: 'Vizianagaram',               region: 'Uttarandhra',    aliases: ['vizianagaram'] },
];

const AP_DISTRICT_BY_KEY = new Map(AP_DISTRICTS.map(d => [d.key, d]));

// Pre-compile a single alias->key lookup for fast matching against headlines.
// Longer aliases are checked first so e.g. "ysr kadapa" matches before a
// shorter overlapping alias would.
const AP_DISTRICT_ALIAS_ENTRIES = AP_DISTRICTS
  .flatMap(d => d.aliases.map(a => ({ alias: a, key: d.key })))
  .sort((a, b) => b.alias.length - a.alias.length);

// Returns an array of district keys whose alias terms appear in the title.
// A headline can mention more than one district (e.g. "Vizag-Vijayawada
// expressway"), so this returns all matches rather than just the first.
function matchAndhraDistricts(title) {
  if (!title) return [];
  const t = title.toLowerCase();
  const found = new Set();
  for (const { alias, key } of AP_DISTRICT_ALIAS_ENTRIES) {
    if (t.includes(alias)) found.add(key);
  }
  return [...found];
}

// Detects old completed-match recap/scorecard headlines (e.g. "lose three quick
// wickets, reach 91 runs in 10 overs", "won by 6 wickets", "beat ... by 20 runs").
// Google News frequently re-serves these stale recaps from blocked hosts (MSN,
// Yahoo) with a fresh-looking pubDate. When such a title's date couldn't be
// independently verified (dateUnresolved), it's almost certainly recycled old
// content rather than breaking news — so it gets dropped from "Latest Headlines"
// instead of jumping to the top of the feed.
function isStaleMatchRecap(title) {
  return /\b\d+\s*(runs?|wickets?)\s+in\s+\d+(\.\d+)?\s+overs?\b/i.test(title)
    || /\bwon\s+by\s+\d+\s*(runs?|wickets?)\b/i.test(title)
    || /\bbeat\b.+\bby\s+\d+\s*(runs?|wickets?)\b/i.test(title)
    || /\blose\s+(a|the|three|two|four|five)?\s*(quick\s+)?wickets?\b/i.test(title);
}


// ---------- INSTAGRAM PUBLIC SCRAPER (via picuki.com — no auth needed) ----------
async function fetchInstagramPosts(username) {
  try {
    const url = `https://picuki.com/profile/${username}`;
    const res = await fetch(url, {
      timeout: 14000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' }
    });
    const html = await res.text();
    const posts = [];
    const descRe = /<div class="photo-description">([\s\S]*?)<\/div>/gi;
    let m;
    while ((m = descRe.exec(html)) !== null && posts.length < 8) {
      const caption = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (caption.length > 5) {
        posts.push({
          title: `@${username} on Instagram: ${caption.substring(0, 160)}`,
          link: `https://www.instagram.com/${username}/`,
          pubDate: new Date().toISOString(),
          source: `Instagram @${username}`,
          category: 'nkr',
          broad: false
        });
      }
    }
    if (posts.length > 0) console.log(`[Instagram] Scraped ${posts.length} posts from @${username}`);
    return posts;
  } catch (err) {
    console.error(`Instagram scrape failed @${username}:`, err.message);
    return [];
  }
}

// ---------- CONFIDENCE SCORING ----------
function computeSignalConfidence(sourceName, pubDate) {
  const ageHours = (Date.now() - new Date(pubDate || 0).getTime()) / 3600000;
  let base = 50;
  const sn = sourceName.toLowerCase();
  if (sn.includes('cricapi')) base = 95; // live match confirmed to include NKR in squad
  else if (sn.includes('bcci') || sn.includes('espncricinfo') || sn.includes('cricbuzz')) base = 87;
  else if (sn.includes('press conference') || sn.includes('presser')) base = 92;
  else if (sn.includes('times of india') || sn.includes('the hindu')) base = 80;
  else if (sn.includes('srh') || sn.includes('sunrisers')) base = 82;
  else if (sn.includes('instagram') || sn.includes('youtube')) base = 76;
  else if (sn.includes('twitter') || sn.includes('x.com')) base = 73;
  else if (sn.includes('google news') || sn.includes('google')) base = 65;
  else if (sn.includes('reddit')) base = 54;

  if (ageHours < 2) base = Math.min(98, base + 10);
  else if (ageHours > 24 && ageHours <= 48) base = Math.max(20, base - 15);
  else if (ageHours > 48) base = Math.max(15, base - 28);

  return Math.min(99, base);
}


// ---------- NEWSAPI ----------
// newsapi.org — free dev key, 100 req/day. Returns articles mentioning NKR.
async function fetchNewsAPI() {
  if (!config.NEWS_API_KEY) return [];
  try {
    const q = encodeURIComponent('"Nitish Kumar Reddy" OR "Nitish Reddy" cricket');
    const url = `https://newsapi.org/v2/everything?q=${q}&sortBy=publishedAt&pageSize=20&language=en&apiKey=${config.NEWS_API_KEY}`;
    const res = await fetch(url, { timeout: 10000, headers: { 'User-Agent': 'NKRlive/1.8' } });
    const data = await res.json();
    if (data.status !== 'ok' || !data.articles) return [];
    return data.articles.map(a => ({
      title: a.title || '',
      link: a.url || '',
      pubDate: a.publishedAt || new Date().toISOString(),
      source: `NewsAPI (${a.source?.name || 'unknown'})`,
      category: 'nkr',
      broad: false
    }));
  } catch (err) {
    console.error('[NewsAPI] fetch error:', err.message);
    return [];
  }
}

// ---------- CRICAPI ----------
// cricapi.com — free tier 100 req/day. Pulls live & upcoming matches to lock in venue.
let cricapiCache = null;
let cricapiCacheAt = 0;
const CRICAPI_CACHE_MS = 30 * 60 * 1000; // re-fetch every 30 min

async function fetchCricAPI() {
  if (!config.CRIC_API_KEY) return [];
  const now = Date.now();
  if (cricapiCache && now - cricapiCacheAt < CRICAPI_CACHE_MS) return cricapiCache;
  try {
    const url = `https://api.cricapi.com/v1/currentMatches?apikey=${config.CRIC_API_KEY}&offset=0`;
    const res = await fetch(url, { timeout: 10000, headers: { 'User-Agent': 'NKRlive/1.8' } });
    const data = await res.json();
    if (!data.data) return [];

    const nkrMatches = data.data.filter(m => {
      const teams = ((m.teams || []).join(' ') + ' ' + (m.name || '')).toLowerCase();
      const hasIndia = teams.includes('india');
      const hasNKRSquad = (m.players || []).some(p =>
        (p.name || '').toLowerCase().includes('nitish')
      );
      return hasIndia || hasNKRSquad;
    });

    const items = nkrMatches.map(m => ({
      title: `CricAPI LIVE: Nitish Kumar Reddy's match — ${m.name} at ${m.venue || 'TBD'} — status: ${m.status || 'scheduled'}`,
      link: `https://www.cricapi.com/matches/${m.id}`,
      pubDate: m.date ? new Date(m.date).toISOString() : new Date().toISOString(),
      source: 'CricAPI (live matches)',
      category: 'nkr',
      broad: false,
      _cricVenue: m.venue || ''
    }));

    cricapiCache = items;
    cricapiCacheAt = now;
    if (items.length) console.log(`[CricAPI] ${items.length} India match(es) found.`);
    return items;
  } catch (err) {
    console.error('[CricAPI] fetch error:', err.message);
    return [];
  }
}

// ---------- YOUTUBE DATA API ----------
// developers.google.com/youtube/v3 — free quota 10,000 units/day
async function fetchYouTube() {
  if (!config.YOUTUBE_API_KEY) return [];
  try {
    const q = encodeURIComponent('Nitish Kumar Reddy cricket');
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${q}&order=date&maxResults=10&type=video&key=${config.YOUTUBE_API_KEY}`;
    const res = await fetch(url, { timeout: 10000 });
    const data = await res.json();
    if (!data.items) return [];
    return data.items.map(v => {
      const sn = v.snippet || {};
      const combined = `${sn.title || ''} ${sn.description || ''}`.substring(0, 200);
      return {
        title: `YouTube: ${sn.title || '(untitled)'}`,
        link: `https://www.youtube.com/watch?v=${v.id?.videoId}`,
        pubDate: sn.publishedAt || new Date().toISOString(),
        source: `YouTube (${sn.channelTitle || 'unknown'})`,
        category: 'nkr',
        broad: false,
        _ytDescription: combined
      };
    });
  } catch (err) {
    console.error('[YouTube] fetch error:', err.message);
    return [];
  }
}

// ---------- GEMINI LOCATION INFERENCE ----------
// aistudio.google.com — free tier available. Synthesises all evidence into a
// structured location verdict with confidence and reasoning.
let geminiCache = null;
let geminiCacheAt = 0;
const GEMINI_CACHE_MS = 10 * 60 * 1000; // re-infer every 10 min

async function inferLocationWithGemini(headlines, cricapiVenue, fixtures) {
  if (!config.GEMINI_API_KEY) return null;
  const now = Date.now();
  if (geminiCache && now - geminiCacheAt < GEMINI_CACHE_MS) return geminiCache;

  try {
    const headlineSample = headlines
      .filter(h => h.category === 'nkr' && isGenuineNkrSignal(h))
      .slice(0, 20)
      .map(h => `- [${h.source}] ${h.title}`)
      .join('\n');

    const fixtureStr = fixtures.slice(0, 3).map(f =>
      `${f.date}: ${f.match} at ${f.venue}, ${f.city} (${f.status})`
    ).join('\n');

    const prompt = `You are a cricket analyst. Based ONLY on the evidence below, determine where Indian cricketer Nitish Kumar Reddy (NKR) is most likely located RIGHT NOW.

## Recent Headlines (last 48h)
${headlineSample || 'None available.'}

## Live/Recent Match Data (CricAPI)
${cricapiVenue || 'No live match data.'}

## Upcoming Fixtures
${fixtureStr || 'None.'}

Respond with ONLY valid JSON (no markdown, no explanation outside the JSON):
{
  "city": "<city name>",
  "country": "<country>",
  "venue": "<stadium or area>",
  "confidence": <integer 0-99>,
  "reasoning": "<1-2 sentence explanation citing specific evidence>",
  "primarySignal": "<the single strongest evidence piece>"
}`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.GEMINI_API_KEY}`, {
      method: 'POST',
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 256 }
      })
    });

    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // Strip any accidental markdown fences
    const clean = raw.replace(/```json|```/gi, '').trim();
    const parsed = JSON.parse(clean);
    geminiCache = parsed;
    geminiCacheAt = now;
    console.log(`[Gemini] Location inferred: ${parsed.city} (${parsed.confidence}%)`);
    return parsed;
  } catch (err) {
    console.error('[Gemini] inference error:', err.message);
    return null;
  }
}

// Cache of resolved "true" publish dates for Google News links, keyed by link hash.
// Avoids re-fetching the same article on every 12s poll cycle.
const articleDateCache = new Map();
const MAX_ARTICLE_DATE_CACHE = 2000;

function cacheArticleDate(key, value) {
  articleDateCache.set(key, value);
  if (articleDateCache.size > MAX_ARTICLE_DATE_CACHE) {
    const oldestKey = articleDateCache.keys().next().value;
    articleDateCache.delete(oldestKey);
  }
}

// Hosts known to block scraping (403/anti-bot) where we can never resolve a
// true publish date from the article page. Google News re-serves stories from
// these hosts with a fresh-looking <pubDate> on every re-crawl, even when the
// underlying article is days/weeks old (e.g. an MSN syndicated match recap).
// For these hosts we cannot trust the RSS pubDate as "freshness" — we flag the
// item as dateUnresolved so the poll loop can avoid surfacing it as breaking news.
const UNVERIFIABLE_DATE_HOSTS = /(^|\.)msn\.com$|(^|\.)news\.yahoo\.com$|(^|\.)yahoo\.com$/i;

// Google News RSS stamps items with the time Google (re)crawled/served the item,
// not the article's original publish time. For items that look like Google News
// (or proxy through it), try to resolve the real publish date from the linked
// article's meta tags (article:published_time / og:updated_time / JSON-LD
// datePublished / <time datetime>).
// Returns { pubDate, dateUnresolved } — dateUnresolved is true when we could not
// confirm the real publish date from the article (fetch blocked or no usable tag).
async function resolveTruePubDate(link, rssPubDate) {
  if (!link) return { pubDate: rssPubDate || new Date().toISOString(), dateUnresolved: true };

  const cacheKey = crypto.createHash('md5').update(link).digest('hex');
  if (articleDateCache.has(cacheKey)) {
    return articleDateCache.get(cacheKey);
  }

  let host = '';
  try { host = new URL(link).hostname; } catch { /* ignore */ }

  try {
    const res = await fetch(link, {
      timeout: 6000,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' }
    });

    if (!res.ok) {
      // Blocked (403/etc.) — can't verify. Don't trust the RSS pubDate as fresh
      // for hosts known to re-serve old content under new crawl timestamps.
      const result = {
        pubDate: rssPubDate || new Date().toISOString(),
        dateUnresolved: true
      };
      cacheArticleDate(cacheKey, result);
      return result;
    }

    const html = await res.text();

    let found = null;
    const metaPatterns = [
      /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
      /<meta[^>]+name=["']publish-date["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i,
      /<time[^>]+datetime=["']([^"']+)["']/i
    ];

    for (const re of metaPatterns) {
      const m = html.match(re);
      if (m && m[1]) {
        const d = new Date(m[1]);
        if (!isNaN(d.getTime())) {
          found = d.toISOString();
          break;
        }
      }
    }

    // Fallback: JSON-LD blocks often carry datePublished/dateCreated even when
    // the meta tags above are absent (common on MSN, news aggregators, etc.)
    if (!found) {
      const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
      let m;
      while ((m = ldRe.exec(html)) !== null) {
        try {
          const json = JSON.parse(m[1].trim());
          const candidates = Array.isArray(json) ? json : [json];
          for (const obj of candidates) {
            const raw = obj?.datePublished || obj?.dateCreated || obj?.uploadDate;
            if (raw) {
              const d = new Date(raw);
              if (!isNaN(d.getTime())) { found = d.toISOString(); break; }
            }
          }
        } catch { /* malformed JSON-LD, skip */ }
        if (found) break;
      }
    }

    if (found) {
      const result = { pubDate: found, dateUnresolved: false };
      cacheArticleDate(cacheKey, result);
      return result;
    }

    // No usable date found in the article at all. For hosts we know re-serve
    // stale content (MSN/Yahoo), treat as unresolved rather than trusting the
    // RSS pubDate. For everything else, fall back to RSS pubDate as before.
    const result = UNVERIFIABLE_DATE_HOSTS.test(host)
      ? { pubDate: rssPubDate || new Date().toISOString(), dateUnresolved: true }
      : { pubDate: rssPubDate || new Date().toISOString(), dateUnresolved: false };
    cacheArticleDate(cacheKey, result);
    return result;
  } catch (err) {
    // Resolution failed (timeout, blocked, etc.) — fall back to RSS pubDate
    // but flag as unresolved so it isn't treated as confirmed-fresh.
    const result = { pubDate: rssPubDate || new Date().toISOString(), dateUnresolved: true };
    cacheArticleDate(cacheKey, result);
    return result;
  }
}

async function fetchFeed(source) {
  try {
    const res = await fetch(source.url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const text = await res.text();
    const parsed = await xml2js.parseStringPromise(text, { explicitArray: false });
    const channel = parsed.rss && parsed.rss.channel;
    if (!channel || !channel.item) return [];
    const items = Array.isArray(channel.item) ? channel.item : [channel.item];
    const isGoogleNews = /news\.google\.com/i.test(source.url);

    const mapped = items.map(it => ({
      title: typeof it.title === 'string' ? it.title : (it.title?._ || ''),
      link: it.link || '',
      pubDate: it.pubDate || new Date().toISOString(),
      source: source.name,
      category: source.category,
      broad: source.broad,
      apScope: source.apScope || false,
      vizagOnly: source.vizagOnly || false
    }));

    if (!isGoogleNews) return mapped;

    // For Google News-backed sources, resolve true publish dates (sequentially,
    // with caching, so a single poll cycle doesn't fire dozens of fresh requests).
    const resolved = [];
    for (const item of mapped) {
      const { pubDate: truePubDate, dateUnresolved } = await resolveTruePubDate(item.link, item.pubDate);
      resolved.push({ ...item, pubDate: truePubDate, rssPubDate: item.pubDate, dateUnresolved });
    }
    return resolved;
  } catch (err) {
    console.error(`Error fetching ${source.name}:`, err.message);
    return [];
  }
}

async function fetchTwitter(query, category) {
  if (!config.TWITTER_BEARER_TOKEN) return [];
  try {
    const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=20&tweet.fields=created_at,author_id&expansions=author_id&user.fields=username`;
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${config.TWITTER_BEARER_TOKEN}` }
    });
    const data = await res.json();
    if (!data.data) return [];
    const users = {};
    (data.includes?.users || []).forEach(u => { users[u.id] = u.username; });
    return data.data.map(t => ({
      title: t.text.replace(/\s+/g, ' ').trim(),
      link: `https://twitter.com/${users[t.author_id] || 'i'}/status/${t.id}`,
      pubDate: t.created_at,
      source: `Twitter/X (@${users[t.author_id] || 'unknown'})`,
      category,
      broad: false
    }));
  } catch (err) {
    console.error('Twitter fetch error:', err.message);
    return [];
  }
}


// ==========================================================================
// v1.7 SOURCES: Google Custom Search, Facebook public RSS, Gemini Vision
// ==========================================================================

// ---------- GOOGLE CUSTOM SEARCH (site-specific social queries) ----------
// Docs: developers.google.com/custom-search/v1
// Set up a Programmable Search Engine at cse.google.com (free).
// Free quota: 100 queries/day. Supports site: operator.
// Searches Instagram, X, YouTube and Facebook public pages for NKR mentions.

const GOOGLE_CSE_SOCIAL_QUERIES = [
  { q: '"Nitish Kumar Reddy" site:instagram.com', label: 'Instagram (Google CSE)' },
  { q: '"Nitish Reddy" site:instagram.com',       label: 'Instagram short (Google CSE)' },
  { q: '#NitishKumarReddy site:x.com',            label: 'X/Twitter (Google CSE)' },
  { q: '"NKR" cricket site:x.com',                label: 'X NKR cricket (Google CSE)' },
  { q: '"Nitish Kumar Reddy" site:youtube.com',   label: 'YouTube (Google CSE)' },
  { q: '"Nitish Reddy" site:facebook.com',        label: 'Facebook public (Google CSE)' },
];

let googleCseCache = [];
let googleCseCacheAt = 0;
const GOOGLE_CSE_CACHE_MS = 20 * 60 * 1000; // re-query every 20 min (quota guard)

async function fetchGoogleCSE() {
  if (!config.GOOGLE_CSE_API_KEY || !config.GOOGLE_CSE_CX) return [];
  const now = Date.now();
  if (googleCseCache.length && now - googleCseCacheAt < GOOGLE_CSE_CACHE_MS) return googleCseCache;

  const results = [];
  // Fire queries sequentially to avoid rate spikes (100 units/day budget)
  for (const { q, label } of GOOGLE_CSE_SOCIAL_QUERIES) {
    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${config.GOOGLE_CSE_API_KEY}&cx=${config.GOOGLE_CSE_CX}&q=${encodeURIComponent(q)}&num=5&dateRestrict=d3&sort=date`;
      const res = await fetch(url, { timeout: 10000 });
      const data = await res.json();
      if (data.items) {
        data.items.forEach(item => {
          results.push({
            title: item.title || '',
            link: item.link || '',
            pubDate: item.pagemap?.metatags?.[0]?.['article:published_time'] || new Date().toISOString(),
            source: label,
            category: 'nkr',
            broad: false,
            _snippet: item.snippet || ''
          });
        });
      }
    } catch (err) {
      console.error(`[Google CSE] query failed (${label}):`, err.message);
    }
    // Small gap between CSE requests
    await new Promise(r => setTimeout(r, 400));
  }

  googleCseCache = results;
  googleCseCacheAt = now;
  if (results.length) console.log(`[Google CSE] ${results.length} social results fetched.`);
  return results;
}

// ---------- FACEBOOK PUBLIC PAGE RSS ----------
// Many cricket teams and journalists publish public Facebook pages
// that expose RSS feeds via rss.app (free tier) or natively.
// No API key required — public RSS passthrough.
const FACEBOOK_RSS_SOURCES = [
  // SRH official Facebook page via rss.app public feed proxy
  { name: 'SRH Facebook (RSS proxy)', url: 'https://rss.app/feeds/SRH-sunrisers-hyderabad.xml' },
  // BCCI official
  { name: 'BCCI Facebook (RSS proxy)', url: 'https://rss.app/feeds/bcci-cricket.xml' },
  // Cricbuzz Facebook
  { name: 'Cricbuzz Facebook (RSS proxy)', url: 'https://rss.app/feeds/cricbuzz.xml' },
];

async function fetchFacebookRSS() {
  const all = [];
  for (const src of FACEBOOK_RSS_SOURCES) {
    try {
      const res = await fetch(src.url, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const text = await res.text();
      const parsed = await xml2js.parseStringPromise(text, { explicitArray: false });
      const channel = parsed.rss?.channel;
      if (!channel || !channel.item) continue;
      const items = Array.isArray(channel.item) ? channel.item : [channel.item];
      items.forEach(it => {
        const title = typeof it.title === 'string' ? it.title : (it.title?._ || '');
        // Only keep items that mention NKR
        if (!/nitish/i.test(title)) return;
        all.push({
          title,
          link: it.link || '',
          pubDate: it.pubDate || new Date().toISOString(),
          source: src.name,
          category: 'nkr',
          broad: false
        });
      });
    } catch (err) {
      console.error(`[Facebook RSS] ${src.name}:`, err.message);
    }
  }
  return all;
}

// ---------- GEMINI VISION — image caption/landmark analysis ----------
// When a news article has an image URL in its metadata, we pass it to
// Gemini Vision to detect stadiums, landmarks, hotel logos etc.
// Only fires if GEMINI_API_KEY is set; skips gracefully otherwise.
// Rate-limited: max 3 image analyses per poll cycle.

async function analyseImageWithGemini(imageUrl) {
  if (!config.GEMINI_API_KEY) return null;
  try {
    // Fetch image as base64
    const imgRes = await fetch(imageUrl, { timeout: 8000 });
    if (!imgRes.ok) return null;
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) return null;
    const buffer = await imgRes.buffer();
    const b64 = buffer.toString('base64');

    const prompt = `You are a cricket location analyst. Look at this image and identify:
1. Any cricket stadium or sports venue visible
2. Any city landmarks, mountains, or distinctive architecture
3. Any hotel logos or team hotel clues
4. Any on-screen text showing a location

Respond ONLY with JSON (no markdown):
{"location": "<city or venue name, or null>", "confidence": <0-99>, "evidence": "<what you spotted>"}`;

    const body = {
      contents: [{
        parts: [
          { inline_data: { mime_type: contentType, data: b64 } },
          { text: prompt }
        ]
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 128 }
    };

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.GEMINI_API_KEY}`,
      { method: 'POST', timeout: 15000, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    );
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = raw.replace(/```json|```/gi, '').trim();
    return JSON.parse(clean);
  } catch (err) {
    console.error('[Gemini Vision] error:', err.message);
    return null;
  }
}

// Extract image URLs from recent NKR news items (from og:image or similar patterns)
async function processImagesFromNews() {
  if (!config.GEMINI_API_KEY) return [];
  const nkrItems = newsItems.filter(i => i.category === 'nkr' && i.link && !i._imageAnalysed).slice(0, 3);
  const results = [];

  for (const item of nkrItems) {
    try {
      // Quick fetch of the article page to get og:image
      const res = await fetch(item.link, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = await res.text();
      const ogMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)
                  || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
      if (!ogMatch) { item._imageAnalysed = true; continue; }

      const imgUrl = ogMatch[1];
      const vision = await analyseImageWithGemini(imgUrl);
      item._imageAnalysed = true;

      if (vision && vision.location && vision.confidence >= 40) {
        console.log(`[Gemini Vision] Detected "${vision.location}" (${vision.confidence}%) from ${item.link}`);
        results.push({
          title: `[Image Analysis] ${vision.evidence} — detected: ${vision.location}`,
          link: item.link,
          pubDate: item.pubDate,
          source: 'Gemini Vision (image analysis)',
          category: 'nkr',
          broad: false,
          _visionLocation: vision.location,
          _visionConfidence: vision.confidence
        });
      }
    } catch (err) {
      item._imageAnalysed = true;
    }
  }
  return results;
}

// ---------- FAN SIGNAL AGGREGATOR ----------
// Boosts confidence when multiple independent fan/team/news signals
// point to the same city within the last 6 hours.
// Signal tiers:  official (BCCI/team) > media > fan/social
function computeFanSignalBoost(cityKey, allSignals) {
  const citySignals = allSignals.filter(s => s.venue.city === cityKey);
  const now = Date.now();

  let officialCount = 0, mediaCount = 0, fanCount = 0;
  for (const s of citySignals) {
    const ageH = (now - new Date(s.pubDate || 0).getTime()) / 3600000;
    if (ageH > 6) continue; // only recent signals count for the boost
    const sn = (s.sourceName || '').toLowerCase();
    if (sn.includes('bcci') || sn.includes('cricapi') || sn.includes('srh') || sn.includes('press conference')) officialCount++;
    else if (sn.includes('espncricinfo') || sn.includes('cricbuzz') || sn.includes('times of india') || sn.includes('newsapi')) mediaCount++;
    else fanCount++; // twitter, instagram, reddit, youtube, cse
  }

  // Award bonus points for mix of source types (diversity = higher truth probability)
  let boost = 0;
  if (officialCount >= 1) boost += 8;
  if (mediaCount >= 1)    boost += 5;
  if (fanCount >= 2)      boost += 4;
  if (officialCount >= 1 && mediaCount >= 1 && fanCount >= 1) boost += 5; // triple-type bonus
  return Math.min(boost, 20); // cap at +20
}

async function pollAllSources() {
  try {
    const results = await Promise.all(SOURCES.map(fetchFeed));
    const [twitterNKR, twitterVizag, instagramPosts, newsApiItems, cricApiItems, youtubeItems, cseItems, fbItems, visionItems] = await Promise.all([
      fetchTwitter('"Nitish Kumar Reddy" OR "Nitish Reddy" -is:retweet', 'nkr'),
      fetchTwitter('(Visakhapatnam OR Vizag) -is:retweet', 'general'),
      Promise.all(['nitishkumarreddy'].map(fetchInstagramPosts)).then(r => r.flat()),
      fetchNewsAPI(),
      fetchCricAPI(),
      fetchYouTube(),
      fetchGoogleCSE(),
      fetchFacebookRSS(),
      processImagesFromNews()
    ]);
    const flat = [...results.flat(), ...twitterNKR, ...twitterVizag, ...instagramPosts, ...newsApiItems, ...cricApiItems, ...youtubeItems, ...cseItems, ...fbItems, ...visionItems];
    const fresh = [];

    // How recently a story can have appeared and still count as "the same
    // story" for dedup purposes. Outside this window, a re-surfacing of the
    // same topic (e.g. a new development) is allowed through as a new item.
    const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
    const SIMILARITY_THRESHOLD = 0.6;
    const updatedExisting = []; // existing stories that got a new corroborating source this cycle

    for (const item of flat) {
      if (!item.title) continue;
      // Scope filtering — strict per-source rules:
      // vizagScope → title MUST mention Vizag/Visakhapatnam
      // apScope    → title MUST mention AP keywords (not just Hyderabad/Telangana)
      // nkrScope   → title MUST name "Nitish Kumar Reddy" or "Nitish Reddy"
      // broad/vizagOnly legacy flags still supported
      if (item.vizagScope && !isStrictlyVizag(item.title)) continue;
      if (item.apScope && !isStrictlyAP(item.title)) continue;
      if (item.nkrScope && !isStrictlyNKR(item.title)) continue;
      // Legacy support
      if (item.broad && !isVizagRelated(item.title)) continue;

      const normTitle = normalizeTitle(item.title);
      const normLink = normalizeLink(item.link);
      if (!normTitle) continue;

      // Drop old completed-match recaps re-served from hosts whose true publish
      // date couldn't be verified (e.g. MSN syndication) — these are stale
      // content masquerading as fresh, not real breaking news.
      if (item.dateUnresolved && isStaleMatchRecap(item.title)) continue;

      const h = hashItem(normTitle, normLink);
      if (seenHashes.has(h)) continue; // exact duplicate (same story+link/source), skip silently
      rememberHash(h);

      // Story-level dedup: has a similar story already been shown (from this
      // poll's fresh batch, or from recently stored items)? If so, fold this
      // source into the existing story instead of creating a new card.
      const now = Date.now();
      let matchedExisting = null;

      for (const existing of newsItems) {
        if (now - new Date(existing.receivedAt || existing.pubDate || 0).getTime() > DEDUP_WINDOW_MS) continue;
        if (titleSimilarity(existing.title, item.title) > SIMILARITY_THRESHOLD) {
          matchedExisting = existing;
          break;
        }
      }

      if (matchedExisting) {
        // Same story already shown — don't push a new card. Just record this
        // source as additional coverage and mark the story verified.
        const wasVerified = matchedExisting.verified;
        matchedExisting.verified = true;
        matchedExisting.relatedSources = matchedExisting.relatedSources || [];
        if (!matchedExisting.relatedSources.some(s => s.source === item.source)) {
          matchedExisting.relatedSources.push({ source: item.source, link: item.link, pubDate: item.pubDate });
          if (!wasVerified) updatedExisting.push(matchedExisting);
        }
        continue;
      }

      // Also check against this poll cycle's own fresh batch (multiple
      // sources can report the same brand-new story in the same cycle).
      const matchedFresh = fresh.find(f => titleSimilarity(f.title, item.title) > SIMILARITY_THRESHOLD);
      if (matchedFresh) {
        matchedFresh.verified = true;
        matchedFresh.relatedSources = matchedFresh.relatedSources || [];
        if (!matchedFresh.relatedSources.some(s => s.source === item.source)) {
          matchedFresh.relatedSources.push({ source: item.source, link: item.link, pubDate: item.pubDate });
        }
        continue;
      }

      const enriched = {
        id: h,
        title: item.title,
        link: item.link,
        source: item.source,
        category: item.category,
        pubDate: item.pubDate,
        rssPubDate: item.rssPubDate || item.pubDate,
        dateUnresolved: !!item.dateUnresolved,
        relatedToVizag: isVizagRelated(item.title),
        districts: matchAndhraDistricts(item.title),
        receivedAt: new Date().toISOString(),
        verified: false,
        relatedSources: []
      };
      fresh.push(enriched);
    }

    lastPollAt = new Date();
    lastPollError = null;

    // Broadcast verification updates for existing stories even if no new cards
    updatedExisting.forEach(item => broadcast({ type: 'news_update', item: {
      id: item.id, verified: item.verified, relatedSources: item.relatedSources
    }}));

    if (fresh.length === 0) return;

    // Purge items older than 24 hours before storing new ones
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    newsItems = newsItems.filter(i => new Date(i.pubDate || i.receivedAt || 0) > cutoff24h);
    newsItems = [...fresh, ...newsItems].slice(0, MAX_ITEMS_STORED);
    newsItems.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    // Push each fresh item to all connected clients instantly
    fresh.forEach(item => broadcast({ type: 'news', item }));
    console.log(`[${new Date().toISOString()}] Pushed ${fresh.length} new item(s), ${updatedExisting.length} corroboration update(s).`);
  } catch (err) {
    lastPollError = err.message;
    console.error(`[${new Date().toISOString()}] Poll cycle failed:`, err.message);
  }
}

// Simple word-overlap similarity for cross-source verification
function titleSimilarity(a, b) {
  const wa = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const wb = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  if (wa.size === 0 || wb.size === 0) return 0;
  let common = 0;
  wa.forEach(w => { if (wb.has(w)) common++; });
  return common / Math.min(wa.size, wb.size);
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });
}

// ---------- WEBSOCKET ----------
wss.on('connection', ws => {
  console.log(`[${new Date().toISOString()}] Client connected. Sending current news cache.`);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const freshItems = newsItems.filter(i => new Date(i.pubDate || i.receivedAt || 0) > cutoff24h);
  ws.send(JSON.stringify({ type: 'init', items: freshItems.slice(0, 80) }));
});

// Periodically ping clients and drop ones that stop responding
const HEARTBEAT_MS = 30 * 1000;
const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_MS);
wss.on('close', () => clearInterval(heartbeat));

// ---------- GEOCODE (place name + optional Indian PIN code -> lat/lon) ----------
// Used by the Distance Map "custom place" picker. Resolves a free-text
// place name (optionally combined with a 6-digit Indian PIN code for
// precision) to coordinates via:
//   1. India Post Pincode API — confirms the post office / district / state
//      for a given PIN, used to refine the search query.
//   2. Open-Meteo Geocoding API — turns the resulting place name into
//      latitude/longitude.
async function geocodePlace(name, pincode) {
  let query = (name || '').trim();
  let pinMeta = null;

  if (pincode && /^\d{6}$/.test(pincode)) {
    try {
      const r = await fetch(`https://api.postalpincode.in/pincode/${pincode}`, { timeout: 8000 });
      if (r.ok) {
        const data = await r.json();
        const po = data?.[0]?.PostOffice?.[0];
        if (po) {
          pinMeta = { postOffice: po.Name, district: po.District, state: po.State, pincode };
          // Prefer a query built from the PIN's district/state — most
          // reliable for the geocoder — but keep the user's place name
          // first so a specific village/landmark still gets matched.
          const parts = [query, po.Name, po.District, po.State].filter(Boolean);
          query = [...new Set(parts)].join(', ');
        }
      }
    } catch (err) {
      console.warn('[geocode] pincode lookup failed:', err.message);
    }
  }

  if (!query) return { error: 'No place name or valid PIN code provided.' };

  // Open-Meteo's geocoder matches a single place name against its database
  // (GeoNames) — it does NOT understand a full "place, district, state"
  // address string as one query. Small villages/landmarks (e.g. a specific
  // pincode's post office name) often aren't in that database at all, so a
  // combined query like "Dalapathisamudram, Tenkasi, Tamil Nadu" matches
  // nothing even though the district/state on their own would. Try a series
  // of progressively broader queries until one resolves.
  const candidates = [];
  if (query) candidates.push(query);
  if (name && name.trim() && name.trim() !== query) candidates.push(name.trim());
  if (pinMeta) {
    if (pinMeta.district) candidates.push([pinMeta.district, pinMeta.state].filter(Boolean).join(', '));
    if (pinMeta.postOffice) candidates.push([pinMeta.postOffice, pinMeta.state].filter(Boolean).join(', '));
    if (pinMeta.district) candidates.push(pinMeta.district);
  }

  let results = [];
  let triedQuery = query;
  for (const candidate of [...new Set(candidates)]) {
    if (!candidate) continue;
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(candidate)}&count=5&language=en&format=json`;
    const r = await fetch(geoUrl, { timeout: 8000 });
    if (!r.ok) throw new Error(`geocoder status ${r.status}`);
    const data = await r.json();
    results = data?.results || [];
    triedQuery = candidate;
    if (results.length) break;
  }

  if (!results.length) {
    return { error: `Couldn't find "${query}". Try a nearby town name.`, pinMeta };
  }
  query = triedQuery;

  // If we have PIN-derived state info, prefer a result in the same admin1/state.
  let best = results[0];
  if (pinMeta?.state) {
    const stateMatch = results.find(r =>
      (r.admin1 || '').toLowerCase().includes(pinMeta.state.toLowerCase()) ||
      pinMeta.state.toLowerCase().includes((r.admin1 || '').toLowerCase())
    );
    if (stateMatch) best = stateMatch;
  }

  return {
    lat: best.latitude,
    lon: best.longitude,
    resolvedName: best.name,
    admin1: best.admin1 || null,
    country: best.country || null,
    timezone: best.timezone || 'Asia/Kolkata',
    pinMeta,
    approximate: query !== (name || '').trim(),
    requestedName: (name || '').trim() || null
  };
}

app.get('/api/geocode', async (req, res) => {
  try {
    const { name, pincode } = req.query;
    if (!name && !pincode) {
      return res.status(400).json({ error: 'Provide a place name and/or 6-digit PIN code.' });
    }
    const result = await geocodePlace(name, pincode);
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (e) {
    console.error('[geocode] error:', e.message);
    res.status(503).json({ error: 'geocoding failed, try again' });
  }
});


app.get('/api/weather', async (req, res) => {
  try {
    // Accept optional lat/lon params — default to Visakhapatnam city centre
    const lat = parseFloat(req.query.lat) || 17.7231;   // Vizag city centre
    const lon = parseFloat(req.query.lon) || 83.3013;   // (not ACA-VDCA stadium coords)
    const tz  = req.query.tz  || 'Asia%2FKolkata';
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code&daily=sunrise,sunset,uv_index_max&timezone=${tz}`;
    const r = await fetch(url, { timeout: 4000 });
    if (!r.ok) throw new Error(`upstream status ${r.status}`);
    const data = await r.json();
    // Prevent browser/proxy caching — weather must be fresh every request
    res.set('Cache-Control', 'no-store, max-age=0');
    res.json(data);
  } catch (e) {
    console.error('Weather fetch error:', e.message);
    res.status(503).json({ error: 'weather fetch failed' });
  }
});

app.get('/api/aqi', async (req, res) => {
  try {
    const url = 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=17.7231&longitude=83.3013&current=us_aqi,pm2_5,pm10,ozone,carbon_monoxide&timezone=Asia%2FKolkata';
    const r = await fetch(url, { timeout: 4000 });
    if (!r.ok) throw new Error(`upstream status ${r.status}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error('AQI fetch error:', e.message);
    res.status(503).json({ error: 'aqi fetch failed' });
  }
});

// Hourly forecast passthrough (used by front-end forecast strip)
app.get('/api/forecast', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat) || 17.7231;
    const lon = parseFloat(req.query.lon) || 83.3013;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,weather_code&timezone=Asia%2FKolkata&forecast_days=1`;
    const r = await fetch(url, { timeout: 4000 });
    if (!r.ok) throw new Error(`upstream status ${r.status}`);
    const data = await r.json();
    res.set('Cache-Control', 'no-store, max-age=0');
    res.json(data);
  } catch (e) {
    console.error('Forecast fetch error:', e.message);
    res.status(503).json({ error: 'forecast fetch failed' });
  }
});

app.get('/api/news', (req, res) => {
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const fresh = newsItems.filter(i => new Date(i.pubDate || i.receivedAt || 0) > cutoff24h);
  res.json(fresh.slice(0, 80));
});

// All 26 AP districts grouped by region, for building a district picker UI.
app.get('/api/ap-districts', (req, res) => {
  const regions = {};
  AP_DISTRICTS.forEach(d => {
    if (!regions[d.region]) regions[d.region] = [];
    regions[d.region].push({ key: d.key, name: d.name });
  });
  res.json({ regions });
});

// ---------- NKR LOCATION, WEATHER & FIXTURES ----------
// No AI required. We infer NKR's current location from recent NKR-tagged
// headlines (matched against known venue/city keywords), fetch live weather
// for that location from Open-Meteo, and pair it with a maintained fixture
// list of upcoming matches he's part of (India ODIs / England tour).

// Known cricket venues/cities with coordinates. Order matters for matching —
// more specific names should come first if there's overlap.
const VENUES = [
  { keys: ['dharamsala', 'dharamshala', 'hpca'], city: 'Dharamsala, Himachal Pradesh', country: 'India', flag: '🇮🇳', venue: 'HPCA Stadium', lat: 32.1937, lon: 76.3217 },
  { keys: ['lucknow', 'ekana'], city: 'Lucknow, Uttar Pradesh', country: 'India', flag: '🇮🇳', venue: 'Ekana Cricket Stadium', lat: 26.8467, lon: 80.9462 },
  { keys: ['chennai', 'chepauk', 'chidambaram'], city: 'Chennai, Tamil Nadu', country: 'India', flag: '🇮🇳', venue: 'M.A. Chidambaram Stadium', lat: 13.0827, lon: 80.2707 },
  { keys: ['mullanpur', 'chandigarh', 'new chandigarh'], city: 'New Chandigarh, Punjab', country: 'India', flag: '🇮🇳', venue: 'Maharaja Yadavindra Singh Stadium', lat: 30.7333, lon: 76.7794 },
  { keys: ['hyderabad', 'rajiv gandhi', 'uppal'], city: 'Hyderabad, Telangana', country: 'India', flag: '🇮🇳', venue: 'Rajiv Gandhi International Stadium', lat: 17.3850, lon: 78.4867 },
  { keys: ['visakhapatnam', 'vizag'], city: 'Visakhapatnam, Andhra Pradesh', country: 'India', flag: '🇮🇳', venue: 'ACA-VDCA Stadium', lat: 17.7231, lon: 83.3013 },
  { keys: ['mumbai', 'wankhede'], city: 'Mumbai, Maharashtra', country: 'India', flag: '🇮🇳', venue: 'Wankhede Stadium', lat: 19.0760, lon: 72.8777 },
  { keys: ['bengaluru', 'bangalore', 'chinnaswamy'], city: 'Bengaluru, Karnataka', country: 'India', flag: '🇮🇳', venue: 'M. Chinnaswamy Stadium', lat: 12.9716, lon: 77.5946 },
  { keys: ['delhi', 'kotla', 'arun jaitley'], city: 'New Delhi', country: 'India', flag: '🇮🇳', venue: 'Arun Jaitley Stadium', lat: 28.6139, lon: 77.2090 },
  { keys: ['kolkata', 'eden gardens'], city: 'Kolkata, West Bengal', country: 'India', flag: '🇮🇳', venue: 'Eden Gardens', lat: 22.5726, lon: 88.3639 },
  { keys: ['birmingham', 'edgbaston'], city: 'Birmingham, England', country: 'England', flag: '🏴', venue: 'Edgbaston', lat: 52.4862, lon: -1.8904 },
  { keys: ['cardiff', 'sophia gardens'], city: 'Cardiff, Wales', country: 'England', flag: '🏴', venue: 'Sophia Gardens', lat: 51.4816, lon: -3.1791 },
  { keys: ["lord's", 'lords'], city: 'London, England', country: 'England', flag: '🏴', venue: "Lord's Cricket Ground", lat: 51.5292, lon: -0.1722 },
  { keys: ['manchester', 'old trafford'], city: 'Manchester, England', country: 'England', flag: '🏴', venue: 'Old Trafford', lat: 53.4808, lon: -2.2426 },
  { keys: ['chester-le-street', 'riverside ground'], city: 'Chester-le-Street, England', country: 'England', flag: '🏴', venue: 'Riverside Ground', lat: 54.8639, lon: -1.5807 },
  { keys: ['nottingham', 'trent bridge'], city: 'Nottingham, England', country: 'England', flag: '🏴', venue: 'Trent Bridge', lat: 52.9374, lon: -1.1313 },
  { keys: ['bristol'], city: 'Bristol, England', country: 'England', flag: '🏴', venue: 'County Ground', lat: 51.4545, lon: -2.5879 },
  { keys: ['southampton', 'utilita bowl', 'rose bowl'], city: 'Southampton, England', country: 'England', flag: '🏴', venue: 'Utilita Bowl', lat: 50.9097, lon: -1.4044 },
  { keys: ['harare'], city: 'Harare, Zimbabwe', country: 'Zimbabwe', flag: '🇿🇼', venue: 'Harare Sports Club', lat: -17.8292, lon: 31.0522 },
  { keys: ['belfast', 'stormont', 'civil service'], city: 'Belfast, Ireland', country: 'Ireland', flag: '🇮🇪', venue: 'Stormont Cricket Ground', lat: 54.5973, lon: -5.8880 },
  { keys: ['aichi', 'nagoya', 'nisshin', 'korogi'], city: 'Aichi, Japan', country: 'Japan', flag: '🇯🇵', venue: 'Korogi Athletic Park', lat: 35.1167, lon: 137.0500 }
];

// Default home location (Visakhapatnam) — used when no recent location signal found.
const HOME_LOCATION = VENUES.find(v => v.keys.includes('visakhapatnam'));

// Fixture list — ALL competitions NKR plays in.
// category: 'international' | 'ipl' | 'domestic'
// IST conversions: BST(UTC+1)+4:30=IST | GMT+5:30=IST | CAT(UTC+2)+3:30=IST | JST(UTC+9)-3:30=IST
const NKR_FIXTURES = [
  // ── INTERNATIONAL: Afghanistan ODI series (India) ─────────────────────
  { date: '2026-06-13', timeIST: '1:30 PM (India)', timeLocal: null,                          match: 'India vs Afghanistan',   format: '1st ODI',           venueKey: 'dharamsala',        category: 'international', status: 'completed', confirmed: true },
  { date: '2026-06-17', timeIST: '1:30 PM (India)', timeLocal: null,                          match: 'India vs Afghanistan',   format: '2nd ODI',           venueKey: 'lucknow',           category: 'international', status: 'upcoming',  confirmed: true },
  { date: '2026-06-20', timeIST: '1:30 PM (India)', timeLocal: null,                          match: 'India vs Afghanistan',   format: '3rd ODI',           venueKey: 'chennai',           category: 'international', status: 'upcoming',  confirmed: true },

  // ── INTERNATIONAL: Ireland T20I series (Belfast, BST UTC+1, 12:30 GMT = 6:00 PM IST) ──
  { date: '2026-06-26', timeIST: '6:00 PM (India)',  timeLocal: '1:30 PM (Belfast)',          match: 'Ireland vs India',       format: '1st T20I',          venueKey: 'belfast',           category: 'international', status: 'upcoming',  confirmed: true },
  { date: '2026-06-28', timeIST: '6:00 PM (India)',  timeLocal: '1:30 PM (Belfast)',          match: 'Ireland vs India',       format: '2nd T20I',          venueKey: 'belfast',           category: 'international', status: 'upcoming',  confirmed: true },

  // ── INTERNATIONAL: England T20I series (BST; D/N = 5:30 PM BST = 10:00 PM IST; Day = 2:30 PM BST = 7:00 PM IST) ──
  { date: '2026-07-01', timeIST: '10:00 PM (India)', timeLocal: '5:30 PM (Chester-le-Street)',match: 'England vs India',       format: '1st T20I',          venueKey: 'chester-le-street', category: 'international', status: 'upcoming',  confirmed: true },
  { date: '2026-07-04', timeIST: '7:00 PM (India)',  timeLocal: '2:30 PM (Manchester)',       match: 'England vs India',       format: '2nd T20I',          venueKey: 'manchester',        category: 'international', status: 'upcoming',  confirmed: true },
  { date: '2026-07-07', timeIST: '10:00 PM (India)', timeLocal: '5:30 PM (Nottingham)',       match: 'England vs India',       format: '3rd T20I',          venueKey: 'nottingham',        category: 'international', status: 'upcoming',  confirmed: true },
  { date: '2026-07-09', timeIST: '10:00 PM (India)', timeLocal: '5:30 PM (Bristol)',          match: 'England vs India',       format: '4th T20I',          venueKey: 'bristol',           category: 'international', status: 'upcoming',  confirmed: true },
  { date: '2026-07-11', timeIST: '10:00 PM (India)', timeLocal: '5:30 PM (Southampton)',      match: 'England vs India',       format: '5th T20I',          venueKey: 'southampton',       category: 'international', status: 'upcoming',  confirmed: true },

  // ── INTERNATIONAL: England ODI series (BST; 1:00 PM BST = 5:30 PM IST; 11:00 AM BST = 3:30 PM IST) ──
  { date: '2026-07-14', timeIST: '5:30 PM (India)',  timeLocal: '1:00 PM (Birmingham)',       match: 'England vs India',       format: '1st ODI',           venueKey: 'birmingham',        category: 'international', status: 'upcoming',  confirmed: true },
  { date: '2026-07-16', timeIST: '5:30 PM (India)',  timeLocal: '1:00 PM (Cardiff)',          match: 'England vs India',       format: '2nd ODI',           venueKey: 'cardiff',           category: 'international', status: 'upcoming',  confirmed: true },
  { date: '2026-07-19', timeIST: '3:30 PM (India)',  timeLocal: '11:00 AM (London)',          match: 'England vs India',       format: '3rd ODI',           venueKey: "lord's",            category: 'international', status: 'upcoming',  confirmed: true },

  // ── INTERNATIONAL: Zimbabwe T20I series (CAT UTC+2, 1:00 PM CAT = 3:30 PM IST) ──
  { date: '2026-07-23', timeIST: '3:30 PM (India)',  timeLocal: '1:00 PM (Harare)',           match: 'India vs Zimbabwe',      format: '1st T20I',          venueKey: 'harare',            category: 'international', status: 'upcoming',  confirmed: true },
  { date: '2026-07-25', timeIST: '3:30 PM (India)',  timeLocal: '1:00 PM (Harare)',           match: 'India vs Zimbabwe',      format: '2nd T20I',          venueKey: 'harare',            category: 'international', status: 'upcoming',  confirmed: true },
  { date: '2026-07-26', timeIST: '3:30 PM (India)',  timeLocal: '1:00 PM (Harare)',           match: 'India vs Zimbabwe',      format: '3rd T20I',          venueKey: 'harare',            category: 'international', status: 'upcoming',  confirmed: true },

  // ── DOMESTIC: Duleep Trophy 2026-27 (South Zone, dates not yet officially announced — placeholder) ──
  { date: '2026-08-23', timeIST: '9:30 AM (India)',  timeLocal: null,                         match: 'South Zone vs TBD',      format: 'Duleep Trophy QF',  venueKey: 'bengaluru',         category: 'domestic',      status: 'upcoming', confirmed: false },
  { date: '2026-09-04', timeIST: '9:30 AM (India)',  timeLocal: null,                         match: 'South Zone vs TBD',      format: 'Duleep Trophy SF',  venueKey: 'bengaluru',         category: 'domestic',      status: 'upcoming', confirmed: false },
  { date: '2026-09-10', timeIST: '9:30 AM (India)',  timeLocal: null,                         match: 'South Zone vs TBD',      format: 'Duleep Trophy Final',venueKey: 'bengaluru',        category: 'domestic',      status: 'upcoming', confirmed: false },

  // ── INTERNATIONAL: Asian Games 2026 (Aichi, JST UTC+9, 2:00 PM JST = 10:30 AM IST) — squad/dates not yet confirmed ──
  { date: '2026-09-27', timeIST: '10:30 AM (India)', timeLocal: '2:00 PM (Aichi)',            match: 'India vs TBD',           format: 'Asian Games QF',    venueKey: 'aichi',             category: 'international', status: 'upcoming', confirmed: false },
  { date: '2026-10-01', timeIST: '10:30 AM (India)', timeLocal: '2:00 PM (Aichi)',            match: 'India vs TBD',           format: 'Asian Games SF',    venueKey: 'aichi',             category: 'international', status: 'upcoming', confirmed: false },
  { date: '2026-10-03', timeIST: '10:30 AM (India)', timeLocal: '2:00 PM (Aichi)',            match: 'India vs TBD',           format: 'Asian Games Final', venueKey: 'aichi',             category: 'international', status: 'upcoming', confirmed: false },

  // ── DOMESTIC: Irani Cup 2026-27 (dates not yet officially announced — placeholder) ──
  { date: '2026-10-01', timeIST: '9:30 AM (India)',  timeLocal: null,                         match: 'Rest of India vs J&K',   format: 'Irani Cup',         venueKey: 'delhi',             category: 'domestic',      status: 'upcoming', confirmed: false },

  // ── DOMESTIC: Ranji Trophy 2026-27 Phase 1 (Andhra — dates not yet officially announced — placeholder) ──
  { date: '2026-10-11', timeIST: '9:30 AM (India)',  timeLocal: null,                         match: 'Andhra vs TBD',          format: 'Ranji Trophy R1',   venueKey: 'visakhapatnam',     category: 'domestic',      status: 'upcoming', confirmed: false },
  { date: '2026-10-19', timeIST: '9:30 AM (India)',  timeLocal: null,                         match: 'Andhra vs TBD',          format: 'Ranji Trophy R2',   venueKey: 'visakhapatnam',     category: 'domestic',      status: 'upcoming', confirmed: false },
  { date: '2026-10-27', timeIST: '9:30 AM (India)',  timeLocal: null,                         match: 'Andhra vs TBD',          format: 'Ranji Trophy R3',   venueKey: 'visakhapatnam',     category: 'domestic',      status: 'upcoming', confirmed: false },
  { date: '2026-11-03', timeIST: '9:30 AM (India)',  timeLocal: null,                         match: 'Andhra vs TBD',          format: 'Ranji Trophy R4',   venueKey: 'visakhapatnam',     category: 'domestic',      status: 'upcoming', confirmed: false },

  // ── DOMESTIC: Syed Mushtaq Ali Trophy 2026-27 (dates not yet officially announced — placeholder) ──
  { date: '2026-11-14', timeIST: '7:30 PM (India)',  timeLocal: null,                         match: 'Andhra vs TBD',          format: 'SMAT 2026 — Day 1', venueKey: 'visakhapatnam',     category: 'domestic',      status: 'upcoming', confirmed: false },
  { date: '2026-11-20', timeIST: '7:30 PM (India)',  timeLocal: null,                         match: 'Andhra vs TBD',          format: 'SMAT 2026 — Day 5', venueKey: 'visakhapatnam',     category: 'domestic',      status: 'upcoming', confirmed: false },
  { date: '2026-11-26', timeIST: '7:30 PM (India)',  timeLocal: null,                         match: 'Andhra vs TBD',          format: 'SMAT 2026 — Day 10',venueKey: 'visakhapatnam',     category: 'domestic',      status: 'upcoming', confirmed: false },
  { date: '2026-11-30', timeIST: '7:30 PM (India)',  timeLocal: null,                         match: 'Andhra vs TBD',          format: 'SMAT KO',           venueKey: 'nagpur',            category: 'domestic',      status: 'upcoming', confirmed: false },

  // ── DOMESTIC: Vijay Hazare Trophy 2026-27 (dates not yet officially announced — placeholder) ──
  { date: '2026-12-14', timeIST: '9:30 AM (India)',  timeLocal: null,                         match: 'Andhra vs TBD',          format: 'VHT 2026 — Day 1',  venueKey: 'visakhapatnam',     category: 'domestic',      status: 'upcoming', confirmed: false },
  { date: '2026-12-20', timeIST: '9:30 AM (India)',  timeLocal: null,                         match: 'Andhra vs TBD',          format: 'VHT 2026 — Day 5',  venueKey: 'visakhapatnam',     category: 'domestic',      status: 'upcoming', confirmed: false },
  { date: '2026-12-28', timeIST: '9:30 AM (India)',  timeLocal: null,                         match: 'Andhra vs TBD',          format: 'VHT 2026 — Day 10', venueKey: 'visakhapatnam',     category: 'domestic',      status: 'upcoming', confirmed: false },
  { date: '2027-01-02', timeIST: '9:30 AM (India)',  timeLocal: null,                         match: 'Andhra vs TBD',          format: 'VHT KO',            venueKey: 'visakhapatnam',     category: 'domestic',      status: 'upcoming', confirmed: false },

  // ── DOMESTIC: Ranji Trophy 2026-27 Phase 2 (dates not yet officially announced — placeholder) ──
  { date: '2027-01-17', timeIST: '9:30 AM (India)',  timeLocal: null,                         match: 'Andhra vs TBD',          format: 'Ranji Trophy R5',   venueKey: 'visakhapatnam',     category: 'domestic',      status: 'upcoming', confirmed: false },
  { date: '2027-01-25', timeIST: '9:30 AM (India)',  timeLocal: null,                         match: 'Andhra vs TBD',          format: 'Ranji Trophy R6',   venueKey: 'visakhapatnam',     category: 'domestic',      status: 'upcoming', confirmed: false },

  // ── DOMESTIC: Ranji Trophy Knockouts (dates not yet officially announced — placeholder) ──
  { date: '2027-02-09', timeIST: '9:30 AM (India)',  timeLocal: null,                         match: 'Andhra vs TBD',          format: 'Ranji Trophy QF',   venueKey: 'visakhapatnam',     category: 'domestic',      status: 'upcoming', confirmed: false },
  { date: '2027-02-20', timeIST: '9:30 AM (India)',  timeLocal: null,                         match: 'Andhra vs TBD',          format: 'Ranji Trophy SF',   venueKey: 'visakhapatnam',     category: 'domestic',      status: 'upcoming', confirmed: false },
  { date: '2027-03-01', timeIST: '9:30 AM (India)',  timeLocal: null,                         match: 'Andhra vs TBD',          format: 'Ranji Trophy Final',venueKey: 'visakhapatnam',     category: 'domestic',      status: 'upcoming', confirmed: false },

  // ── IPL 2027: SRH (Sunrisers Hyderabad) — only the season WINDOW (Mar 14 – May 30, 2027) has
  // been announced by BCCI; specific fixtures, opponents, venues & times are NOT yet announced.
  // This entry is intentionally marked unconfirmed and hidden until BCCI/IPL release the
  // actual match schedule (live sync will then add the real fixtures automatically).
  { date: '2027-03-14', timeIST: 'TBA',              timeLocal: null,                         match: 'SRH vs TBD',             format: 'IPL 2027 — season window (Mar 14 – May 30)', venueKey: 'hyderabad', category: 'ipl', status: 'upcoming', confirmed: false },
];

function findVenue(key) {
  return VENUES.find(v => v.keys.includes(key)) || HOME_LOCATION;
}

// ============================================================
//  LIVE FIXTURE SYNC SYSTEM
//  Seeds from NKR_FIXTURES, then auto-syncs from Cricbuzz
//  public JSON every 6 hours. No API key needed.
// ============================================================

// Runtime fixture store — starts with hardcoded seeds, gets enriched by live sync
let liveFixtures = [...NKR_FIXTURES];
let lastFixtureSync = 0;
const FIXTURE_SYNC_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

// Series keys confirmed to include NKR in squad
// Add new series slugs here when BCCI announces squad
const NKR_CONFIRMED_SERIES = [
  'india-in-ireland-2026',
  'india-in-england-2026',
  'india-in-zimbabwe-2026',
  'india-v-afghanistan-2026',
  'asian-games-2026',
];

// Timezone offset map for known countries/cities → hours from UTC
const TZ_OFFSETS = {
  'India': 5.5,  'England': 1, 'Ireland': 1, 'Wales': 1,
  'Zimbabwe': 2, 'Japan': 9,  'Australia': 11, 'South Africa': 2,
  'Sri Lanka': 5.5, 'Pakistan': 5, 'Bangladesh': 6, 'New Zealand': 13,
  'West Indies': -4, 'UAE': 4, 'default': 0
};

function utcToIST(utcDateStr) {
  // utcDateStr: ISO string in UTC → returns { dateStr, timeStr }
  const d = new Date(utcDateStr);
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  const dateStr = ist.toISOString().split('T')[0];
  let h = ist.getUTCHours(), m = ist.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const mStr = m === 0 ? '00' : String(m).padStart(2, '0');
  return { dateStr, timeStr: `${h}:${mStr} ${ampm} (India)` };
}

function utcToLocal(utcDateStr, tzOffset) {
  const d = new Date(utcDateStr);
  const local = new Date(d.getTime() + tzOffset * 60 * 60 * 1000);
  let h = local.getUTCHours(), m = local.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const mStr = m === 0 ? '00' : String(m).padStart(2, '0');
  return `${h}:${mStr} ${ampm}`;
}

function matchVenueKey(city = '', country = '') {
  const needle = (city + ' ' + country).toLowerCase();
  for (const v of VENUES) {
    if (v.keys.some(k => needle.includes(k))) return v.keys[0];
  }
  // Auto-add unknown venue
  const newKey = city.toLowerCase().replace(/[^a-z0-9]/g, '-');
  if (newKey && !VENUES.find(v => v.keys.includes(newKey))) {
    VENUES.push({
      keys: [newKey],
      city: `${city}${country ? ', ' + country : ''}`,
      country: country || 'Unknown',
      flag: '🏏',
      venue: city,
      lat: 0, lon: 0
    });
  }
  return newKey || 'unknown';
}

async function syncFixturesFromCricbuzz() {
  try {
    console.log('[fixtures] Starting live sync from Cricbuzz...');
    // Cricbuzz public schedule endpoint for India international matches
    const url = 'https://www.cricbuzz.com/cricket-schedule/upcomingMatches/international';
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      timeout: 15000
    });
    if (!res.ok) throw new Error(`Cricbuzz HTTP ${res.status}`);
    const text = await res.text();

    // Extract JSON from window.__INITIAL_STATE__ or inline JSON blobs
    const jsonMatch = text.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});?\s*<\/script>/s)
                  || text.match(/"scheduleMatches"\s*:\s*(\[.+?\])/s);

    if (!jsonMatch) {
      console.log('[fixtures] Could not parse Cricbuzz page structure');
      return;
    }

    let matches = [];
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      // Navigate to matches array (structure varies by Cricbuzz version)
      matches = parsed?.schedule?.matchScheduleMap || parsed?.matchScheduleList || parsed || [];
    } catch (e) {
      console.log('[fixtures] JSON parse failed:', e.message);
      return;
    }

    const newFixtures = [];
    const flatten = (arr) => Array.isArray(arr) ? arr.flatMap(x => x.matchScheduleList || x.matches || x) : [];

    for (const match of flatten(matches)) {
      const teams = [match.team1?.teamSName, match.team2?.teamSName].filter(Boolean);
      // Only India matches
      if (!teams.includes('IND') && !teams.some(t => t?.includes('India'))) continue;

      const seriesSlug = (match.seriesName || '').toLowerCase().replace(/\s+/g, '-');
      // Only confirmed NKR series
      if (!NKR_CONFIRMED_SERIES.some(s => seriesSlug.includes(s.split('-').slice(0, 3).join('-')))) continue;

      const startMs = match.startTime || match.matchTime;
      if (!startMs) continue;

      const utcStr = new Date(Number(startMs)).toISOString();
      const { dateStr, timeStr: timeIST } = utcToIST(utcStr);

      const city = match.venueInfo?.city || match.ground?.groundName || '';
      const country = match.venueInfo?.country || '';
      const isIndia = country === 'India' || !country;
      const tzOffset = TZ_OFFSETS[country] ?? TZ_OFFSETS['default'];
      const timeLocal = isIndia ? null : `${utcToLocal(utcStr, tzOffset)} (${city || country})`;

      const venueKey = matchVenueKey(city, country);
      const t1 = match.team1?.teamName || '';
      const t2 = match.team2?.teamName || '';
      const matchName = `${t1} vs ${t2}`;
      const format = match.matchDesc || match.matchFormat || '';

      newFixtures.push({
        date: dateStr,
        timeIST,
        timeLocal,
        match: matchName,
        format,
        venueKey,
        status: 'upcoming',
        confirmed: true, // came from Cricbuzz's live schedule — treat as officially confirmed
        source: 'live'   // tag so we know it came from live sync
      });
    }

    if (newFixtures.length > 0) {
      console.log(`[fixtures] Live sync found ${newFixtures.length} NKR matches`);
      // Merge: keep hardcoded fixtures, add new live ones not already present
      const existingDates = new Set(liveFixtures.map(f => f.date + f.format));
      const added = newFixtures.filter(f => !existingDates.has(f.date + f.format));
      if (added.length) {
        // For any category where we now have real (confirmed, live-synced) fixtures,
        // drop our old speculative "TBD" placeholders for that category — the real
        // schedule has been announced and should replace guesses.
        const confirmedCategories = new Set(added.map(f => f.category));
        liveFixtures = liveFixtures.filter(f =>
          !(f.confirmed === false && confirmedCategories.has(f.category))
        );
        liveFixtures = [...liveFixtures, ...added];
        console.log(`[fixtures] Added ${added.length} new fixtures from live sync`);
      }
    } else {
      console.log('[fixtures] Live sync: no new NKR fixtures found');
    }
    lastFixtureSync = Date.now();
  } catch (err) {
    console.warn('[fixtures] Live sync failed (using hardcoded fallback):', err.message);
  }
}

// Trigger sync on startup and every 6 hours
syncFixturesFromCricbuzz();
setInterval(syncFixturesFromCricbuzz, FIXTURE_SYNC_INTERVAL);

// Auto-resolve status: if date has passed (IST end of day), treat as completed
function resolveFixtureStatus(f) {
  if (f.status === 'completed') return 'completed';
  const matchEnd = new Date(f.date + 'T23:59:59+05:30');
  return new Date() > matchEnd ? 'completed' : 'upcoming';
}

// Build the "next 5 matches" list relative to now.
// Only confirmed (officially announced) fixtures are shown — speculative
// "TBD" placeholders are kept in NKR_FIXTURES for planning but hidden until
// confirmed (either manually, by setting confirmed: true, or automatically
// by live sync once the real schedule is published).
function getUpcomingFixtures(limit = 5) {
  return liveFixtures
    .filter(f => f.confirmed !== false)
    .filter(f => resolveFixtureStatus(f) === 'upcoming')
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, limit)
    .map(f => {
      const venue = findVenue(f.venueKey);
      return {
        date: f.date,
        timeIST: f.timeIST,
        timeLocal: f.timeLocal || null,
        match: f.match,
        format: f.format,
        venue: venue.venue,
        city: venue.city,
        country: venue.country,
        flag: venue.flag,
        category: f.category || 'international',
        status: resolveFixtureStatus(f),
        confirmed: f.confirmed !== false
      };
    });
}

// Return ALL fixtures for the full schedule calendar.
// Unconfirmed/speculative placeholder fixtures are excluded by default so
// the calendar only shows officially announced matches.
function getAllFixtures() {
  return liveFixtures
    .filter(f => f.confirmed !== false)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map(f => {
      const venue = findVenue(f.venueKey);
      return {
        date: f.date,
        timeIST: f.timeIST,
        timeLocal: f.timeLocal || null,
        match: f.match,
        format: f.format,
        venue: venue.venue,
        city: venue.city,
        country: venue.country,
        flag: venue.flag,
        category: f.category || 'international',
        status: resolveFixtureStatus(f),
        confirmed: f.confirmed !== false
      };
    });
}

// A headline only counts as an NKR location signal if it's actually ABOUT NKR
// (or is an official BCCI/India-squad source). This stops unrelated domestic
// league news — e.g. APL "Vizag Lions vs Vijayawada Sunshiners" predictions —
// from being mistaken for NKR's whereabouts just because it contains "Vizag".
// NOTE: NKR currently plays for Bhimavaram Bulls in APL, NOT Vizag Lions —
// so any APL/Vizag Lions article is never a valid NKR signal regardless.
// isStrictlyNKR: item title must explicitly mention Nitish Kumar Reddy or NKR
// This prevents generic SRH/Team India news from polluting the NKR feed.
function isStrictlyNKR(title) {
  return /nitish\s*(kumar)?\s*reddy|\bNKR\b/i.test(title);
}

function isGenuineNkrSignal(item) {
  const title = (item.title || '').toLowerCase();
  const sourceName = (item.source || '').toLowerCase();

  // Direct mention of NKR by name
  if (/nitish\s*(kumar)?\s*reddy|\bnkr\b/.test(title)) return true;

  // Official India/BCCI squad, travel or practice updates count even
  // without naming NKR explicitly, since he's part of the squad.
  if (/bcci|team india|india squad|india.*(travel|practice|arrive|depart)/.test(title)
      && sourceName.includes('bcci squad')) return true;

  // Reject anything that's clearly a different domestic league/team
  // (e.g. APL, Vizag Lions, Vijayawada Sunshiners, Bhimavaram Bulls fixtures
  // that don't mention NKR by name above).
  if (/\bapl\b|vizag lions|vijayawada sunshiners|bhimavaram bulls/.test(title)) return false;

  return false;
}

// Derive NKR's location from the active or most recently completed India
// fixture when no genuine news signal is available. This reflects the
// logical rule: NKR travels with the India squad, so his location follows
// the squad's current/most recent venue.
function getFixtureBasedLocation() {
  const fixtures = (typeof liveFixtures !== 'undefined' && liveFixtures.length) ? liveFixtures : NKR_FIXTURES;
  const sorted = fixtures.slice().sort((a, b) => new Date(a.date) - new Date(b.date));

  const now = new Date();
  // Prefer the most recently completed/ongoing fixture (squad likely still
  // at or near that venue until they travel to the next one).
  let candidate = null;
  let nextFixture = null;
  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i];
    const matchEnd = new Date(f.date + 'T23:59:59+05:30');
    if (matchEnd <= now) {
      candidate = f; // keep advancing to the latest past fixture
      nextFixture = sorted[i + 1] || null;
    } else {
      if (!candidate) nextFixture = f;
      break;
    }
  }
  // If no past fixture, fall back to the next upcoming one (squad likely
  // already travelling to / at that venue ahead of the match).
  if (!candidate) candidate = sorted.find(f => resolveFixtureStatus(f) === 'upcoming') || null;
  if (!candidate) return null;

  const venue = findVenue(candidate.venueKey);
  const isPast = new Date(candidate.date + 'T23:59:59+05:30') <= now;

  // TRAVEL WINDOW: once a match has finished and there's a next fixture
  // within ~3 days, assume the squad is in transit toward (or has already
  // arrived at) the next venue — without a named-NKR signal we can't be
  // certain, so confidence stays moderate.
  if (isPast && nextFixture) {
    const daysSinceMatch = (now - new Date(candidate.date + 'T23:59:59+05:30')) / 86400000;
    const daysUntilNext = (new Date(nextFixture.date + 'T00:00:00+05:30') - now) / 86400000;
    if (daysSinceMatch >= 1 && daysUntilNext <= 3) {
      const nextVenue = findVenue(nextFixture.venueKey);
      return {
        venue: nextVenue,
        source: `Squad likely travelling to ${nextVenue.city} ahead of ${nextFixture.match} (${nextFixture.format}) on ${nextFixture.date} — no NKR-specific confirmation yet`,
        sourceLink: null,
        sourceName: 'NKR Fixture Schedule (squad travel window)',
        pubDate: candidate.date,
        confidence: 50
      };
    }
  }

  return {
    venue,
    source: `${candidate.match} (${candidate.format}) — ${isPast ? 'just played' : 'upcoming'} at ${venue.venue}, ${venue.city}`,
    sourceLink: null,
    sourceName: 'NKR Fixture Schedule (with India squad)',
    pubDate: candidate.date,
    confidence: isPast ? 70 : 60
  };
}

function detectNkrLocation() {
  const relevant = newsItems
    .filter(i => i.category === 'nkr' || i.category === 'sports')
    .slice(0, 50);

  const signals = [];
  for (const item of relevant) {
    if (!isGenuineNkrSignal(item)) continue; // skip unrelated APL/domestic noise
    const title = item.title.toLowerCase();
    for (const venue of VENUES) {
      if (venue.keys.some(k => title.includes(k))) {
        signals.push({
          venue,
          source: item.title,
          sourceLink: item.link,
          sourceName: item.source,
          pubDate: item.pubDate,
          confidence: computeSignalConfidence(item.source, item.pubDate)
        });
        break;
      }
    }
  }

  if (signals.length === 0) {
    // No NKR-named signal — fall back directly to the India squad's fixture
    // schedule, since NKR travels with the team. (The previous "team
    // sighting" tier — presuming NKR's location from generic squad-travel
    // posts that didn't name him — was too unreliable and produced wrong
    // live locations, so it has been removed.)
    const fixtureLoc = getFixtureBasedLocation();
    if (fixtureLoc) {
      return {
        venue: fixtureLoc.venue,
        source: fixtureLoc.source,
        sourceLink: fixtureLoc.sourceLink,
        pubDate: fixtureLoc.pubDate,
        confidence: fixtureLoc.confidence,
        sourceCount: 1,
        allSignals: [{
          city: fixtureLoc.venue.city,
          venue: fixtureLoc.venue.venue,
          sourceName: fixtureLoc.sourceName,
          confidence: fixtureLoc.confidence,
          pubDate: fixtureLoc.pubDate,
          isVision: false,
          isFan: false
        }],
        isHomeDefault: false,
        isFixtureBased: true
      };
    }
    return { venue: HOME_LOCATION, source: null, sourceLink: null, pubDate: null, confidence: 0, sourceCount: 0, allSignals: [], isHomeDefault: true };
  }

  // Group by city, combine confidence (multi-source bonus)
  const cityMap = {};
  signals.forEach(s => {
    const k = s.venue.city;
    if (!cityMap[k]) cityMap[k] = { venue: s.venue, signals: [] };
    cityMap[k].signals.push(s);
  });

  let bestCity = null, bestScore = 0;
  Object.entries(cityMap).forEach(([city, entry]) => {
    const sorted = entry.signals.sort((a, b) => b.confidence - a.confidence);
    const countBonus  = Math.min(12, (sorted.length - 1) * 4); // up to +12 for 3+ sources
    const fanBoost    = computeFanSignalBoost(city, signals);   // up to +20 for diverse recent signals
    const combined    = Math.min(99, sorted[0].confidence + countBonus + fanBoost);
    entry.combined    = combined;
    entry.fanBoost    = fanBoost;
    if (combined > bestScore) { bestScore = combined; bestCity = city; }
  });

  const winner = cityMap[bestCity];
  const top = winner.signals[0];

  return {
    venue: top.venue,
    source: top.source,
    sourceLink: top.sourceLink,
    pubDate: top.pubDate,
    confidence: winner.combined,
    sourceCount: winner.signals.length,
    fanBoost: winner.fanBoost || 0,
    allSignals: signals.slice(0, 8).map(s => ({
      city: s.venue.city,
      venue: s.venue.venue,
      sourceName: s.sourceName,
      confidence: s.confidence,
      pubDate: s.pubDate,
      isVision: !!(s.sourceName && s.sourceName.includes('Vision')),
      isFan: !!(s.sourceName && /instagram|twitter|x\.com|reddit|youtube|cse|facebook/i.test(s.sourceName))
    })),
    isHomeDefault: false
  };
}

async function fetchWeatherFor(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code`
    + `&daily=sunrise,sunset,uv_index_max&timezone=auto`;
  // Add cache-buster so Open-Meteo always returns fresh data, not CDN-cached response
  const bust = `&_t=${Math.floor(Date.now()/60000)}`; // changes every minute
  const r = await fetch(url + bust, { timeout: 10000 });
  if (!r.ok) throw new Error(`upstream status ${r.status}`);
  return r.json();
}

let nkrStatusCache = null;
let nkrStatusInFlight = null;
const NKR_STATUS_MIN_INTERVAL_MS = 2 * 60 * 1000; // refresh at most every 2 minutes

async function buildNkrStatus() {
  const locationData = detectNkrLocation();
  const { venue, source, sourceLink, pubDate } = locationData;
  const upcomingFixtures = getUpcomingFixtures(5);

  // Gather CricAPI live venue string (if any)
  const cricItems = newsItems.filter(i => i.source && i.source.startsWith('CricAPI'));
  const cricapiVenueStr = cricItems.map(i => i.title).join('\n') || null;

  // Gemini AI inference (runs in parallel with weather)
  const [weather, geminiResult] = await Promise.all([
    fetchWeatherFor(venue.lat, venue.lon).catch(e => { console.error('Weather error:', e.message); return null; }),
    inferLocationWithGemini(newsItems, cricapiVenueStr, upcomingFixtures)
  ]);

  // If Gemini is confident AND gives a different city, try to resolve venue coords
  let resolvedVenue = venue;
  let resolvedSource = source;
  let resolvedSourceLink = sourceLink;
  if (geminiResult && geminiResult.confidence >= 60) {
    const geminiCity = (geminiResult.city || '').toLowerCase();
    const matched = VENUES.find(v => v.keys.some(k => geminiCity.includes(k) || k.includes(geminiCity)));
    if (matched) resolvedVenue = matched;
    resolvedSource = geminiResult.primarySignal || source;
    resolvedSourceLink = sourceLink; // keep original article link
  }

  // Final weather for resolved venue (may differ from initial if Gemini gave a different city)
  let finalWeather = weather;
  if (resolvedVenue !== venue) {
    finalWeather = await fetchWeatherFor(resolvedVenue.lat, resolvedVenue.lon).catch(() => weather);
  }

  // Merge confidence: take whichever is higher — rule-based or Gemini
  const ruleConfidence = locationData.confidence || 0;
  const geminiConfidence = geminiResult?.confidence || 0;
  const finalConfidence = Math.max(ruleConfidence, geminiConfidence);

  return {
    location: {
      city: resolvedVenue.city,
      country: resolvedVenue.country,
      flag: resolvedVenue.flag,
      venue: resolvedVenue.venue,
      lat: resolvedVenue.lat,
      lon: resolvedVenue.lon,
      detectedFrom: resolvedSource,
      detectedFromLink: resolvedSourceLink,
      detectedAt: pubDate,
      confidence: finalConfidence,
      sourceCount: locationData.sourceCount || 0,
      fanBoost: locationData.fanBoost || 0,
      allSignals: locationData.allSignals || [],
      isHomeDefault: locationData.isHomeDefault && !geminiResult,
      isFixtureBased: !!locationData.isFixtureBased,
      gemini: geminiResult ? {
        city: geminiResult.city,
        confidence: geminiResult.confidence,
        reasoning: geminiResult.reasoning,
        primarySignal: geminiResult.primarySignal
      } : null
    },
    weather: finalWeather,
    nextMatches: upcomingFixtures,
    allFixtures: getAllFixtures(),
    generatedAt: Date.now()
  };
}

app.get('/api/nkr-status', async (req, res) => {
  const now = Date.now();
  const force = req.query.refresh === '1';
  const isStale = !nkrStatusCache || (now - nkrStatusCache.generatedAt) > NKR_STATUS_MIN_INTERVAL_MS;

  if ((force || isStale) && !nkrStatusInFlight) {
    nkrStatusInFlight = buildNkrStatus().then(result => {
      nkrStatusCache = result;
      nkrStatusInFlight = null;
      return nkrStatusCache;
    }).catch(err => {
      nkrStatusInFlight = null;
      throw err;
    });
  }

  try {
    if (nkrStatusInFlight) await nkrStatusInFlight;
    res.json(nkrStatusCache);
  } catch (e) {
    console.error('NKR status error:', e.message);
    res.status(503).json({ error: 'nkr status build failed' });
  }
});

// ============================================================
//  NKR MATCH DAY TRACKER  (v2.1)
//  Detects NKR's match-day status (pre-toss / Playing XI / live
//  batting+bowling+fielding / post-match performance) using only
//  verified official data from CricAPI. Never guesses or fabricates
//  Playing XI status or non-selection reasons — if real data isn't
//  available yet, the UI shows a transitional state or "Not officially
//  announced" rather than inventing an answer.
// ============================================================

const NKR_NAME_RE = /nitish\s*(kumar)?\s*reddy/i;
const NKR_ROLE = 'Batting All-Rounder';
const NKR_NON_SELECTION_REASON_CATEGORIES = [
  'Injury', 'Rested', 'Team Combination', 'Tactical Decision', 'Workload Management'
];

// Manually-set, password-protected override for NKR's non-selection reason.
// NEVER auto-generated — only ever populated via POST /admin/matchday/reason
// once a human has verified the official reason (team announcement, BCCI,
// press conference, trusted broadcaster confirmation, etc).
let matchDayReasonOverride = null; // { date, reason }

// First-detected completion snapshot per match, so the 12-hour visibility
// window is measured from a stable timestamp rather than being recomputed
// (and potentially reset) on every poll.
const matchDayCompletionLog = {}; // matchId -> { completedAt, battingLine, bowlingLine, catches, result }

function fixtureDaySpan(format = '') {
  // Red-ball formats run multiple days — widen the "is this match today" window.
  return /test|ranji|duleep|irani/i.test(format) ? 4 : 1;
}

function getISTDateString(d = new Date()) {
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().split('T')[0];
}

// Parses a fixture's date + timeIST string (e.g. "1:30 PM (India)") into a
// real UTC timestamp, so the client-side countdown is accurate regardless
// of the viewer's own timezone. Returns null if the time can't be parsed
// (e.g. a still-TBA fixture) — frontend falls back to date-only display.
function parseFixtureStartUTC(fixture) {
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(fixture.timeIST || '');
  if (!m) return null;
  let [, h, min, ampm] = m;
  h = parseInt(h, 10);
  if (/pm/i.test(ampm) && h !== 12) h += 12;
  if (/am/i.test(ampm) && h === 12) h = 0;
  const hh = String(h).padStart(2, '0');
  const dt = new Date(`${fixture.date}T${hh}:${min}:00+05:30`);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

// Finds today's NKR fixture, if any — only confirmed (officially announced)
// fixtures count, and "today" must fall inside the match's day-window
// (wider for multi-day red-ball formats).
function getTodaysNkrFixture() {
  const todayIST = getISTDateString();
  const today = new Date(todayIST + 'T00:00:00+05:30');
  for (const f of liveFixtures) {
    if (f.confirmed === false) continue;
    const span = fixtureDaySpan(f.format);
    const start = new Date(f.date + 'T00:00:00+05:30');
    const end = new Date(start.getTime() + span * 24 * 60 * 60 * 1000);
    if (today >= start && today < end) return f;
  }
  return null;
}

// ---------- CricAPI: match-day specific lookups ----------
// Separate from the existing fetchCricAPI() (used only for location-signal
// headlines). Every function here returns null when CRIC_API_KEY isn't
// configured, or when CricAPI has no data yet — never fabricated.

const matchDayApiCache = {}; // key -> { data, at }
function mdCacheGet(key, ttlMs) {
  const c = matchDayApiCache[key];
  return (c && Date.now() - c.at < ttlMs) ? c.data : undefined;
}
function mdCacheSet(key, data) {
  matchDayApiCache[key] = { data, at: Date.now() };
  return data;
}

async function cricapiFindMatchId(fixture) {
  if (!config.CRIC_API_KEY) return null;
  const cacheKey = `matchId:${fixture.date}:${fixture.match}`;
  const cached = mdCacheGet(cacheKey, 5 * 60 * 1000);
  if (cached !== undefined) return cached;
  try {
    const url = `https://api.cricapi.com/v1/currentMatches?apikey=${config.CRIC_API_KEY}&offset=0`;
    const res = await fetch(url, { timeout: 10000, headers: { 'User-Agent': 'NKRlive/2.1' } });
    const data = await res.json();
    if (!data.data) return mdCacheSet(cacheKey, null);
    const teamsNeedle = fixture.match.toLowerCase();
    const found = data.data.find(m => {
      const teams = ((m.teams || []).join(' ') + ' ' + (m.name || '')).toLowerCase();
      return teamsNeedle.split(' vs ').every(t => teams.includes(t.trim()));
    });
    return mdCacheSet(cacheKey, found ? found.id : null);
  } catch (err) {
    console.error('[MatchDay] cricapiFindMatchId error:', err.message);
    return null;
  }
}

async function cricapiMatchInfo(matchId) {
  if (!config.CRIC_API_KEY || !matchId) return null;
  const cacheKey = `info:${matchId}`;
  const cached = mdCacheGet(cacheKey, 45 * 1000);
  if (cached !== undefined) return cached;
  try {
    const url = `https://api.cricapi.com/v1/match_info?apikey=${config.CRIC_API_KEY}&id=${matchId}`;
    const res = await fetch(url, { timeout: 10000, headers: { 'User-Agent': 'NKRlive/2.1' } });
    const data = await res.json();
    return mdCacheSet(cacheKey, (data && data.data) || null);
  } catch (err) {
    console.error('[MatchDay] cricapiMatchInfo error:', err.message);
    return null;
  }
}

async function cricapiMatchSquad(matchId) {
  if (!config.CRIC_API_KEY || !matchId) return null;
  const cacheKey = `squad:${matchId}`;
  const cached = mdCacheGet(cacheKey, 60 * 1000);
  if (cached !== undefined) return cached;
  try {
    const url = `https://api.cricapi.com/v1/match_squad?apikey=${config.CRIC_API_KEY}&id=${matchId}`;
    const res = await fetch(url, { timeout: 10000, headers: { 'User-Agent': 'NKRlive/2.1' } });
    const data = await res.json();
    return mdCacheSet(cacheKey, (data && data.data) || null);
  } catch (err) {
    console.error('[MatchDay] cricapiMatchSquad error:', err.message);
    return null;
  }
}

async function cricapiMatchScorecard(matchId) {
  if (!config.CRIC_API_KEY || !matchId) return null;
  const cacheKey = `scorecard:${matchId}`;
  const cached = mdCacheGet(cacheKey, 20 * 1000);
  if (cached !== undefined) return cached;
  try {
    const url = `https://api.cricapi.com/v1/match_scorecard?apikey=${config.CRIC_API_KEY}&id=${matchId}`;
    const res = await fetch(url, { timeout: 10000, headers: { 'User-Agent': 'NKRlive/2.1' } });
    const data = await res.json();
    return mdCacheSet(cacheKey, (data && data.data) || null);
  } catch (err) {
    console.error('[MatchDay] cricapiMatchScorecard error:', err.message);
    return null;
  }
}

// ---------- Extraction helpers ----------
// NOTE: exact CricAPI free-tier field names for match_squad / match_scorecard
// could not be verified against a live response in this sandbox (cricapi.com
// is outside the network allowlist here). These functions check several
// plausible key spellings defensively; if real responses differ, extend the
// alternates below — never substitute a guessed value.

function squadExplicitPlayingStatus(squad) {
  if (!squad) return 'unknown';
  const teams = Array.isArray(squad) ? squad : (squad.teams || squad.squad || []);
  for (const team of teams) {
    const players = team.players || team.squad || team.team || [];
    for (const p of players) {
      const name = p.name || p.player || '';
      if (!NKR_NAME_RE.test(name)) continue;
      if (typeof p.playingXI === 'boolean') return p.playingXI ? 'in' : 'out';
      if (typeof p.playing11 === 'boolean') return p.playing11 ? 'in' : 'out';
      if (typeof p.isPlaying11 === 'boolean') return p.isPlaying11 ? 'in' : 'out';
      if (typeof p.isPlaying === 'boolean') return p.isPlaying ? 'in' : 'out';
      const role = (p.role || p.status || '').toLowerCase();
      if (/not\s*play|substitute|reserve|not\s*in\s*xi/.test(role)) return 'out';
      // Present in a full squad list with no explicit flag → stays 'unknown'
      // (squads often list more than 11 players; presence alone isn't proof).
    }
  }
  return 'unknown';
}

function mdNum(v, fallback = null) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

function findNkrBattingEntry(scorecard) {
  if (!scorecard) return null;
  const innings = Array.isArray(scorecard) ? scorecard : (scorecard.scorecard || scorecard.innings || []);
  for (const inn of innings) {
    const batting = inn.batting || inn.batsman || inn.bat || [];
    for (const b of batting) {
      const name = b.batsman || b.name || b.player || '';
      if (!NKR_NAME_RE.test(name)) continue;
      const dismissal = b.dismissal || b['dismissal-text'] || b.outDesc || '';
      return {
        runs: mdNum(b.r ?? b.runs, 0),
        balls: mdNum(b.b ?? b.balls, 0),
        fours: mdNum(b['4s'] ?? b.fours, 0),
        sixes: mdNum(b['6s'] ?? b.sixes, 0),
        strikeRate: mdNum(b.sr ?? b.strikeRate, 0),
        notOut: !dismissal || /not\s*out/i.test(dismissal),
        dismissal
      };
    }
  }
  return null;
}

function findNkrBowlingEntry(scorecard) {
  if (!scorecard) return null;
  const innings = Array.isArray(scorecard) ? scorecard : (scorecard.scorecard || scorecard.innings || []);
  for (const inn of innings) {
    const bowling = inn.bowling || inn.bowler || inn.bowl || [];
    for (const b of bowling) {
      const name = b.bowler || b.name || b.player || '';
      if (!NKR_NAME_RE.test(name)) continue;
      return {
        overs: mdNum(b.o ?? b.overs, 0),
        runsConceded: mdNum(b.r ?? b.runs, 0),
        wickets: mdNum(b.w ?? b.wickets, 0),
        economy: mdNum(b.eco ?? b.economy, 0),
        maidens: mdNum(b.m ?? b.maidens, 0)
      };
    }
  }
  return null;
}

function countNkrCatches(scorecard) {
  if (!scorecard) return 0;
  const innings = Array.isArray(scorecard) ? scorecard : (scorecard.scorecard || scorecard.innings || []);
  let count = 0;
  for (const inn of innings) {
    const batting = inn.batting || inn.batsman || inn.bat || [];
    for (const b of batting) {
      const dismissal = (b.dismissal || b['dismissal-text'] || b.outDesc || '').trim();
      if (/^c[\s.]/i.test(dismissal) && NKR_NAME_RE.test(dismissal)) count++;
    }
  }
  return count;
}

function nkrAppearsAnywhere(scorecard) {
  return !!(findNkrBattingEntry(scorecard) || findNkrBowlingEntry(scorecard) || countNkrCatches(scorecard) > 0);
}

// ---------- Main builder ----------

let matchDayCache = null;
let matchDayInFlight = null;
const MATCHDAY_MIN_INTERVAL_MS = 12 * 1000; // refresh at most every 12s

async function buildNkrMatchDay() {
  const fixture = getTodaysNkrFixture();
  if (!fixture) return { isMatchDay: false, generatedAt: Date.now() };

  const venue = findVenue(fixture.venueKey);
  const fixtureOut = {
    match: fixture.match, format: fixture.format,
    venue: venue.venue, city: venue.city, flag: venue.flag, timeIST: fixture.timeIST
  };
  const matchStartUTC = parseFixtureStartUTC(fixture);

  if (!config.CRIC_API_KEY) {
    return {
      isMatchDay: true, generatedAt: Date.now(), fixture: fixtureOut, matchStartUTC,
      dataSource: 'unconfigured', phase: 'pre-toss', toss: null,
      playingXI: { status: 'unknown', role: NKR_ROLE, reason: null }, live: null, performance: null,
      note: 'Add a CRIC_API_KEY (cricapi.com) to enable live toss, Playing XI and ball-by-ball tracking.'
    };
  }

  const matchId = await cricapiFindMatchId(fixture);
  if (!matchId) {
    return {
      isMatchDay: true, generatedAt: Date.now(), fixture: fixtureOut, matchStartUTC,
      dataSource: 'cricapi', phase: 'pre-toss', toss: null,
      playingXI: { status: 'unknown', role: NKR_ROLE, reason: null }, live: null, performance: null,
      note: 'Match not yet visible on CricAPI — checking again shortly.'
    };
  }

  // Already-logged completion → honor the 12-hour window from the STABLE
  // first-seen timestamp, without recomputing anything from live data again.
  const existingLog = matchDayCompletionLog[matchId];
  if (existingLog) {
    const hoursElapsed = (Date.now() - existingLog.completedAt) / (60 * 60 * 1000);
    if (hoursElapsed >= 12) return { isMatchDay: false, generatedAt: Date.now() };
    return {
      isMatchDay: true, generatedAt: Date.now(), fixture: fixtureOut, matchStartUTC,
      dataSource: 'cricapi', phase: 'completed', toss: null,
      playingXI: { status: 'in', role: NKR_ROLE, reason: null }, live: null,
      performance: {
        battingLine: existingLog.battingLine, bowlingLine: existingLog.bowlingLine,
        catches: existingLog.catches, result: existingLog.result, completedAt: existingLog.completedAt
      },
      note: null
    };
  }

  const [info, squad, scorecard] = await Promise.all([
    cricapiMatchInfo(matchId), cricapiMatchSquad(matchId), cricapiMatchScorecard(matchId)
  ]);

  const matchStatus = (info && info.status) || '';
  const tossDone = !!(info && (info.tossWinner || info.toss));
  const toss = tossDone ? {
    winner: info.tossWinner || (info.toss && info.toss.winner) || null,
    decision: info.tossDecision || (info.toss && info.toss.decision) || null
  } : null;
  const isCompleted = !!(info && (info.matchEnded === true || /won|tied|abandoned|no result/i.test(matchStatus)));

  // ---- Playing XI status — never guessed ----
  let xiStatus = 'unknown';
  const explicit = squadExplicitPlayingStatus(squad);
  if (explicit !== 'unknown') xiStatus = explicit;
  else if (nkrAppearsAnywhere(scorecard)) xiStatus = 'in';
  else if (isCompleted) xiStatus = 'out'; // full match over, NKR never appeared anywhere

  // ---- Non-selection reason — NEVER auto-generated ----
  let reason = null;
  if (xiStatus === 'out' && matchDayReasonOverride && matchDayReasonOverride.date === fixture.date) {
    reason = matchDayReasonOverride.reason;
  }

  // ---- Phase ----
  let phase;
  if (!tossDone) phase = 'pre-toss';
  else if (xiStatus === 'unknown') phase = 'xi-pending';
  else if (xiStatus === 'out') phase = isCompleted ? 'completed' : 'not-playing';
  else phase = isCompleted ? 'completed' : 'playing-live';

  // ---- Live batting/bowling/fielding ----
  let live = null;
  if (xiStatus === 'in' && !isCompleted) {
    live = {
      matchStatus,
      batting: findNkrBattingEntry(scorecard),
      bowling: findNkrBowlingEntry(scorecard),
      catches: countNkrCatches(scorecard)
    };
  }

  // ---- Performance snapshot + completion logging (first time only) ----
  let performance = null;
  if (isCompleted && xiStatus === 'in') {
    const batting = findNkrBattingEntry(scorecard);
    const bowling = findNkrBowlingEntry(scorecard);
    const catches = countNkrCatches(scorecard);
    const battingLine = batting ? `${batting.runs}${batting.notOut ? '*' : ''} (${batting.balls})` : 'Did not bat';
    const bowlingLine = (bowling && bowling.overs > 0) ? `${bowling.wickets}/${bowling.runsConceded} (${bowling.overs})` : 'Did not bowl';
    const result = matchStatus || null;
    const completedAt = Date.now();
    matchDayCompletionLog[matchId] = { completedAt, battingLine, bowlingLine, catches, result };
    performance = { battingLine, bowlingLine, catches, result, completedAt };

    // Mirror into the fixture list immediately so "Upcoming Fixtures" shows
    // the real next match right away rather than waiting for midnight rollover.
    const fxEntry = liveFixtures.find(f => f.date === fixture.date && f.match === fixture.match);
    if (fxEntry) fxEntry.status = 'completed';
  }

  return {
    isMatchDay: true, generatedAt: Date.now(), fixture: fixtureOut, matchStartUTC,
    dataSource: 'cricapi', phase, toss,
    playingXI: { status: xiStatus, role: NKR_ROLE, reason }, live, performance, note: null
  };
}

app.get('/api/nkr-matchday', async (req, res) => {
  const now = Date.now();
  const force = req.query.refresh === '1';
  const isStale = !matchDayCache || (now - matchDayCache.generatedAt) > MATCHDAY_MIN_INTERVAL_MS;

  if ((force || isStale) && !matchDayInFlight) {
    matchDayInFlight = buildNkrMatchDay().then(result => {
      matchDayCache = result;
      matchDayInFlight = null;
      return matchDayCache;
    }).catch(err => {
      matchDayInFlight = null;
      throw err;
    });
  }

  try {
    if (matchDayInFlight) await matchDayInFlight;
    res.json(matchDayCache);
  } catch (e) {
    console.error('NKR matchday error:', e.message);
    res.status(503).json({ error: 'matchday build failed' });
  }
});

// ---------- FIXTURE ADMIN ENDPOINTS ----------
// POST /admin/fixtures/add  — manually add a fixture (password protected)
// POST /admin/fixtures/sync — force re-sync from Cricbuzz now
// GET  /admin/fixtures/list — see all current live fixtures

const ADMIN_PASS = process.env.ADMIN_PASS || 'vizag2026';

function checkAdmin(req, res) {
  const pass = req.headers['x-admin-pass'] || req.query.pass;
  if (pass !== ADMIN_PASS) { res.status(401).json({ error: 'Unauthorized' }); return false; }
  return true;
}

app.get('/admin/fixtures/list', (req, res) => {
  if (!checkAdmin(req, res)) return;
  res.json({
    count: liveFixtures.length,
    lastSync: lastFixtureSync ? new Date(lastFixtureSync).toISOString() : 'never',
    nkrConfirmedSeries: NKR_CONFIRMED_SERIES,
    fixtures: getAllFixtures()
  });
});

app.post('/admin/fixtures/sync', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  await syncFixturesFromCricbuzz();
  res.json({ ok: true, count: liveFixtures.length, lastSync: new Date(lastFixtureSync).toISOString() });
});

app.post('/admin/fixtures/add', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { date, timeIST, match, format, venueKey, timeLocal, seriesSlug } = req.body || {};
  if (!date || !timeIST || !match || !format || !venueKey) {
    return res.status(400).json({ error: 'Missing required fields: date, timeIST, match, format, venueKey' });
  }
  if (seriesSlug && !NKR_CONFIRMED_SERIES.includes(seriesSlug)) {
    NKR_CONFIRMED_SERIES.push(seriesSlug);
  }
  const key = date + format;
  if (liveFixtures.find(f => f.date + f.format === key)) {
    return res.status(409).json({ error: 'Fixture already exists', key });
  }
  liveFixtures.push({ date, timeIST, timeLocal: timeLocal || null, match, format, venueKey, status: 'upcoming', source: 'manual' });
  liveFixtures.sort((a, b) => new Date(a.date) - new Date(b.date));
  nkrStatusCache = null;
  res.json({ ok: true, added: { date, timeIST, timeLocal, match, format, venueKey }, total: liveFixtures.length });
});

app.post('/admin/fixtures/series', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { seriesSlug } = req.body || {};
  if (!seriesSlug) return res.status(400).json({ error: 'Missing seriesSlug' });
  if (!NKR_CONFIRMED_SERIES.includes(seriesSlug)) NKR_CONFIRMED_SERIES.push(seriesSlug);
  res.json({ ok: true, nkrConfirmedSeries: NKR_CONFIRMED_SERIES });
});

// ---------- MATCH DAY ADMIN ENDPOINTS ----------
// GET  /admin/matchday/reason — view current non-selection reason override
// POST /admin/matchday/reason — manually record NKR's VERIFIED OFFICIAL
//   non-selection reason for today's fixture. The tracker never infers or
//   guesses a reason on its own — this is the only way one is ever set.

app.get('/admin/matchday/reason', (req, res) => {
  if (!checkAdmin(req, res)) return;
  res.json({
    current: matchDayReasonOverride,
    referenceCategories: NKR_NON_SELECTION_REASON_CATEGORIES,
    note: 'Only set this once you have a verified official reason (team/BCCI announcement, press conference, etc). The tracker never auto-generates one.'
  });
});

app.post('/admin/matchday/reason', (req, res) => {
  if (!checkAdmin(req, res)) return;
  const { reason, date } = req.body || {};
  if (!reason) return res.status(400).json({ error: 'Missing reason' });
  const fixture = getTodaysNkrFixture();
  const targetDate = date || (fixture && fixture.date) || getISTDateString();
  matchDayReasonOverride = { date: targetDate, reason };
  matchDayCache = null; // force the next poll to pick up the new reason immediately
  res.json({ ok: true, set: matchDayReasonOverride });
});

// ---------- HEALTH & STATUS ----------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptimeSeconds: Math.floor((Date.now() - startedAt.getTime()) / 1000) });
});

app.get('/api/status', (req, res) => {
  res.json({
    startedAt: startedAt.toISOString(),
    lastPollAt: lastPollAt ? lastPollAt.toISOString() : null,
    lastPollError,
    itemsCached: newsItems.length,
    connectedClients: wss.clients.size,
    pollIntervalMs: POLL_INTERVAL_MS,
    fixtures: {
      total: liveFixtures.length,
      upcoming: liveFixtures.filter(f => resolveFixtureStatus(f) === 'upcoming').length,
      lastSync: lastFixtureSync ? new Date(lastFixtureSync).toISOString() : 'never',
      nextSyncIn: lastFixtureSync ? Math.max(0, Math.round((lastFixtureSync + FIXTURE_SYNC_INTERVAL - Date.now()) / 60000)) + ' min' : 'soon'
    }
  });
});

// ---------- START ----------
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
// Cleanup expired (>24h) items every 30 minutes to prevent memory bloat
setInterval(() => {
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const before = newsItems.length;
  newsItems = newsItems.filter(i => new Date(i.pubDate || i.receivedAt || 0) > cutoff24h);
  if (newsItems.length < before) {
    console.log(`[cleanup] Expired ${before - newsItems.length} items older than 24h. Remaining: ${newsItems.length}`);
  }
}, 30 * 60 * 1000);

server.listen(PORT, HOST, () => {
  console.log(`NKRlive server running on ${HOST}:${PORT}`);
  pollAllSources(); // initial poll
  setInterval(pollAllSources, POLL_INTERVAL_MS);
});

// ---------- GRACEFUL SHUTDOWN ----------
function shutdown(signal) {
  console.log(`\nReceived ${signal}. Shutting down gracefully...`);
  clearInterval(heartbeat);
  wss.clients.forEach(client => client.close());
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
  // Force-exit if close hangs
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
