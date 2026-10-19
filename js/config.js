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
export const SUPPORT = {
  coffee: 'https://buymeacoffee.com/rmsreis',
  newsletter: '',
  repo: 'https://github.com/Advanced-EM/TEM-view',
};

// agent: the local temview-mcp server (tools/temview-mcp) an AI agent runs; the exhibit connects only when the
// visitor clicks "Connect agent".
export const AGENT = { url: 'ws://127.0.0.1:8791' };

export const SHARE = {
  url: 'https://tem-view-collector.tem-view.workers.dev/submit',
  dataset: 'rmsreis/tem-view-alignment',
};
