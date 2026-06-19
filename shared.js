/* ====================================================================
   NKRLIVE — SHARED UTILITIES
==================================================================== */

/* AP DISTRICTS — key -> display name (mirrors server-side AP_DISTRICTS) */
const VL_AP_DISTRICT_NAMES = {
  'anakapalli':'Anakapalli','bapatla':'Bapatla','konaseema':'Konaseema',
  'east-godavari':'East Godavari','eluru':'Eluru','guntur':'Guntur',
  'kakinada':'Kakinada','krishna':'Krishna','ntr':'NTR','palnadu':'Palnadu',
  'prakasam':'Prakasam','spsr-nellore':'Nellore','west-godavari':'West Godavari',
  'ananthapuramu':'Ananthapuramu','annamayya':'Annamayya','chittoor':'Chittoor',
  'kurnool':'Kurnool','nandyal':'Nandyal','sri-sathya-sai':'Sri Sathya Sai',
  'tirupati':'Tirupati','ysr-kadapa':'YSR Kadapa',
  'alluri-sitharama-raju':'Alluri Sitharama Raju','parvathipuram-manyam':'Parvathipuram Manyam',
  'srikakulam':'Srikakulam','visakhapatnam':'Visakhapatnam','vizianagaram':'Vizianagaram'
};
function vlDistrictName(key){
  return VL_AP_DISTRICT_NAMES[key] || key;
}

/* THEME TOGGLE */
(function(){
  const html = document.documentElement;
  const saved = localStorage.getItem('vl-theme') || 'dark';
  html.dataset.theme = saved;
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('themeBtn');
    if(btn){
      btn.addEventListener('click', () => {
        const next = html.dataset.theme === 'dark' ? 'light' : 'dark';
        html.dataset.theme = next;
        localStorage.setItem('vl-theme', next);
      });
    }
    const navToggle = document.getElementById('navToggle');
    const navLinks = document.getElementById('navLinks');
    if(navToggle && navLinks){
      navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));
    }
  });
})();

/* CLOCK */
function vlUpdateClock(){
  const now = new Date();
  const opts = { timeZone:'Asia/Kolkata' };
  const t = document.getElementById('clockTime');
  const d = document.getElementById('clockDate');
  const w = document.getElementById('clockDay');
  if(t) t.textContent = new Intl.DateTimeFormat('en-IN',{...opts,hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true}).format(now);
  if(d) d.textContent = new Intl.DateTimeFormat('en-IN',{...opts,day:'2-digit',month:'long',year:'numeric'}).format(now);
  if(w) w.textContent = new Intl.DateTimeFormat('en-IN',{...opts,weekday:'long'}).format(now) + ' · IST';
}

/* TIME AGO */
function vlTimeAgo(date){
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if(seconds < 5) return 'just now';
  if(seconds < 60) return seconds + 's ago';
  const minutes = Math.floor(seconds / 60);
  if(minutes < 60) return minutes + 'm ago';
  const hours = Math.floor(minutes / 60);
  if(hours < 24) return hours + 'h ago';
  return Math.floor(hours / 24) + 'd ago';
}

/* WMO ICONS */
const VL_WMO_ICONS = {
  0:"☀️ Clear sky",1:"🌤️ Mainly clear",2:"⛅ Partly cloudy",3:"☁️ Overcast",
  45:"🌫️ Fog",48:"🌫️ Fog",51:"🌦️ Light drizzle",53:"🌦️ Drizzle",55:"🌧️ Dense drizzle",
  61:"🌧️ Light rain",63:"🌧️ Rain",65:"🌧️ Heavy rain",80:"🌦️ Rain showers",
  81:"🌧️ Rain showers",82:"⛈️ Violent showers",95:"⛈️ Thunderstorm"
};
function vlWmoEmoji(code){
  const entry = VL_WMO_ICONS[code];
  if(!entry) return '🌡️';
  return entry.split(' ')[0];
}

/* Clear plain-language weather condition labels (e.g. "Sunny", "Cloudy", "Heavy rain") */
const VL_WMO_LABELS = {
  0:"Clear & sunny", 1:"Mostly sunny", 2:"Partly cloudy", 3:"Cloudy / overcast",
  45:"Foggy", 48:"Foggy (icy fog)",
  51:"Light drizzle", 53:"Drizzle", 55:"Heavy drizzle",
  56:"Light freezing drizzle", 57:"Freezing drizzle",
  61:"Light rain", 63:"Rainy", 65:"Heavy rain",
  66:"Light freezing rain", 67:"Freezing rain",
  71:"Light snow", 73:"Snowy", 75:"Heavy snow", 77:"Snow grains",
  80:"Light rain showers", 81:"Rain showers", 82:"Heavy rain showers",
  85:"Light snow showers", 86:"Heavy snow showers",
  95:"Thunderstorm", 96:"Thunderstorm with hail", 99:"Severe thunderstorm with hail"
};
function vlWmoLabel(code){
  return VL_WMO_LABELS[code] || 'Conditions unavailable';
}

/* TOAST */
function vlShowToast(msg){
  const toastContainer = document.getElementById('toast-container');
  if(!toastContainer) return;
  window.__vlToastQueue = window.__vlToastQueue || 0;
  if(window.__vlToastQueue > 2) return;
  window.__vlToastQueue++;
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="toast-dot"></span>${msg}`;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.remove();
    window.__vlToastQueue--;
  }, 3200);
}

/* SHARE */
function vlShareItem(url, title){
  if(navigator.share){
    navigator.share({ title, url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url).then(() => {
      vlShowToast('Link copied to clipboard');
    }).catch(() => {
      window.open(`https://wa.me/?text=${encodeURIComponent(title + ' ' + url)}`, '_blank');
    });
  }
}

/* NEWS ITEM BUILDER */
function vlBuildItemEl(item, compact=false){
  const d = new Date(item.pubDate);
  const when = isNaN(d) ? '' :
    d.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
  const flag = item.verified
    ? '<span class="dot-flag verified">verified</span>'
    : '<span class="dot-flag unverified">unverified</span>';
  const catBadge = item.category && !compact ? `<span class="badge-cat">${item.category}</span>` : '';
  const districtBadges = (!compact && item.districts && item.districts.length)
    ? item.districts.slice(0, 2).map(key => `<span class="badge-cat badge-district">${vlDistrictName(key)}</span>`).join('')
    : '';
  const extraSources = (item.relatedSources && item.relatedSources.length)
    ? `<span class="badge-cat" title="${item.relatedSources.map(s => s.source).join(', ').replace(/"/g,'&quot;')}">+${item.relatedSources.length} more source${item.relatedSources.length===1?'':'s'}</span>`
    : '';

  const el = document.createElement('div');
  el.className = 'news-item';

  el.innerHTML = `
    <div class="news-item-row">
      <a href="${item.link}" target="_blank" rel="noopener">${item.title}</a>
      <button class="share-btn" title="Share this story"
        onclick="vlShareItem('${item.link.replace(/'/g,"\\'")}','${item.title.replace(/'/g,"\\'").substring(0,80)}')">⬆</button>
    </div>
    <div class="news-meta">
      <span class="source">${item.source}</span>
      <span class="sep">·</span>
      <span>${when}</span>
      ${flag}
      ${catBadge}
      ${districtBadges}
      ${extraSources}
    </div>`;
  return el;
}

/* CLOCK init */
document.addEventListener('DOMContentLoaded', () => {
  if(document.getElementById('clockTime')){
    setInterval(vlUpdateClock, 1000);
    vlUpdateClock();
  }
});

/* ====================================================================
   WEBSOCKET — shared reconnect helpers
   Usage: call vlWsConnect(buildWs) from each page.
   buildWs() must return a configured WebSocket instance.
   Provides: exponential backoff, visibility-aware reconnect,
             backoff reset on success, max 30s cap.
==================================================================== */
function vlWsReconnect(buildWsFn, delay, onReconnectUI) {
  // Clamp delay between 1s and 30s
  const next = Math.min(delay * 1.6, 30000);
  if (onReconnectUI) onReconnectUI();
  const tid = setTimeout(() => {
    if (document.hidden) {
      // If tab is hidden, wait until it's visible again
      document.addEventListener('visibilitychange', function handler() {
        if (!document.hidden) {
          document.removeEventListener('visibilitychange', handler);
          clearTimeout(tid);
          buildWsFn(next);
        }
      });
    } else {
      buildWsFn(next);
    }
  }, delay);
}

// Reconnect immediately when tab becomes visible if WS is closed
function vlWsVisibilityGuard(isAlive, reconnectFn) {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !isAlive()) reconnectFn();
  });
}
