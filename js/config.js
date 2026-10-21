// Deployment settings for the exhibit.
//
// share: where visitors may send a recorded training session (they choose "Record and share" on the consent
// screen, or send it from the result screen). Leave url empty to keep everything local (sessions can still be
// downloaded). Point it at the session collector once it is deployed (hf/worker, free; or hf/space on a paid
// Hugging Face plan), e.g.
//   url: 'https://tem-view-collector.<subdomain>.workers.dev/submit', dataset: 'rmsreis/tem-view-alignment'
// support: the "Buy me a coffee" and "Subscribe for news" buttons at the top left. coffee is a full
// https://buymeacoffee.com/<name> address (the button stays hidden while it is empty); newsletter is an optional
// email-signup page (Buttondown, Substack, …). GitHub release notifications are always offered.
// edition: 'full' (the website) or 'lite' (the phone apps: TEM, STEM and the Ronchigram, with voice and the
// training tasks). The app build sets window.TEMVIEW_EDITION; ?edition=lite previews the lite edition on the web.
const ED = typeof window !== 'undefined' ? (window.TEMVIEW_EDITION || new URLSearchParams(window.location?.search ?? '').get('edition')) : null;
export const EDITION = ED === 'lite' ? 'lite' : 'full';
export const LITE_MODES = ['tem', 'stem', 'ronch'];
// where the full version lives (the app links there for everything it leaves out)
export const SITE = 'https://advanced-em.github.io/TEM-view/';

export const SUPPORT = {
  coffee: 'https://buymeacoffee.com/rmsreis',
  newsletter: '',
  // the news form posts {email} here (the collector Worker's /subscribe, hf/worker); empty hides the form
  subscribe: 'https://tem-view-collector.tem-view.workers.dev/subscribe',
  repo: 'https://github.com/Advanced-EM/TEM-view',
};

// agent: the local temview-mcp server (tools/temview-mcp) an AI agent runs; the exhibit connects only when the
// visitor clicks "Connect agent".
// It tries each address in turn: 8790 is temview-mcp's default, 8791 a common choice when 8790 is taken.
export const AGENT = { urls: ['ws://127.0.0.1:8790', 'ws://127.0.0.1:8791'] };

export const SHARE = {
  url: 'https://tem-view-collector.tem-view.workers.dev/submit',
  dataset: 'rmsreis/tem-view-alignment',
};
