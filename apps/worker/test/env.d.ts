declare module 'cloudflare:test' {
  interface ProvidedEnv {
    MATCH_COORDINATOR: DurableObjectNamespace;
    CHAT_ROOM: DurableObjectNamespace;
  }
}
