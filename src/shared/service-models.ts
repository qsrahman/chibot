// The settings holding the models of features beyond chat. Zod-free, so the
// web app can import it as a value (see settings.ts).
export const SERVICE_MODELS = [
  'imageModel',
  'embeddingModel',
  'transcribeModel',
] as const
export type ServiceModel = (typeof SERVICE_MODELS)[number]
