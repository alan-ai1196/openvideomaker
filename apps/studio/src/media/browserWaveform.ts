/** Decode audio and bucket it into normalized peaks, browser-side. */
export function extractBrowserWaveform(file: File, peaksPerSecond: number): Promise<{ peaks: number[]; peaksPerSecond: number; durationUs: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read ' + file.name));
    reader.onload = () => {
      const buffer = reader.result as ArrayBuffer;
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) {
        reject(new Error('WebAudio is not available in this browser'));
        return;
      }
      const ctx = new AudioCtx();
      ctx.decodeAudioData(buffer).then(
        (decoded) => {
          const channel = decoded.getChannelData(0);
          const durationUs = Math.round(decoded.duration * 1_000_000);
          const totalPeaks = Math.max(1, Math.round(decoded.duration * peaksPerSecond));
          const samplesPerPeak = Math.max(1, Math.floor(channel.length / totalPeaks));
          const peaks: number[] = [];
          for (let i = 0; i < totalPeaks; i += 1) {
            const start = i * samplesPerPeak;
            const end = Math.min(start + samplesPerPeak, channel.length);
            let max = 0;
            for (let j = start; j < end; j += 1) {
              const v = Math.abs(channel[j]!);
              if (v > max) max = v;
            }
            peaks.push(max);
          }
          void ctx.close();
          resolve({ peaks, peaksPerSecond, durationUs });
        },
        (err) => {
          void ctx.close();
          reject(new Error('Could not decode audio: ' + String(err)));
        },
      );
    };
    reader.readAsArrayBuffer(file);
  });
}