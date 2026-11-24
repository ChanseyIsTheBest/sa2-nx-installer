// rr6-nx-installer (2026-11-21, the user: "rencoding ... videos as h.265 copy what culdcept saga does"): FFmpeg's MPEG-1
// video decoder in WebAssembly (wasm/mpeg1.mjs, built by wasm/src/mpeg1/build.sh from the FFmpeg 4.4 of rr6-nx's
// sdk/thirdparty/FFmpeg, configured with that decoder only), for the Sofdec movies' H.265 re-encode (lib/sfdh.js). As
// culdcept-nx-installer's wasm/src/wmv3 (credit culdcept-nx). The movie's pictures go in as the video stream holds them
// (coded order, each with the sequence / GOP headers and user data before it); they come out in display order.
//
//   mpeg1_open(width, height) -> 0 / < 0
//   mpeg1_decode(data, size) -> 1 a picture / 0 none / < 0    one coded picture (size 0: the end, the last held picture)
//   mpeg1_picture() -> pointer to width * height * 3 / 2 bytes   the last picture, I420 (Y, then U, then V, no padding)
//   mpeg1_close(); mpeg1_malloc(n); mpeg1_free(p); mpeg1_version()
#include <emscripten/emscripten.h>
#include <stdlib.h>
#include <string.h>

#include <libavcodec/avcodec.h>
#include <libavutil/frame.h>
#include <libavutil/mem.h>

extern AVCodec ff_mpeg1video_decoder;

static AVCodecContext *ctx;
static AVPacket *pkt;
static AVFrame *frame;
static uint8_t *i420;
static int width, height;

EMSCRIPTEN_KEEPALIVE void mpeg1_close(void) {
  if (ctx) avcodec_free_context(&ctx);
  if (pkt) av_packet_free(&pkt);
  if (frame) av_frame_free(&frame);
  free(i420);
  i420 = NULL;
}

EMSCRIPTEN_KEEPALIVE int mpeg1_open(int w, int h) {
  mpeg1_close();
  ctx = avcodec_alloc_context3(&ff_mpeg1video_decoder);
  if (!ctx) return -1;
  ctx->width = ctx->coded_width = width = w;
  ctx->height = ctx->coded_height = height = h;
  ctx->thread_count = 1;
  if (avcodec_open2(ctx, &ff_mpeg1video_decoder, NULL) < 0) return -3;
  pkt = av_packet_alloc();
  frame = av_frame_alloc();
  i420 = malloc((size_t)w * h * 3 / 2);
  return pkt && frame && i420 ? 0 : -4;
}

static int take(void) {
  const int err = avcodec_receive_frame(ctx, frame);
  if (err == AVERROR(EAGAIN) || err == AVERROR_EOF) return 0;
  if (err < 0 || frame->format != AV_PIX_FMT_YUV420P) return -4;
  uint8_t *out = i420;
  for (int k = 0; k < 3; ++k) {
    const int pw = k ? width / 2 : width, ph = k ? height / 2 : height;
    for (int y = 0; y < ph; ++y, out += pw) memcpy(out, frame->data[k] + (size_t)y * frame->linesize[k], pw);
  }
  return 1;
}

// One picture in; a picture out when the decoder has one. After the last picture, calls with size 0 give the held ones
// (each call one) until 0.
EMSCRIPTEN_KEEPALIVE int mpeg1_decode(const uint8_t *data, int size) {
  if (!ctx) return -1;
  static int draining = 0;
  if (size > 0) {
    draining = 0;
    av_packet_unref(pkt);
    if (av_new_packet(pkt, size) < 0) return -2;
    memcpy(pkt->data, data, size);
    if (avcodec_send_packet(ctx, pkt) < 0) return -3;
  } else if (!draining) {
    draining = 1;
    avcodec_send_packet(ctx, NULL);
  }
  return take();
}

EMSCRIPTEN_KEEPALIVE uint8_t *mpeg1_picture(void) { return i420; }
EMSCRIPTEN_KEEPALIVE void *mpeg1_malloc(int n) { return malloc(n); }
EMSCRIPTEN_KEEPALIVE void mpeg1_free(void *p) { free(p); }
EMSCRIPTEN_KEEPALIVE int mpeg1_version(void) { return LIBAVCODEC_VERSION_INT; }
