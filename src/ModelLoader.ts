import { loadTensorflowModel } from 'react-native-fast-tflite';

let globalModel: any = null;
let loadingPromise: Promise<any> | null = null;

export function getOrLoadModel(): Promise<any> {
  if (globalModel) return Promise.resolve(globalModel);
  if (loadingPromise) return loadingPromise;

  console.log('[ModelLoader] Loading global MobileFaceNet model...');
  loadingPromise = loadTensorflowModel(
    require('../assets/mobilefacenet.tflite'),
    []
  )
    .then((model) => {
      globalModel = model;
      console.log('[ModelLoader] MobileFaceNet model loaded successfully!');
      return model;
    })
    .catch((err) => {
      console.error('[ModelLoader] Failed to load model:', err);
      loadingPromise = null;
      throw err;
    });

  return loadingPromise;
}

export function getLoadedModel(): any {
  return globalModel;
}
