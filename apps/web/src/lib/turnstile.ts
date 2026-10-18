import { env } from './env';

/** Lazily load Cloudflare Turnstile and obtain a token from an invisible widget. */
let loader: Promise<void> | null = null;
function load(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!loader) {
    loader = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Turnstile failed to load'));
      document.head.appendChild(s);
    });
  }
  return loader;
}

export async function getTurnstileToken(action = 'orbit'): Promise<string> {
  if (!env.turnstileEnabled || !env.turnstileSiteKey) throw new Error('Turnstile disabled');
  await load();
  return new Promise((resolve, reject) => {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.bottom = '12px';
    host.style.right = '12px';
    host.style.zIndex = '70';
    document.body.appendChild(host);
    const cleanup = (id?: string) => {
      if (id) window.turnstile?.remove(id);
      host.remove();
    };
    const id = window.turnstile!.render(host, {
      sitekey: env.turnstileSiteKey,
      action,
      appearance: 'interaction-only',
      callback: (token: string) => {
        resolve(token);
        setTimeout(() => cleanup(id), 0);
      },
      'error-callback': () => {
        reject(new Error('Verification failed'));
        cleanup(id);
      },
      'timeout-callback': () => {
        reject(new Error('Verification timed out'));
        cleanup(id);
      },
    });
  });
}
