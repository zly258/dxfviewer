/** 构造标准的 AbortError（加载/解析取消共用）。 */
export const createAbortError = (message = 'Operation was cancelled'): Error => {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
};

/** 判断错误是否为取消（AbortError）。 */
export const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';
