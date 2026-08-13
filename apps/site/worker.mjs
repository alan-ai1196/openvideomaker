/** Static-assets Worker: serves the Astro build with directory indexes and a 404 fallback. */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    let response = await env.ASSETS.fetch(new URL(pathname.replace(/^\//, ''), url));
    if (response.status === 404 && !pathname.includes('.')) {
      response = await env.ASSETS.fetch(new URL('404.html', url));
    }
    return response;
  },
};
