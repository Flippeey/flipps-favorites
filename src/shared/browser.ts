export const extensionApi = globalThis.browser ?? globalThis.chrome;

if (!extensionApi?.runtime) {
  throw new Error('WebExtension runtime API is not available in this context.');
}

export function sendRuntimeMessage<TRequest, TResponse>(message: TRequest): Promise<TResponse> {
  return extensionApi.runtime.sendMessage(message) as Promise<TResponse>;
}
