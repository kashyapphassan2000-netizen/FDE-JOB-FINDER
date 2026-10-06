'use client';
import { useEffect, useRef, useState } from 'react';

/** Bookmarklet: sends the page you are viewing (your logged-in session) to /capture via postMessage — not blocked by site CSPs. */
function code(origin: string) {
  const js = `(()=>{const O=${JSON.stringify(origin)};const H=location.hostname,T=e=>(e&&e.innerText||'').trim();let P=[];if(/(^|\\.)(x|twitter)\\.com$/.test(H)){P=[...document.querySelectorAll('article[data-testid="tweet"]')].map(a=>{const t=a.querySelector('time');const l=t&&t.closest('a');return{platform:'x',url:l?l.href:'',postedAt:t?t.getAttribute('datetime'):null,author:T(a.querySelector('[data-testid="User-Name"]')),text:T(a.querySelector('[data-testid="tweetText"]'))}}).filter(p=>p.url&&p.text)}else if(/linkedin\\.com$/.test(H)){P=[...document.querySelectorAll('[data-urn*="urn:li:activity:"],[data-id*="urn:li:activity:"]')].map(a=>{const u=(a.getAttribute('data-urn')||a.getAttribute('data-id')).match(/activity:(\\d+)/);return{platform:'li',url:u?'https://www.linkedin.com/feed/update/urn:li:activity:'+u[1]+'/':'',postedAt:null,author:T(a.querySelector('.update-components-actor__title,.feed-shared-actor__title,.update-components-actor__name')).split('\\n')[0],text:T(a.querySelector('.update-components-text,.feed-shared-update-v2__description,.feed-shared-text'))||T(a).slice(0,3000)}}).filter(p=>p.url&&p.text)}const d={p:P,u:location.href,t:document.title,x:document.body.innerText.slice(0,150000),l:[...document.querySelectorAll('a[href]')].map(a=>[(a.innerText||a.getAttribute('aria-label')||'').trim().replace(/\\s+/g,' ').slice(0,140),a.href]).filter(x=>x[0]&&/^https?:/.test(x[1])).slice(0,1500)};const w=window.open(O+'/capture','fjcapture');if(!w){alert('Allow pop-ups for this site, then click again');return}const h=e=>{if(e.origin!==O||!e.data||e.data.type!=='fj-ready')return;w.postMessage({type:'fj-capture',nonce:e.data.nonce,data:d},O);window.removeEventListener('message',h)};window.addEventListener('message',h)})()`;
  return `javascript:${encodeURIComponent(js)}`;
}

export default function CaptureButton({ compact }: { compact?: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [open, setOpen] = useState(!compact);
  useEffect(() => { ref.current?.setAttribute('href', code(window.location.origin)); }, []);
  return (
    <div className="panel capture">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <a ref={ref} className="btn primary bookmarklet" onClick={(e) => { e.preventDefault(); alert('Drag this button to your bookmarks bar (don’t click it here). Then use it on Naukri, LinkedIn, X, Wellfound, Hirist…'); }} draggable>📥 Capture to FDE Finder</a>
          <b>← drag to your bookmarks bar once</b>
        </div>
        {compact && <button className="small-btn" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'How it works'}</button>}
      </div>
      {open && (
        <div className="small" style={{ marginTop: 8, lineHeight: 1.6 }}>
          Unlimited and free, for every site that blocks servers or needs your login — <b>Naukri, LinkedIn posts & jobs, X “Latest”, Wellfound, Hirist, iimjobs, Cutshort, Foundit, Instahyre, hiring.cafe, Glassdoor, company careers pages</b>:
          <ol style={{ margin: '4px 0 0' }}>
            <li>Open the search (use the 🔗 live-search links below — they are pre-filtered to the last 24 h / 7 days).</li>
            <li>Scroll a bit so the results load.</li>
            <li>Click <b>📥 Capture to FDE Finder</b> in your bookmarks bar → a small window opens, the AI imports every job / hiring post with its link (Bengaluru-or-remote rule applied).</li>
          </ol>
          On phone: add the bookmark in desktop Chrome first — it syncs. Pop-ups must be allowed for the site the first time.
        </div>
      )}
    </div>
  );
}
