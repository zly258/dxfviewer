import { useState, useCallback } from 'react';
import { Language, t } from '@/config/i18n';
import LoaderWorker from './dxfLoader.worker?worker&inline';

export interface DxfLoadResult {
  data: any;
  sourceFormat: string;
}

export const useDxfLoader = (lang: Language, onError?: (err: Error) => void) => {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingFileName, setLoadingFileName] = useState('');

  const processBuffer = useCallback(async (buffer: ArrayBuffer): Promise<DxfLoadResult> => {
    return new Promise((resolve, reject) => {
      const worker = new LoaderWorker();
      worker.onmessage = (e) => {
        const { type, progress, data, sourceFormat, error } = e.data;
        if (type === 'progress') {
          setLoadingProgress(progress);
        } else if (type === 'success') {
          resolve({ data, sourceFormat });
          worker.terminate();
        } else if (type === 'error') {
          const formattedError = new Error(t(lang, 'parseFailed', { message: error }));
          onError?.(formattedError);
          reject(formattedError);
          worker.terminate();
        }
      };
      worker.onerror = (err) => {
        const formattedError = new Error(t(lang, 'parseFailed', { message: err.message }));
        onError?.(formattedError);
        reject(formattedError);
        worker.terminate();
      };
      worker.postMessage({ buffer }, [buffer]);
    });
  }, [lang, onError]);

  const loadFromUrl = useCallback(async (url: string, fileName?: string): Promise<DxfLoadResult> => {
    setIsLoading(true);
    setLoadingProgress(0);
    setLoadingFileName(fileName || url.split(/[\\/]/).pop() || url);
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
        const buffer = await response.arrayBuffer();
        const result = await processBuffer(buffer);
        setIsLoading(false);
        return result;
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.(error);
        setIsLoading(false);
        throw new Error(t(lang, 'loadFailed', { message: error.message }));
    }
  }, [lang, onError, processBuffer]);

  const loadFromFile = useCallback((file: File): Promise<DxfLoadResult> => {
    setIsLoading(true);
    setLoadingProgress(0);
    setLoadingFileName(file.name);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const buffer = evt.target?.result as ArrayBuffer;
          const result = await processBuffer(buffer);
          setIsLoading(false);
          resolve(result);
        } catch (err) {
          setIsLoading(false);
          reject(err);
        }
      };
      reader.onerror = () => {
          const error = new Error(t(lang, 'fileReadError'));
          onError?.(error);
          setIsLoading(false);
          reject(new Error(t(lang, 'loadFailed', { message: error.message })));
      };
      reader.readAsArrayBuffer(file);
    });
  }, [lang, onError, processBuffer]);

  return {
    isLoading,
    loadingProgress,
    loadingFileName,
    loadFromUrl,
    loadFromFile,
    processBuffer
  };
};
