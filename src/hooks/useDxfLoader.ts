import { useState, useCallback, useEffect, useRef } from 'react';
import { Language, t } from '@/config/i18n';
import { DxfLoadResult } from '@/types';
import type { ParseWorkerResponse } from './dxfLoader.worker';

interface ActiveLoadJob {
  id: number;
  cancelled: boolean;
  controller?: AbortController;
  reader?: FileReader;
  worker?: Worker;
  rejectWorker?: (error: Error) => void;
}

class ParsedDxfError extends Error {}

const createAbortError = (): Error => {
  const error = new Error('DXF loading was cancelled');
  error.name = 'AbortError';
  return error;
};

export const isAbortError = (error: unknown): boolean => error instanceof Error && error.name === 'AbortError';

export const useDxfLoader = (lang: Language, onError?: (err: Error) => void) => {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingFileName, setLoadingFileName] = useState('');
  const activeJobRef = useRef<ActiveLoadJob | null>(null);
  const requestIdRef = useRef(0);
  const langRef = useRef(lang);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    langRef.current = lang;
    onErrorRef.current = onError;
  }, [lang, onError]);

  const cancel = useCallback(() => {
    const job = activeJobRef.current;
    if (!job) return;
    job.cancelled = true;
    job.controller?.abort();
    if (job.reader?.readyState === FileReader.LOADING) job.reader.abort();
    job.worker?.terminate();
    job.rejectWorker?.(createAbortError());
    job.rejectWorker = undefined;
    activeJobRef.current = null;
    setIsLoading(false);
  }, []);

  useEffect(() => cancel, [cancel]);

  const beginJob = useCallback((fileName: string): ActiveLoadJob => {
    cancel();
    const job: ActiveLoadJob = {
      id: ++requestIdRef.current,
      cancelled: false,
    };
    activeJobRef.current = job;
    setIsLoading(true);
    setLoadingProgress(0);
    setLoadingFileName(fileName);
    return job;
  }, [cancel]);

  const isCurrentJob = useCallback((job: ActiveLoadJob): boolean => {
    return activeJobRef.current === job && !job.cancelled;
  }, []);

  const parseBuffer = useCallback(async (buffer: ArrayBuffer, job: ActiveLoadJob): Promise<DxfLoadResult> => {
    const { createDxfLoaderWorker } = await import('./workerFactory');
    if (!isCurrentJob(job)) throw createAbortError();

    return new Promise((resolve, reject) => {
      if (!isCurrentJob(job)) {
        reject(createAbortError());
        return;
      }

      const worker = createDxfLoaderWorker();
      job.worker = worker;
      job.rejectWorker = reject;

      const finish = () => {
        worker.terminate();
        job.worker = undefined;
        job.rejectWorker = undefined;
      };

      worker.onmessage = (event: MessageEvent<ParseWorkerResponse>) => {
        const message = event.data;
        if (message.requestId !== job.id || !isCurrentJob(job)) return;
        if (message.type === 'progress') {
          setLoadingProgress(message.progress);
          return;
        }
        finish();
        if (message.type === 'success') {
          resolve({ data: message.data, sourceFormat: message.sourceFormat });
        } else {
          reject(new ParsedDxfError(t(langRef.current, 'parseFailed', { message: message.error })));
        }
      };

      worker.onerror = (event) => {
        if (!isCurrentJob(job)) return;
        finish();
        reject(new ParsedDxfError(t(langRef.current, 'parseFailed', { message: event.message })));
      };

      try {
        worker.postMessage({ type: 'parse', requestId: job.id, buffer }, [buffer]);
      } catch (error: unknown) {
        finish();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }, [isCurrentJob]);

  const finishJob = useCallback((job: ActiveLoadJob) => {
    if (!isCurrentJob(job)) return;
    activeJobRef.current = null;
    setIsLoading(false);
  }, [isCurrentJob]);

  const failJob = useCallback((job: ActiveLoadJob, error: unknown): never => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (isCurrentJob(job)) {
      activeJobRef.current = null;
      setIsLoading(false);
      if (!isAbortError(normalized)) onErrorRef.current?.(normalized);
    }
    throw normalized;
  }, [isCurrentJob]);

  const loadFromUrl = useCallback(async (url: string, fileName?: string): Promise<DxfLoadResult> => {
    const job = beginJob(fileName || url.split(/[\\/]/).pop() || url);
    const controller = new AbortController();
    job.controller = controller;
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
      const result = await parseBuffer(await response.arrayBuffer(), job);
      finishJob(job);
      return result;
    } catch (error: unknown) {
      if (isAbortError(error) || job.cancelled) return failJob(job, createAbortError());
      const message = error instanceof Error ? error.message : String(error);
      const normalized = error instanceof ParsedDxfError
        ? error
        : new Error(t(langRef.current, 'loadFailed', { message }));
      return failJob(job, normalized);
    }
  }, [beginJob, failJob, finishJob, parseBuffer]);

  const readFile = useCallback((file: File, job: ActiveLoadJob): Promise<ArrayBuffer> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      job.reader = reader;
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(new Error(t(langRef.current, 'fileReadError')));
      reader.onabort = () => reject(createAbortError());
      reader.readAsArrayBuffer(file);
    });
  }, []);

  const loadFromFile = useCallback(async (file: File): Promise<DxfLoadResult> => {
    const job = beginJob(file.name);
    try {
      const buffer = await readFile(file, job);
      const result = await parseBuffer(buffer, job);
      finishJob(job);
      return result;
    } catch (error: unknown) {
      if (isAbortError(error) || job.cancelled) return failJob(job, createAbortError());
      const message = error instanceof Error ? error.message : String(error);
      const normalized = error instanceof ParsedDxfError
        ? error
        : new Error(t(langRef.current, 'loadFailed', { message }));
      return failJob(job, normalized);
    }
  }, [beginJob, failJob, finishJob, parseBuffer, readFile]);

  const processBuffer = useCallback(async (buffer: ArrayBuffer): Promise<DxfLoadResult> => {
    const job = beginJob('');
    try {
      const result = await parseBuffer(buffer, job);
      finishJob(job);
      return result;
    } catch (error: unknown) {
      return failJob(job, error);
    }
  }, [beginJob, failJob, finishJob, parseBuffer]);

  return {
    isLoading,
    loadingProgress,
    loadingFileName,
    loadFromUrl,
    loadFromFile,
    processBuffer,
    cancel,
  };
};
