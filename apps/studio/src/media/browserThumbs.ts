/** Extract an evenly spaced filmstrip from a video file, browser-side. */
export function extractBrowserThumbnails(file: File, count: number, width: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.src = url;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const thumbs: string[] = [];
    let current = 0;
    const step = () => {
      if (current >= count) {
        URL.revokeObjectURL(url);
        resolve(thumbs);
        return;
      }
      const t = Math.min(video.duration - 0.05, (current / Math.max(1, count - 1)) * video.duration);
      video.currentTime = Math.max(0, t);
    };
    video.onseeked = () => {
      if (!video.videoWidth) {
        current += 1;
        step();
        return;
      }
      const scale = width / video.videoWidth;
      canvas.width = width;
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
      thumbs.push(canvas.toDataURL('image/jpeg', 0.7));
      current += 1;
      step();
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Thumbnail extraction failed for ' + file.name));
    };
    video.onloadedmetadata = step;
  });
}