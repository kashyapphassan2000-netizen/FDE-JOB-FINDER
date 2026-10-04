"""Builds data/platforms.json from the Excel workbook: maps EVERY platform in the Excel
to how the app tracks it (live API, live ATS, aggregated, deep-link, resource)."""
import openpyxl, re, json, sys
from urllib.parse import urlparse

XLSX = sys.argv[1] if len(sys.argv) > 1 else 'jobs.xlsx'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'data/platforms.json'
wb = openpyxl.load_workbook(XLSX)
url_re = re.compile(r'(https?://[^\s,;)\]\'"]+|\b[a-z0-9-]+\.(?:com|io|ai|co|in|app|net|org|tech|jobs|careers|club|dev|de|ch|uk)(?:/[^\s,;)\]\'"]*)?)', re.I)

# host -> (mapping, [connectors], search_template, kind)
# mapping: live_api | live_ats | aggregated | deep_link | resource | excluded
A = 'aggregated'; L = 'live_api'; T = 'live_ats'; D = 'deep_link'; R = 'resource'; X = 'excluded'
G = ['serpapi', 'jsearch']  # Google-for-Jobs based aggregators that index most boards
M = {
 'workatastartup.com': (L, ['yc_jobs'], 'https://www.workatastartup.com/jobs?query={q}', 'job_board'),
 'ycombinator.com': (L, ['yc_jobs'], 'https://www.ycombinator.com/jobs/location/india', 'job_board'),
 'wellfound.com': (A, G + ['linkedin'], 'https://wellfound.com/jobs?query={q}', 'job_board'),
 'mercor.com': (T, ['ashby:mercor'], 'https://work.mercor.com/', 'talent_marketplace'),
 'turing.com': (T, ['greenhouse:turing'], 'https://www.turing.com/jobs', 'talent_marketplace'),
 'aijobs.net': (A, G, 'https://aijobs.net/?key={q}', 'job_board'),
 'remotive.com': (L, ['remotive'], 'https://remotive.com/remote-jobs?query={q}', 'job_board'),
 'cutshort.io': (A, G, 'https://cutshort.io/jobs/{qslug}-jobs', 'job_board'),
 'instahyre.com': (L, ['instahyre'], 'https://www.instahyre.com/search-jobs/?skills={q}', 'job_board'),
 'alterwork.com': (D, [], 'https://alterwork.com/jobs', 'job_board'),
 'hired.com': (X, [], '', 'job_board'),
 'arc.dev': (D, [], 'https://arc.dev/remote-jobs?search={q}', 'talent_marketplace'),
 'remoterocketship.com': (D, [], 'https://www.remoterocketship.com/?jobTitle={q}', 'job_board'),
 'linkedin.com': (L, ['linkedin', 'jsearch', 'apify_linkedin'], 'https://www.linkedin.com/jobs/search/?keywords={q}&location=India&f_TPR=r86400', 'job_board'),
 'welcometothejungle.com': (D, [], 'https://www.welcometothejungle.com/en/jobs?query={q}', 'job_board'),
 'himalayas.app': (L, ['himalayas'], 'https://himalayas.app/jobs?q={q}', 'job_board'),
 'moaijobs.com': (D, [], 'https://www.moaijobs.com/', 'job_board'),
 'simplify.jobs': (D, [], 'https://simplify.jobs/jobs?query={q}', 'job_board'),
 'startup.jobs': (D, [], 'https://startup.jobs/?q={q}', 'job_board'),
 'toptal.com': (T, ['lever:toptal'], 'https://www.toptal.com/careers', 'talent_marketplace'),
 'andela.com': (T, ['ashby:andela'], 'https://andela.com/talent', 'talent_marketplace'),
 'naukri.com': (A, G, 'https://www.naukri.com/{qslug}-jobs-in-bengaluru?jobAge=3', 'job_board'),
 'indeed.com': (A, G, 'https://in.indeed.com/jobs?q={q}&l=India&fromage=3', 'job_board'),
 'kaggle.com': (R, [], 'https://www.kaggle.com/competitions', 'competition'),
 'internshala.com': (A, G, 'https://internshala.com/jobs/keywords-{qslug}/', 'job_board'),
 'remoteok.com': (L, ['remoteok'], 'https://remoteok.com/remote-ai-jobs', 'job_board'),
 'nodesk.co': (D, [], 'https://nodesk.co/remote-jobs/ai/', 'job_board'),
 'jobs.80000hours.org': (D, [], 'https://jobs.80000hours.org/?query={q}', 'job_board'),
 'farhorizons.io': (D, [], 'https://farhorizons.io', 'job_board'),
 'outlier.ai': (D, [], 'https://outlier.ai/experts', 'gig_rlhf'),
 'crossover.com': (D, [], 'https://www.crossover.com/jobs/ai-engineer/in', 'talent_marketplace'),
 'upwork.com': (D, [], 'https://www.upwork.com/nx/search/jobs/?q={q}&sort=recency', 'freelance'),
 'hirist.tech': (A, G, 'https://www.hirist.tech/search/{qslug}', 'job_board'),
 'iimjobs.com': (A, G, 'https://www.iimjobs.com/search/{qslug}', 'job_board'),
 'remotebharat.com': (D, [], 'https://remotebharat.com', 'job_board'),
 'hirect.in': (D, [], 'https://hirect.in', 'job_board'),
 'apna.co': (A, G, 'https://apna.co/jobs?search=true&text={q}', 'job_board'),
 'shine.com': (A, G, 'https://www.shine.com/job-search/{qslug}-jobs', 'job_board'),
 'techgig.com': (D, [], 'https://www.techgig.com/jobs', 'job_board'),
 'themuse.com': (L, ['themuse'], 'https://www.themuse.com/search/location/bangalore-india/keyword/{q}', 'job_board'),
 'jobs.analyticsvidhya.com': (D, [], 'https://jobs.analyticsvidhya.com/', 'job_board'),
 'job.careers': (D, [], 'https://job.careers', 'job_board'),
 'ai-jobs.careers': (D, [], 'https://ai-jobs.careers', 'job_board'),
 'aigigjobs.com': (D, [], 'https://aigigjobs.com/locations/india', 'gig_rlhf'),
 'opentrain.ai': (D, [], 'https://opentrain.ai/jobs', 'gig_rlhf'),
 'howtoaijobs.com': (D, [], 'https://howtoaijobs.com', 'job_board'),
 'aitrainingjobsfinder.com': (D, [], 'https://aitrainingjobsfinder.com', 'gig_rlhf'),
 'weworkremotely.com': (L, ['weworkremotely'], 'https://weworkremotely.com/remote-jobs/search?term={q}', 'job_board'),
 'dynamitejobs.com': (D, [], 'https://dynamitejobs.com/remote-jobs?search={q}', 'job_board'),
 'jobgether.com': (D, [], 'https://jobgether.com/search-offers?keyword={q}', 'job_board'),
 'remote.co': (D, [], 'https://remote.co/remote-jobs/search/?search_keywords={q}', 'job_board'),
 'careers.zedtreeo.com': (D, [], 'https://careers.zedtreeo.com', 'job_board'),
 'talent.micro1.ai': (D, [], 'https://talent.micro1.ai', 'gig_rlhf'),
 'app.usebraintrust.com': (T, ['ashby:braintrust'], 'https://app.usebraintrust.com/jobs/', 'talent_marketplace'),
 'alignerr.com': (D, [], 'https://alignerr.com/jobs', 'gig_rlhf'),
 'joinhandshake.ai': (T, ['ashby:handshake'], 'https://www.joinhandshake.ai', 'gig_rlhf'),
 'surgehq.ai': (D, [], 'https://surgehq.ai/careers', 'gig_rlhf'),
 'contra.com': (T, ['ashby:contra'], 'https://contra.com/jobs', 'freelance'),
 'a.team': (D, [], 'https://a.team', 'talent_marketplace'),
 'workgenius.com': (D, [], 'https://workgenius.com', 'talent_marketplace'),
 'gun.io': (D, [], 'https://gun.io', 'talent_marketplace'),
 'dataannotation.tech': (D, [], 'https://dataannotation.tech', 'gig_rlhf'),
 'appen.com': (T, ['lever:appen'], 'https://appen.com/join-our-crowd', 'gig_rlhf'),
 'telusinternational.com': (D, [], 'https://telusinternational.com/solutions/ai-data', 'gig_rlhf'),
 'mindrift.ai': (D, [], 'https://mindrift.ai', 'gig_rlhf'),
 'imerit.net': (D, [], 'https://imerit.net', 'gig_rlhf'),
 'wandb.ai': (A, G, 'https://wandb.ai/site/careers', 'company'),
 'anyscale.com': (T, ['ashby:anyscale'], 'https://www.anyscale.com/careers', 'company'),
 'modal.com': (T, ['ashby:modal'], 'https://modal.com/careers', 'company'),
 'replicate.com': (A, G, 'https://replicate.com/careers', 'company'),
 'together.ai': (T, ['greenhouse:togetherai'], 'https://www.together.ai/careers', 'company'),
 'groq.com': (A, G, 'https://groq.com/careers', 'company'),
 'baseten.co': (T, ['ashby:baseten'], 'https://baseten.co/careers', 'company'),
 'dstack.ai': (D, [], 'https://dstack.ai/careers', 'company'),
 'pinecone.io': (T, ['ashby:pinecone'], 'https://www.pinecone.io/careers', 'company'),
 'weaviate.io': (T, ['ashby:weaviate'], 'https://weaviate.io/company/careers', 'company'),
 'qdrant.tech': (A, G, 'https://qdrant.tech/careers', 'company'),
 'langchain.com': (T, ['ashby:langchain'], 'https://www.langchain.com/careers', 'company'),
 'llamaindex.ai': (T, ['ashby:llamaindex'], 'https://llamaindex.ai/careers', 'company'),
 'github.com': (R, [], 'https://github.com/search?q={q}&type=repositories', 'resource'),
 'arize.com': (T, ['greenhouse:arizeai'], 'https://arize.com/careers', 'company'),
 'whylabs.ai': (D, [], 'https://whylabs.ai/careers', 'company'),
 'e2enetworks.com': (D, [], 'https://e2enetworks.com/careers', 'company'),
 'cybotrix.com': (D, [], 'https://cybotrix.com', 'staffing'),
 'v3staffing.in': (D, [], 'https://v3staffing.in', 'staffing'),
 'sutrahr.com': (D, [], 'https://sutrahr.com', 'staffing'),
 'hyring.com': (D, [], 'https://hyring.com', 'staffing'),
 'randstad.in': (A, G, 'https://www.randstad.in/jobs/q-{qslug}/', 'staffing'),
 'teamleasedigital.com': (D, [], 'https://teamleasedigital.com', 'staffing'),
 'alp.consulting': (D, [], 'https://alp.consulting', 'staffing'),
 'xpheno.com': (D, [], 'https://xpheno.com', 'staffing'),
 'michaelpage.co.in': (A, G, 'https://www.michaelpage.co.in/jobs/technology', 'staffing'),
 'roberthalf.com': (D, [], 'https://www.roberthalf.com/in/en/jobs', 'staffing'),
 'f5hiringsolutions.com': (D, [], 'https://f5hiringsolutions.com', 'staffing'),
 'hn.hiring-search.com': (L, ['hn'], 'https://hn.hiring-search.com', 'community'),
 'teamblind.com': (R, [], 'https://www.teamblind.com', 'community'),
 'glassdoor.co.in': (A, G, 'https://www.glassdoor.co.in/Job/india-{qslug}-jobs-SRCH_IL.0,5_IN115_KO6,40.htm', 'job_board'),
 'deeplearning.ai': (R, [], 'https://www.deeplearning.ai/the-batch/', 'newsletter'),
 'latent.space': (R, [], 'https://latent.space', 'newsletter'),
 'producthunt.com': (R, [], 'https://www.producthunt.com/topics/artificial-intelligence', 'resource'),
 'dolby.com': (A, G, 'https://dolby.com/careers', 'company'),
 'uber.com': (A, G, 'https://www.uber.com/in/en/careers/list/?query={q}', 'company'),
 'jobs.gecareers.com': (A, G, 'https://jobs.gecareers.com/global/en/search-results?keywords={q}', 'company'),
 'equinix.com': (A, G, 'https://equinix.com/careers', 'company'),
 'samsara.com': (T, ['greenhouse:samsara'], 'https://samsara.com/company/careers', 'company'),
 'workato.com': (T, ['greenhouse:workato'], 'https://workato.com/careers', 'company'),
 'careers.zohocorp.com': (A, G, 'https://careers.zohocorp.com', 'company'),
 'careers.freshworks.com': (T, ['smartrecruiters:freshworks'], 'https://careers.freshworks.com', 'company'),
 'jobs.natwestgroup.com': (A, G, 'https://jobs.natwestgroup.com/search/jobs?keywords={q}', 'company'),
 'payoda.com': (D, [], 'https://payoda.com/careers', 'company'),
 'agentco.in': (D, [], 'https://agentco.in', 'resource'),
 'yourstory.com': (R, [], 'https://yourstory.com/funding', 'funding'),
 'coffeemug.ai': (R, [], 'https://coffeemug.ai', 'resource'),
 'pesto.tech': (D, [], 'https://pesto.tech', 'talent_marketplace'),
 'jobspresso.co': (L, ['jobspresso'], 'https://jobspresso.co/remote-work/?search_keywords={q}', 'job_board'),
 'workingnomads.com': (L, ['workingnomads'], 'https://www.workingnomads.com/remote-machine-learning-jobs', 'job_board'),
 'justremote.co': (D, [], 'https://justremote.co/remote-developer-jobs', 'job_board'),
 'lemon.io': (D, [], 'https://lemon.io/for-developers/', 'talent_marketplace'),
 'flexiple.com': (D, [], 'https://flexiple.com/talent', 'talent_marketplace'),
 'hackerearth.com': (D, [], 'https://www.hackerearth.com/challenges/hiring/', 'competition'),
 'devpost.com': (R, [], 'https://devpost.com/hackathons', 'competition'),
 'paperswithcode.com': (X, [], '', 'job_board'),
 'codementor.io': (D, [], 'https://www.codementor.io/jobs', 'freelance'),
 'oneforma.com': (D, [], 'https://oneforma.com/jobs/', 'gig_rlhf'),
 'clickworker.com': (D, [], 'https://clickworker.com', 'gig_rlhf'),
 'spaceappschallenge.org': (R, [], 'https://www.spaceappschallenge.org', 'competition'),
 'summerofcode.withgoogle.com': (R, [], 'https://summerofcode.withgoogle.com', 'oss_program'),
 'outreachy.org': (R, [], 'https://www.outreachy.org', 'oss_program'),
 'fellowship.mlh.com': (R, [], 'https://fellowship.mlh.com', 'oss_program'),
 'mentor.lfx.linuxfoundation.org': (R, [], 'https://mentorship.lfx.linuxfoundation.org', 'oss_program'),
 'google.github.io': (R, [], 'https://google.github.io/gsocguides/mentor', 'oss_program'),
 'about.gitlab.com': (T, ['greenhouse:gitlab'], 'https://about.gitlab.com/jobs/', 'company'),
 'automattic.com': (A, G, 'https://automattic.com/work-with-us/jobs/', 'company'),
 'crunchbase.com': (R, [], 'https://www.crunchbase.com', 'funding'),
 'inc42.com': (R, [], 'https://inc42.com/buzz/funding-galore/', 'funding'),
 'tracxn.com': (R, [], 'https://tracxn.com', 'funding'),
 'dealstreetasia.com': (R, [], 'https://dealstreetasia.com', 'funding'),
 'entrackr.com': (R, [], 'https://entrackr.com', 'funding'),
 'growthlist.co': (R, [], 'https://growthlist.co/india-startups', 'funding'),
 'developers.google.com': (R, [], 'https://developers.google.com/community/experts', 'devrel'),
 'builder.aws.com': (R, [], 'https://builder.aws.com', 'devrel'),
 'learn.microsoft.com': (R, [], 'https://learn.microsoft.com/en-us/credentials/', 'certification'),
 'nvidia.com': (T, ['workday:nvidia'], 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite?q={q}', 'company'),
 'gdg.community.dev': (R, [], 'https://gdg.community.dev', 'devrel'),
 'runpod.io': (T, ['ashby:runpod'], 'https://runpod.io/careers', 'company'),
 'coreweave.com': (T, ['greenhouse:coreweave'], 'https://www.coreweave.com/careers', 'company'),
 'lambdalabs.com': (T, ['ashby:lambda'], 'https://lambdalabs.com/careers', 'company'),
 'huggingface.co': (T, ['workable:huggingface'], 'https://apply.workable.com/huggingface/', 'company'),
 'cord.com': (D, [], 'https://cord.com/', 'job_board'),
 'efinancialcareers.com': (D, [], 'https://www.efinancialcareers.com/jobs/artificial-intelligence', 'job_board'),
 'geeksforgeeks.org': (D, [], 'https://www.geeksforgeeks.org/jobs', 'job_board'),
 'foundit.in': (A, G, 'https://www.foundit.in/srp/results?query={q}&locations=Bengaluru', 'job_board'),
 'unstop.com': (D, [], 'https://unstop.com/hiring-challenges', 'competition'),
 'freshersworld.com': (D, [], 'https://www.freshersworld.com/', 'job_board'),
 'hackerrank.com': (R, [], 'https://www.hackerrank.com/skills-verification', 'certification'),
 'codesignal.com': (R, [], 'https://codesignal.com/', 'certification'),
 'belong.co': (D, [], 'https://belong.co/', 'job_board'),
 'jaabz.com': (D, [], 'https://jaabz.com/jobs?search={q}', 'job_board'),
 'cwjobs.co.uk': (D, [], 'https://www.cwjobs.co.uk/jobs/{qslug}', 'job_board'),
 'relocate.me': (D, [], 'https://relocate.me/search?query={q}', 'relocation'),
 'vanhack.com': (D, [], 'https://vanhack.com/jobs/software-developer-jobs', 'relocation'),
 'landing.jobs': (D, [], 'https://landing.jobs/jobs?q={q}', 'relocation'),
 'thehub.io': (D, [], 'https://thehub.io/jobs?search={q}', 'relocation'),
 'germantechjobs.de': (D, [], 'https://germantechjobs.de/en/with-visa-sponsorship', 'relocation'),
 'swissdevjobs.ch': (D, [], 'https://swissdevjobs.ch/with-visa-sponsorship', 'relocation'),
 'honeypot.io': (X, [], '', 'job_board'),
 'datatalks.club': (R, [], 'https://datatalks.club/slack', 'community'),
 'locallyoptimistic.com': (R, [], 'https://locallyoptimistic.com/community/', 'community'),
 'reddit.com': (L, ['reddit'], 'https://www.reddit.com/r/MLjobs/new/', 'community'),
 'mlcollective.org': (R, [], 'https://mlcollective.org/community/', 'community'),
 'indiehackers.com': (R, [], 'https://www.indiehackers.com/', 'community'),
 'devfolio.co': (R, [], 'https://devfolio.co/hackathons', 'competition'),
 'saasboomi.org': (R, [], 'https://saasboomi.org/', 'community'),
 'kdnuggets.com': (D, [], 'https://www.kdnuggets.com/jobs', 'job_board'),
 'dataelixir.com': (D, [], 'https://dataelixir.com/', 'newsletter'),
 'hirement.com': (D, [], 'https://hirement.com/listing/data-elixirs-job-board/', 'job_board'),
 'jobs.opendatascience.com': (D, [], 'https://jobs.opendatascience.com/', 'job_board'),
 'careers.intuit.com': (A, G, 'https://jobs.intuit.com/search-jobs/{q}/India', 'company'),
 'atlassian.com': (A, G, 'https://www.atlassian.com/company/careers/all-jobs?search={q}', 'company'),
 'careers.servicenow.com': (T, ['smartrecruiters:servicenow'], 'https://careers.servicenow.com/jobs/?search={q}', 'company'),
 'salesforce.com': (T, ['workday:salesforce'], 'https://careers.salesforce.com/en/jobs/?search={q}&country=India', 'company'),
 'bloomberg.avature.net': (A, G, 'https://bloomberg.avature.net/careers/SearchJobs/{q}', 'company'),
 'razorpay.com': (A, G, 'https://razorpay.com/jobs/', 'company'),
 'phonepe.com': (A, G, 'https://www.phonepe.com/careers/job-openings/', 'company'),
 'groww.in': (T, ['greenhouse:groww'], 'https://groww.in/careers', 'company'),
 'zeptonow.com': (A, G, 'https://zeptonow.com/careers/', 'company'),
 'careers.myntra.com': (A, G, 'https://careers.myntra.com/', 'company'),
 'olaelectric.com': (A, G, 'https://olaelectric.com/careers/', 'company'),
 'browserstack.com': (A, G, 'https://browserstack.com/careers', 'company'),
 'darwinbox.com': (A, G, 'https://www.darwinbox.com/careers/', 'company'),
 'postman.com': (A, G, 'https://www.postman.com/company/careers/open-positions/', 'company'),
 'careers.zerodha.com': (D, [], 'https://careers.zerodha.com/', 'company'),
 'flipkartcareers.com': (A, G, 'https://www.flipkartcareers.com/#!/joblist', 'company'),
 'careers.atherenergy.com': (A, G, 'https://careers.atherenergy.com/jobs', 'company'),
 'research.samsung.com': (T, ['workday:samsung'], 'https://sec.wd3.myworkdayjobs.com/Samsung_Careers?q={q}', 'company'),
 't.me': (L, ['telegram'], 'https://t.me/s/AiIndiaJobs', 'community'),
 'discord.gg': (R, [], '', 'community'),
 'mlops.community': (R, [], 'https://mlops.community/jobs/', 'community'),
 'hasgeek.com': (R, [], 'https://hasgeek.com', 'community'),
 'meetup.com': (R, [], 'https://www.meetup.com/find/?keywords=mlops&location=in--Bangalore', 'community'),
 'aws.amazon.com': (R, [], 'https://aws.amazon.com/certification/', 'certification'),
 'cloud.google.com': (R, [], 'https://cloud.google.com/learn/certification', 'certification'),
 'databricks.com': (T, ['greenhouse:databricks'], 'https://databricks.com/certification', 'certification'),
 'developer.nvidia.com': (R, [], 'https://developer.nvidia.com/training', 'certification'),
 'bensbites.com': (R, [], 'https://bensbites.com', 'newsletter'),
 'tldr-dl.substack.com': (R, [], 'https://tldr.tech/ai', 'newsletter'),
 'jackwclark.com': (R, [], 'https://jack-clark.net', 'newsletter'),
 'superagi.substack.com': (R, [], 'https://superagi.substack.com', 'newsletter'),
 'therundown.ai': (R, [], 'https://therundown.ai', 'newsletter'),
 'google.com': (R, [], 'https://www.google.com/alerts', 'tool'),
}
M.update({
 'h2o.ai': (A, G + ['linkedin'], 'https://h2o.ai/company/careers/', 'company'),
 'employeereferrals.com': (R, [], 'https://employeereferrals.com', 'referral'),
 'x.com': (L, ['x_official', 'twitterapi_io'], 'https://x.com/search?q=%22{q}%22%20hiring&f=live', 'social'),
 'yellow.ai': (A, G + ['linkedin'], 'https://yellow.ai/careers/', 'company'),
 'gnani.ai': (A, G + ['linkedin'], 'https://gnani.ai/careers', 'company'),
 'qure.ai': (A, G + ['linkedin'], 'https://qure.ai/careers', 'company'),
 'skit.ai': (A, ['linkedin'], 'https://skit.ai/careers', 'company'),
 'howtoaijob.com': (D, [], 'https://howtoaijobs.com', 'job_board'),
 'micro1.ai': (D, [], 'https://talent.micro1.ai', 'gig_rlhf'),
 'gdg.com': (R, [], 'https://developers.google.com/community/gdsc-solution-challenge', 'competition'),
 'opendatascience.com': (D, [], 'https://jobs.opendatascience.com/', 'job_board'),
 'servicenow.com': (T, ['smartrecruiters:servicenow'], 'https://careers.servicenow.com/jobs/?search={q}', 'company'),
 'glassdoor.com': (A, G, 'https://www.glassdoor.co.in/Job/index.htm', 'job_board'),
})
# Citation/evidence domains in the Excel (not platforms) - intentionally not tracked
IGNORE = {'gov.in', 'company.com', 'wiki.dev', 'sprounix.com', 'standout-cv.com', 'wavecnct.com'}
TOOL_HOSTS = ['jobscan.co','rezi.ai','myjobb.ai','huntr.co','tealhq.com','careerflow.ai','huru.ai','hunter.io','apollo.io','rocketreach.co','lusha.com','dearhiringmanager.io','snov.io']
for h in TOOL_HOSTS: M[h] = (R, [], 'https://' + h, 'tool')

# Platforms named in Excel without a URL (frontier labs, GCCs, Indian AI startups, social)
NAMED = [
 ('Google DeepMind India', 'https://deepmind.google/about/careers/', A, G + ['linkedin'], 'Frontier_Labs_India', 'company'),
 ('OpenAI', 'https://openai.com/careers', T, ['ashby:openai'], 'Frontier_Labs_India', 'company'),
 ('Anthropic', 'https://www.anthropic.com/careers', T, ['greenhouse:anthropic'], 'Frontier_Labs_India', 'company'),
 ('Google India', 'https://www.google.com/about/careers/applications/jobs/results/?location=India&q=%22forward%20deployed%22', A, G + ['linkedin'], 'Frontier_Labs_India', 'company'),
 ('Microsoft IDC', 'https://jobs.careers.microsoft.com/global/en/search?lc=India&q=forward%20deployed', L, ['microsoft'], 'Frontier_Labs_India', 'company'),
 ('Amazon/AWS', 'https://www.amazon.jobs/en/search?base_query=forward+deployed&loc_query=India', L, ['amazon'], 'Frontier_Labs_India', 'company'),
 ('Walmart Global Tech', 'https://careers.walmart.com/results?q=machine%20learning&page=1&sort=rank&expand=department,type&jobCity=Bangalore', A, G, 'Frontier_Labs_India', 'company'),
 ('JPMorgan', 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/requisitions?keyword=machine%20learning&location=India', A, G, 'Frontier_Labs_India', 'company'),
 ('Goldman Sachs', 'https://higher.gs.com/results?search=machine%20learning&location=Bengaluru', A, G, 'Frontier_Labs_India', 'company'),
 ('Target India', 'https://india.target.com/careers', A, G, 'Frontier_Labs_India', 'company'),
 ('Adobe', 'https://careers.adobe.com/us/en/search-results?keywords=machine%20learning', T, ['workday:adobe'], 'Frontier_Labs_India', 'company'),
 ('SAP Labs', 'https://jobs.sap.com/search/?q=machine+learning&locationsearch=Bangalore', A, G, 'Frontier_Labs_India', 'company'),
 ('Best Buy', 'https://jobs.bestbuy.com/', A, G, 'Frontier_Labs_India', 'company'),
 ('Sarvam AI', 'https://jobs.ashbyhq.com/sarvam', T, ['ashby:sarvam'], 'Frontier_Labs_India', 'company'),
 ('Krutrim (Ola)', 'https://www.olakrutrim.com/careers', A, G + ['linkedin'], 'Frontier_Labs_India', 'company'),
 ('AI4Bharat', 'https://ai4bharat.iitm.ac.in/', A, ['linkedin'], 'Frontier_Labs_India', 'company'),
 ('Yellow.ai', 'https://yellow.ai/careers/', A, G + ['linkedin'], 'Frontier_Labs_India', 'company'),
 ('Gnani.ai', 'https://gnani.ai/careers', A, G + ['linkedin'], 'Frontier_Labs_India', 'company'),
 ('Qure.ai', 'https://qure.ai/careers', A, G + ['linkedin'], 'Frontier_Labs_India', 'company'),
 ('Glance AI', 'https://job-boards.greenhouse.io/glance', T, ['greenhouse:glance'], 'Frontier_Labs_India', 'company'),
 ('Skit.ai', 'https://skit.ai/careers', A, ['linkedin'], 'Frontier_Labs_India', 'company'),
 ('X / Twitter (job posts & founder hiring tweets)', 'https://x.com/search?q=%22forward%20deployed%22%20hiring&f=live', L, ['x_official', 'twitterapi_io'], 'Social_Media', 'social'),
 ('LinkedIn (posts / hiring managers)', 'https://www.linkedin.com/search/results/content/?keywords=%22forward%20deployed%22%20hiring&sortBy=%22date_posted%22', L, ['linkedin', 'jsearch', 'apify_linkedin'], 'Social_Media', 'social'),
 ('GitHub (profile + OSS)', 'https://github.com', R, [], 'Social_Media', 'resource'),
 ('Hacker News — Who is hiring', 'https://news.ycombinator.com/submitted?id=whoishiring', L, ['hn'], 'Hidden_Channels_Full', 'community'),
 ('Palantir (FDE origin company)', 'https://jobs.lever.co/palantir', T, ['lever:palantir'], 'FDE_Deep_Dive', 'company'),
 ('Snowflake', 'https://jobs.ashbyhq.com/snowflake', T, ['ashby:snowflake'], 'FDE_Deep_Dive', 'company'),
 ('IBM', 'https://www.ibm.com/careers/search?q=forward%20deployed', A, G + ['linkedin'], 'FDE_Deep_Dive', 'company'),
 ('Glean', 'https://job-boards.greenhouse.io/gleanwork', T, ['greenhouse:gleanwork'], 'FDE_Deep_Dive', 'company'),
]

def host_of(u):
    if not u.startswith('http'): u = 'https://' + u
    h = urlparse(u).netloc.lower()
    return h[4:] if h.startswith('www.') else h

def lookup(h):
    if h in M: return M[h]
    parts = h.split('.')
    for i in range(1, len(parts) - 1):
        k = '.'.join(parts[i:])
        if k in M: return M[k]
    return None

entries = {}
unmapped = []
for ws in wb:
    rows = list(ws.iter_rows(values_only=True))
    for r in rows[1:]:
        cells = [str(c).strip() if c is not None else '' for c in r]
        if not any(cells): continue
        urls = [m for c in cells for m in url_re.findall(c)]
        urls = [u for u in urls if not re.search(r'\.(md|pdf)$', u)]
        urls = sorted(urls, key=lambda u: 0 if u.startswith('http') else 1)  # real links before bare domain mentions
        if not urls: continue
        u = urls[0].rstrip('.')
        h = host_of(u)
        name = cells[1] if ws.title == 'MASTER_WEBSITES_INDEX' else cells[0]
        if not name or name.replace('.', '').isdigit() or name.startswith('http'): name = h
        GENERIC = ('Global ', 'India Board', 'RLHF', 'Talent Marketplace', 'AI Infra', 'Staffing', 'Direct Apply', 'Community', 'Strategy', 'Chennai', 'Remote India', 'Global Remote')
        if name.startswith(GENERIC) and len(cells) > 1 and cells[1] and not cells[1].startswith('http'):
            name = f"{cells[1][:70]} ({name})"
        key = (u if u.startswith('http') else 'https://' + u).lower().rstrip('/')
        e = entries.get(key)
        if not e:
            if h in IGNORE: continue
            m = lookup(h)
            if not m:
                unmapped.append((ws.title, name, u)); continue
            mapping, conns, tpl, kind = m
            note = ' | '.join(c for c in cells[1:] if c and not c.startswith('http') and c != name)[:280]
            e = entries[key] = {'name': name[:90], 'url': u if u.startswith('http') else 'https://' + u, 'host': h,
                                'mapping': mapping, 'connectors': conns, 'searchTemplate': tpl, 'kind': kind,
                                'sheets': [], 'notes': note}
        if ws.title not in e['sheets']: e['sheets'].append(ws.title)
        # prefer a human name over a category label
        if e['name'] == e['host'] or e['name'].startswith(('Global ', 'India Board', 'RLHF', 'Talent Marketplace', 'AI Infra', 'Staffing', 'Direct Apply', 'Community', 'Strategy', 'Chennai')):
            if name and name != h and not name.startswith(('Global ', 'India Board', 'RLHF', 'Talent Marketplace', 'AI Infra', 'Staffing', 'Direct Apply', 'Community', 'Strategy', 'Chennai')):
                e['name'] = name[:90]
for n, u, mapping, conns, sheet, kind in NAMED:
    entries[u.lower()] = {'name': n, 'url': u, 'host': host_of(u), 'mapping': mapping, 'connectors': conns,
                          'searchTemplate': u, 'kind': kind, 'sheets': [sheet], 'notes': ''}
# de-duplicate: same host + same base name (e.g. a named entry and its URL row)
merged = {}
for e in entries.values():
    k = (e['host'], re.sub(r'\s*\(.*\)$', '', e['name']).strip().lower())
    if k in merged:
        m = merged[k]
        m['sheets'] = sorted(set(m['sheets']) | set(e['sheets']))
        m['notes'] = m['notes'] or e['notes']
        m['connectors'] = m['connectors'] or e['connectors']
    else:
        merged[k] = e
entries = {str(i): e for i, e in enumerate(merged.values())}
out = []
for i, e in enumerate(sorted(entries.values(), key=lambda e: (['live_api','live_ats','aggregated','deep_link','resource','excluded'].index(e['mapping']), e['kind'], e['name'].lower()))):
    e['id'] = 'p' + str(i + 1).zfill(3)
    out.append(e)
json.dump(out, open(OUT, 'w'), indent=1, ensure_ascii=False)
from collections import Counter
print('platforms mapped:', len(out), Counter(e['mapping'] for e in out))
print('UNMAPPED:', len(unmapped))
for x in unmapped: print('  ', x)
