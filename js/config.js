// Deployment settings for the exhibit.
//
// share: where visitors may send a recorded training session (they choose "Record and share" on the consent
// screen, or send it from the result screen). Leave url empty to keep everything local (sessions can still be
// downloaded). Point it at the session collector once it is deployed (hf/worker, free; or hf/space on a paid
// Hugging Face plan), e.g.
//   url: 'https://tem-view-collector.<subdomain>.workers.dev/submit', dataset: 'rmsreis/tem-view-alignment'
// agent: the local temview-mcp server (tools/temview-mcp) an AI agent runs; the exhibit connects only when the
// visitor clicks "Connect agent".
export const AGENT = { url: 'ws://127.0.0.1:8790' };

export const SHARE = {
  url: 'https://tem-view-collector.tem-view.workers.dev/submit',
  dataset: 'rmsreis/tem-view-alignment',
};
