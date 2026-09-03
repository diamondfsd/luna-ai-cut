#pragma once

#include <d3d11.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct LunaFfmpegD3D11Decoder LunaFfmpegD3D11Decoder;

typedef struct LunaFfmpegD3D11Frame {
    ID3D11Texture2D *texture;
    uint32_t array_slice;
    uint32_t width;
    uint32_t height;
    int32_t dxgi_format;
    int64_t timestamp_100ns;
} LunaFfmpegD3D11Frame;

LunaFfmpegD3D11Decoder *luna_ffmpeg_d3d11_open(
    const char *path_utf8,
    ID3D11Device *device,
    char *error_buffer,
    uint32_t error_buffer_size);

int32_t luna_ffmpeg_d3d11_read_at(
    LunaFfmpegD3D11Decoder *decoder,
    double seconds,
    LunaFfmpegD3D11Frame *frame,
    char *error_buffer,
    uint32_t error_buffer_size);

int32_t luna_ffmpeg_d3d11_convert_current(
    LunaFfmpegD3D11Decoder *decoder,
    ID3D11Texture2D *output_texture,
    char *error_buffer,
    uint32_t error_buffer_size);

void luna_ffmpeg_d3d11_close(LunaFfmpegD3D11Decoder *decoder);

#ifdef __cplusplus
}
#endif
