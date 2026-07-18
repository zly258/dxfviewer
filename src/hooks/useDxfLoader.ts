import { useState, useCallback } from 'react';
import { parseDxf } from '@/core/parser/dxfParser';
import { decodeDxfBuffer } from '@/core/parser/utils/textDecoder';
import { Language, t } from '@/config/i18n';

export interface DxfLoadResult {
  data: any;
  sourceFormat: string;
}

export const useDxfLoader = (lang: Language, onError?: (err: Error) => void) => {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingFileName, setLoadingFileName] = useState('');

  const processBuffer = useCallback(async (buffer: ArrayBuffer): Promise<DxfLoadResult> => {
    let decoded;
    try {
        decoded = decodeDxfBuffer(buffer);
    } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        onError?.(error);
        throw new Error(t(lang, 'decodeFailed', { message: error.message }));
    }

    try {
      const data = await parseDxf(decoded.text, (progress) => {
          setLoadingProgress(progress);
      });
      return { data, sourceFormat: decoded.format };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      onError?.(error);
      throw new Error(t(lang, 'parseFailed', { message: error.message }));
    }
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
