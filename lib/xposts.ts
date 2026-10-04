/**
 * Reads a public X/Twitter post WITHOUT the paid X API, via the same public endpoint X uses for embedded tweets
 * (cdn.syndication.twimg.com). Returns the full text, author, date and the links inside the post.
 */
export interface Tweet { id: string; text: string; author: string; handle: string; createdAt: string | null; links: string[]; likes?: number; replies?: number }

export function tweetIdFromUrl(url: string): string | null {
  const m = url.match(/(?:x|twitter)\.com\/[^/]+\/status(?:es)?\/(\d{8,25})/i);
  return m ? m[1] : null;
}

// token algorithm used by react-tweet / X embeds
const tokenFor = (id: string) => ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');

export async function fetchTweet(id: string, timeoutMs = 10000): Promise<Tweet | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${tokenFor(id)}&lang=en`, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d?.text) return null;
    let text: string = d.text;
    const links: string[] = [];
    for (const u of d.entities?.urls || []) {
      if (u.expanded_url) {
        links.push(u.expanded_url);
        if (u.url) text = text.replace(u.url, u.expanded_url);
      }
    }
    if (d.note_tweet?.text) text = d.note_tweet.text; // long posts
    return { id, text, author: d.user?.name || '', handle: d.user?.screen_name || '', createdAt: d.created_at || null, links, likes: d.favorite_count, replies: d.conversation_count };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Live X search links (open in your logged-in browser) built from the Excel's X advanced-search formulas. */
export function xSearchLinks(): { label: string; url: string }[] {
  const q = (s: string) => `https://x.com/search?q=${encodeURIComponent(s)}&src=typed_query&f=live`;
  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  return [
    { label: 'Excel formula: hiring + AI/FDE + remote/India/Bangalore (7 days)', url: q(`(hiring OR "join us" OR "we're looking") (AI OR "ML engineer" OR "forward deployed" OR LLM) (remote OR India OR Bangalore) since:${since}`) },
    { label: 'Forward Deployed Engineer — hiring, no retweets', url: q(`("forward deployed" OR "FDE") (hiring OR "we're hiring" OR "join us") -is:retweet since:${since}`) },
    { label: 'ML / LLM engineer hiring, min 10 likes', url: q(`("ML engineer" OR "LLM engineer" OR "AI engineer") (hiring OR "join us") min_faves:10 -is:retweet since:${since}`) },
    { label: 'Bengaluru AI startups hiring', url: q(`(Bangalore OR Bengaluru OR BLR) hiring (AI OR LLM OR GenAI OR "applied AI") -is:retweet since:${since}`) },
    { label: 'Founders: "DM me" for AI roles', url: q(`("DM me" OR "DMs open") hiring (AI OR LLM OR "founding engineer") -is:retweet since:${since}`) },
    { label: 'Remote, open worldwide', url: q(`hiring (AI OR "ML engineer" OR "forward deployed") ("remote worldwide" OR "anywhere in the world" OR "fully remote") -is:retweet since:${since}`) },
    { label: 'Accounts from the Excel: @aijobsai, @aimljobs', url: q('from:aijobsai OR from:aimljobs') },
  ];
}

/** Live LinkedIn / job-board searches for platforms that have no API (Excel: Social_Media, Smart_Tricks "Be Early"). */
export function boardSearchLinks(): { group: string; label: string; url: string }[] {
  const li = (k: string, extra = '') => `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(k)}&datePosted=%22past-24h%22&sortBy=%22date_posted%22${extra}`;
  const lj = (k: string, loc: string, extra = '') => `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(k)}&location=${encodeURIComponent(loc)}&f_TPR=r86400&sortBy=DD${extra}`;
  return [
    { group: 'LinkedIn posts (stealth hiring)', label: '"hiring" "forward deployed" — last 24 h', url: li('hiring "forward deployed engineer"') },
    { group: 'LinkedIn posts (stealth hiring)', label: '"hiring" "AI engineer" Bangalore "DM me"', url: li('hiring "AI engineer" Bangalore "DM"') },
    { group: 'LinkedIn posts (stealth hiring)', label: '"we are hiring" GenAI / LLM remote India', url: li('"we are hiring" (GenAI OR LLM) remote India') },
    { group: 'LinkedIn jobs (past 24 h)', label: 'AI Engineer · Bengaluru', url: lj('AI Engineer', 'Bengaluru, Karnataka, India') },
    { group: 'LinkedIn jobs (past 24 h)', label: 'Forward Deployed Engineer · India remote', url: lj('Forward Deployed Engineer', 'India', '&f_WT=2') },
    { group: 'LinkedIn jobs (past 24 h)', label: 'ML / LLM Engineer · remote worldwide', url: lj('LLM Engineer', 'Worldwide', '&f_WT=2') },
    { group: 'India boards', label: 'Naukri · AI/ML · Bengaluru · last 1 day', url: 'https://www.naukri.com/machine-learning-ai-jobs-in-bangalore?jobAge=1' },
    { group: 'India boards', label: 'Naukri · GenAI · work from home · 1 day', url: 'https://www.naukri.com/generative-ai-jobs?wfhType=2&jobAge=1' },
    { group: 'India boards', label: 'Hirist · AI/ML', url: 'https://www.hirist.tech/c/ai-ml-jobs' },
    { group: 'India boards', label: 'iimjobs · machine learning', url: 'https://www.iimjobs.com/k/machine-learning-jobs' },
    { group: 'India boards', label: 'Foundit · AI · Bengaluru', url: 'https://www.foundit.in/srp/results?query=artificial%20intelligence&locations=Bengaluru' },
    { group: 'India boards', label: 'Cutshort · ML · Bengaluru', url: 'https://cutshort.io/jobs/machine-learning-jobs-in-bangalore' },
    { group: 'India boards', label: 'Instahyre · AI', url: 'https://www.instahyre.com/search-jobs/?skills=machine%20learning' },
    { group: 'India boards', label: 'eFinancialCareers · AI · India', url: 'https://www.efinancialcareers.com/jobs/artificial-intelligence/in-india' },
    { group: 'India boards', label: 'GfG Get Hired', url: 'https://www.geeksforgeeks.org/jobs' },
    { group: 'Startup boards', label: 'Wellfound · AI engineer · India', url: 'https://wellfound.com/role/l/ai-engineer/india' },
    { group: 'Startup boards', label: 'YC jobs · India', url: 'https://www.ycombinator.com/jobs/location/india' },
    { group: 'Startup boards', label: 'Work at a Startup · remote', url: 'https://www.workatastartup.com/companies?remote=yes&role=eng' },
    { group: 'Startup boards', label: 'Cord · remote AI', url: 'https://cord.com/' },
    { group: 'AI-only boards', label: 'aijobs.net (foorilla)', url: 'https://foorilla.com/hiring/' },
    { group: 'AI-only boards', label: 'job.careers', url: 'https://job.careers' },
    { group: 'AI-only boards', label: 'ai-jobs.careers (AI-depth scored)', url: 'https://ai-jobs.careers' },
    { group: 'AI-only boards', label: 'Alterwork · FDE & agent roles', url: 'https://alterwork.com/jobs' },
    { group: 'AI-only boards', label: 'hiring.cafe', url: 'https://hiring.cafe/?searchState=%7B%22searchQuery%22%3A%22forward%20deployed%22%7D' },
    { group: 'Remote boards', label: 'RemoteRocketship · ML · India', url: 'https://www.remoterocketship.com/country/india/jobs/machine-learning-engineer' },
    { group: 'Remote boards', label: 'Jobgether · AI', url: 'https://jobgether.com/search-offers?keyword=machine%20learning' },
    { group: 'Remote boards', label: 'Dynamite Jobs · AI', url: 'https://dynamitejobs.com/remote-jobs?q=ai' },
    { group: 'Remote boards', label: 'Remote.co developer', url: 'https://remote.co/remote-jobs/developer' },
    { group: 'Remote boards', label: 'RemoteBharat', url: 'https://remotebharat.com' },
    { group: 'Gig / contract', label: 'AIGigJobs · India', url: 'https://aigigjobs.com/locations/india' },
    { group: 'Gig / contract', label: 'OpenTrain.ai jobs', url: 'https://opentrain.ai/jobs' },
    { group: 'Gig / contract', label: 'micro1 talent', url: 'https://talent.micro1.ai' },
    { group: 'Newsletters (Friday sweep)', label: 'KDnuggets jobs', url: 'https://www.kdnuggets.com/jobs' },
    { group: 'Newsletters (Friday sweep)', label: 'ODSC jobs · remote / India', url: 'https://jobs.opendatascience.com/' },
    { group: 'Newsletters (Friday sweep)', label: 'Data Elixir board', url: 'https://hirement.com/listing/data-elixirs-job-board/' },
    { group: 'Communities', label: 'r/developersIndia referral threads', url: 'https://www.reddit.com/r/developersIndia/search/?q=referral&sort=new' },
    { group: 'Communities', label: 'HN Who is hiring (search)', url: 'https://hn.hiring-search.com/?q=AI%20remote' },
    { group: 'Communities', label: 'DataTalks.Club Slack #jobs', url: 'https://datatalks.club/slack' },
  ];
}
