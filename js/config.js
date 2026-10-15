// Deployment settings for the exhibit.
//
// share: where visitors may send a recorded training session, after a second, explicit consent on the result
// screen. Leave url empty to keep everything local (sessions can still be downloaded). Point it at the
// TEM-view session collector Space (hf/space) once it is deployed and the study has ethics approval, e.g.
//   url: 'https://northwestern-tem-view-collector.hf.space/submit', dataset: 'rmsreis/tem-view-alignment'
export const SHARE = {
  url: 'https://northwestern-tem-view-collector.hf.space/submit',
  dataset: 'rmsreis/tem-view-alignment',
};
