# ADR-0006: Media pipeline - platform-native probing with one shared schema

## Context

OpenVideoMaker runs in two environments with different media
capabilities: the browser Studio (metadata via HTMLMediaElement/WebAudio,
no arbitrary file access) and the desktop/server core (ffprobe/ffmpeg with
full filesystem access). The project model must be identical in both, and
final rendering always happens outside the browser.

## Decision

- `@openvideomaker/media` owns the Node/desktop side: ffprobe-based
  probing (exact rational frame rates, codecs, channels), ffmpeg filmstrip
  thumbnails, and ffmpeg-decoded waveform peaks. All subprocess calls use
  argument arrays, bounded output capture, and typed MediaErrors.
- The Studio owns browser-native equivalents (video/audio/image element
  probing, canvas thumbnails, WebAudio decode) behind the same MediaInfo
  schema, plus a session-scoped MediaCache for object URLs, thumbnails and
  peaks - presentation data that is deliberately NOT durable project state.
- Insert edits are first-class core commands (insertClipAt = split + ripple
  shift + insert in one atomic transaction), composed purely from the
  operation vocabulary.

## Consequences

- Desktop and browser produce schema-identical MediaInfo; projects created
  in either mode stay interchangeable.
- Thumbnails/waveforms never pollute the durable IR or the operation log;
  they are regenerable caches.
- The same commands (insert edit, ripple delete, split) serve the UI now
  and MCP/agents later, unchanged.

## Alternatives considered

- WASM ffmpeg in the browser for parity: rejected - heavy (25MB+) and
  unnecessary when the browser has native decode; desktop owns heavy
  lifting.
- Storing thumbnails in the project: rejected - durability and portability
  of the IR matter more than cache convenience.
