#include "ffmpeg_d3d11_bridge.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/error.h>
#include <libavutil/hwcontext.h>
#include <libavutil/hwcontext_d3d11va.h>
}

struct LunaFfmpegD3D11Decoder {
    AVFormatContext *format = nullptr;
    AVCodecContext *codec = nullptr;
    AVBufferRef *hardware_device = nullptr;
    AVPacket *packet = nullptr;
    AVFrame *frame = nullptr;
    int stream_index = -1;
    AVRational time_base = {0, 1};
    int64_t last_target = AV_NOPTS_VALUE;
    bool draining = false;
};

namespace {

void set_error(char *buffer, uint32_t size, const char *message) {
    if (!buffer || size == 0) {
        return;
    }
    std::snprintf(buffer, size, "%s", message ? message : "unknown FFmpeg error");
}

void set_av_error(char *buffer, uint32_t size, const char *stage, int code) {
    char detail[AV_ERROR_MAX_STRING_SIZE] = {};
    av_strerror(code, detail, sizeof(detail));
    if (!buffer || size == 0) {
        return;
    }
    std::snprintf(buffer, size, "%s: %s (%d)", stage, detail, code);
}

void set_hresult_error(char *buffer, uint32_t size, const char *stage, HRESULT code) {
    if (!buffer || size == 0) {
        return;
    }
    std::snprintf(buffer, size, "%s: HRESULT 0x%08lx", stage, static_cast<unsigned long>(code));
}

AVPixelFormat select_d3d11_format(AVCodecContext *, const AVPixelFormat *formats) {
    for (const AVPixelFormat *format = formats; *format != AV_PIX_FMT_NONE; ++format) {
        if (*format == AV_PIX_FMT_D3D11) {
            return *format;
        }
    }
    return AV_PIX_FMT_NONE;
}

void destroy_decoder(LunaFfmpegD3D11Decoder *decoder) {
    if (!decoder) {
        return;
    }
    av_frame_free(&decoder->frame);
    av_packet_free(&decoder->packet);
    avcodec_free_context(&decoder->codec);
    av_buffer_unref(&decoder->hardware_device);
    avformat_close_input(&decoder->format);
    delete decoder;
}

bool seek_decoder(
    LunaFfmpegD3D11Decoder *decoder,
    int64_t target,
    char *error_buffer,
    uint32_t error_buffer_size) {
    int result = av_seek_frame(
        decoder->format,
        decoder->stream_index,
        target,
        AVSEEK_FLAG_BACKWARD);
    if (result < 0) {
        set_av_error(error_buffer, error_buffer_size, "FFmpeg seek failed", result);
        return false;
    }
    avcodec_flush_buffers(decoder->codec);
    decoder->draining = false;
    decoder->last_target = AV_NOPTS_VALUE;
    return true;
}

int receive_frame(
    LunaFfmpegD3D11Decoder *decoder,
    char *error_buffer,
    uint32_t error_buffer_size) {
    for (;;) {
        av_frame_unref(decoder->frame);
        int result = avcodec_receive_frame(decoder->codec, decoder->frame);
        if (result == 0) {
            return 1;
        }
        if (result == AVERROR_EOF) {
            return 0;
        }
        if (result != AVERROR(EAGAIN)) {
            set_av_error(error_buffer, error_buffer_size, "FFmpeg hardware decode failed", result);
            return -1;
        }

        if (decoder->draining) {
            return 0;
        }

        for (;;) {
            result = av_read_frame(decoder->format, decoder->packet);
            if (result == AVERROR_EOF) {
                decoder->draining = true;
                result = avcodec_send_packet(decoder->codec, nullptr);
                if (result < 0 && result != AVERROR_EOF) {
                    set_av_error(error_buffer, error_buffer_size, "FFmpeg decoder drain failed", result);
                    return -1;
                }
                break;
            }
            if (result < 0) {
                set_av_error(error_buffer, error_buffer_size, "FFmpeg packet read failed", result);
                return -1;
            }
            if (decoder->packet->stream_index != decoder->stream_index) {
                av_packet_unref(decoder->packet);
                continue;
            }
            result = avcodec_send_packet(decoder->codec, decoder->packet);
            av_packet_unref(decoder->packet);
            if (result == AVERROR(EAGAIN)) {
                break;
            }
            if (result < 0) {
                set_av_error(error_buffer, error_buffer_size, "FFmpeg packet submit failed", result);
                return -1;
            }
            break;
        }
    }
}

} // namespace

extern "C" LunaFfmpegD3D11Decoder *luna_ffmpeg_d3d11_open(
    const char *path_utf8,
    ID3D11Device *device,
    char *error_buffer,
    uint32_t error_buffer_size) {
    if (!path_utf8 || !device) {
        set_error(error_buffer, error_buffer_size, "FFmpeg D3D11 decoder received invalid arguments");
        return nullptr;
    }

    auto decoder = std::make_unique<LunaFfmpegD3D11Decoder>();
    int result = avformat_open_input(&decoder->format, path_utf8, nullptr, nullptr);
    if (result < 0) {
        set_av_error(error_buffer, error_buffer_size, "FFmpeg could not open video", result);
        return nullptr;
    }
    result = avformat_find_stream_info(decoder->format, nullptr);
    if (result < 0) {
        set_av_error(error_buffer, error_buffer_size, "FFmpeg could not inspect video", result);
        destroy_decoder(decoder.release());
        return nullptr;
    }

    const AVCodec *codec = nullptr;
    result = av_find_best_stream(
        decoder->format,
        AVMEDIA_TYPE_VIDEO,
        -1,
        -1,
        &codec,
        0);
    if (result < 0 || !codec) {
        set_av_error(error_buffer, error_buffer_size, "FFmpeg found no video decoder", result);
        destroy_decoder(decoder.release());
        return nullptr;
    }
    decoder->stream_index = result;
    AVStream *stream = decoder->format->streams[decoder->stream_index];
    decoder->time_base = stream->time_base;

    decoder->codec = avcodec_alloc_context3(codec);
    if (!decoder->codec) {
        set_error(error_buffer, error_buffer_size, "FFmpeg could not allocate a decoder");
        destroy_decoder(decoder.release());
        return nullptr;
    }
    result = avcodec_parameters_to_context(decoder->codec, stream->codecpar);
    if (result < 0) {
        set_av_error(error_buffer, error_buffer_size, "FFmpeg could not configure decoder", result);
        destroy_decoder(decoder.release());
        return nullptr;
    }

    decoder->hardware_device = av_hwdevice_ctx_alloc(AV_HWDEVICE_TYPE_D3D11VA);
    if (!decoder->hardware_device) {
        set_error(error_buffer, error_buffer_size, "FFmpeg D3D11VA device allocation failed");
        destroy_decoder(decoder.release());
        return nullptr;
    }
    auto *device_context = reinterpret_cast<AVHWDeviceContext *>(decoder->hardware_device->data);
    auto *d3d11_context = reinterpret_cast<AVD3D11VADeviceContext *>(device_context->hwctx);
    device->AddRef();
    d3d11_context->device = device;
    result = av_hwdevice_ctx_init(decoder->hardware_device);
    if (result < 0) {
        set_av_error(error_buffer, error_buffer_size, "FFmpeg D3D11VA device initialization failed", result);
        destroy_decoder(decoder.release());
        return nullptr;
    }

    decoder->codec->hw_device_ctx = av_buffer_ref(decoder->hardware_device);
    decoder->codec->get_format = select_d3d11_format;
    result = avcodec_open2(decoder->codec, codec, nullptr);
    if (result < 0) {
        set_av_error(error_buffer, error_buffer_size, "FFmpeg D3D11VA decoder initialization failed", result);
        destroy_decoder(decoder.release());
        return nullptr;
    }

    decoder->packet = av_packet_alloc();
    decoder->frame = av_frame_alloc();
    if (!decoder->packet || !decoder->frame) {
        set_error(error_buffer, error_buffer_size, "FFmpeg could not allocate decode buffers");
        destroy_decoder(decoder.release());
        return nullptr;
    }
    return decoder.release();
}

extern "C" int32_t luna_ffmpeg_d3d11_read_at(
    LunaFfmpegD3D11Decoder *decoder,
    double seconds,
    LunaFfmpegD3D11Frame *output,
    char *error_buffer,
    uint32_t error_buffer_size) {
    if (!decoder || !output || decoder->time_base.num <= 0 || decoder->time_base.den <= 0) {
        set_error(error_buffer, error_buffer_size, "FFmpeg D3D11 decoder is not initialized");
        return -1;
    }

    const double safe_seconds = std::fmax(0.0, seconds);
    const int64_t target = static_cast<int64_t>(std::floor(
        safe_seconds * decoder->time_base.den / decoder->time_base.num));
    const int64_t half_second = av_rescale_q(1, AVRational{1, 2}, decoder->time_base);
    if (decoder->last_target != AV_NOPTS_VALUE &&
        (target < decoder->last_target || target - decoder->last_target > half_second)) {
        if (!seek_decoder(decoder, target, error_buffer, error_buffer_size)) {
            return -1;
        }
    } else if (decoder->last_target == AV_NOPTS_VALUE && target > half_second) {
        if (!seek_decoder(decoder, target, error_buffer, error_buffer_size)) {
            return -1;
        }
    }

    for (;;) {
        const int read_result = receive_frame(decoder, error_buffer, error_buffer_size);
        if (read_result <= 0) {
            return read_result;
        }
        if (decoder->frame->format != AV_PIX_FMT_D3D11 || !decoder->frame->data[0]) {
            set_error(error_buffer, error_buffer_size, "FFmpeg decoder did not return a D3D11 texture");
            return -1;
        }
        const int64_t timestamp = decoder->frame->best_effort_timestamp;
        if (timestamp != AV_NOPTS_VALUE && timestamp < target) {
            continue;
        }

        auto *texture = reinterpret_cast<ID3D11Texture2D *>(decoder->frame->data[0]);
        D3D11_TEXTURE2D_DESC description = {};
        texture->GetDesc(&description);
        output->texture = texture;
        output->array_slice = static_cast<uint32_t>(reinterpret_cast<intptr_t>(decoder->frame->data[1]));
        output->width = static_cast<uint32_t>(decoder->frame->width);
        output->height = static_cast<uint32_t>(decoder->frame->height);
        output->dxgi_format = static_cast<int32_t>(description.Format);
        output->timestamp_100ns = timestamp == AV_NOPTS_VALUE
            ? static_cast<int64_t>(safe_seconds * 10000000.0)
            : av_rescale_q(timestamp, decoder->time_base, AVRational{1, 10000000});
        decoder->last_target = target;
        return 1;
    }
}

extern "C" int32_t luna_ffmpeg_d3d11_convert_current(
    LunaFfmpegD3D11Decoder *decoder,
    ID3D11Texture2D *output_texture,
    char *error_buffer,
    uint32_t error_buffer_size) {
    if (!decoder || !decoder->frame || !decoder->frame->data[0] || !output_texture) {
        set_error(error_buffer, error_buffer_size, "FFmpeg D3D11 conversion has no current frame");
        return -1;
    }

    auto *device_context = reinterpret_cast<AVHWDeviceContext *>(decoder->hardware_device->data);
    auto *hardware = reinterpret_cast<AVD3D11VADeviceContext *>(device_context->hwctx);
    auto *input_texture = reinterpret_cast<ID3D11Texture2D *>(decoder->frame->data[0]);
    const UINT array_slice = static_cast<UINT>(reinterpret_cast<intptr_t>(decoder->frame->data[1]));
    D3D11_TEXTURE2D_DESC input_description = {};
    D3D11_TEXTURE2D_DESC output_description = {};
    input_texture->GetDesc(&input_description);
    output_texture->GetDesc(&output_description);

    D3D11_VIDEO_PROCESSOR_CONTENT_DESC content = {};
    content.InputFrameFormat = D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;
    content.InputFrameRate = {30, 1};
    content.InputWidth = static_cast<UINT>(decoder->frame->width);
    content.InputHeight = static_cast<UINT>(decoder->frame->height);
    content.OutputFrameRate = {30, 1};
    content.OutputWidth = output_description.Width;
    content.OutputHeight = output_description.Height;
    content.Usage = D3D11_VIDEO_USAGE_PLAYBACK_NORMAL;

    ID3D11VideoProcessorEnumerator *enumerator = nullptr;
    ID3D11VideoProcessor *processor = nullptr;
    ID3D11VideoProcessorInputView *input_view = nullptr;
    ID3D11VideoProcessorOutputView *output_view = nullptr;
    HRESULT result = hardware->video_device->CreateVideoProcessorEnumerator(&content, &enumerator);
    if (FAILED(result)) {
        set_hresult_error(error_buffer, error_buffer_size, "D3D11 video processor enumeration failed", result);
        return -1;
    }
    result = hardware->video_device->CreateVideoProcessor(enumerator, 0, &processor);
    if (FAILED(result)) {
        set_hresult_error(error_buffer, error_buffer_size, "D3D11 video processor creation failed", result);
        enumerator->Release();
        return -1;
    }

    D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC input_description_view = {};
    input_description_view.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D;
    input_description_view.Texture2D.MipSlice = 0;
    input_description_view.Texture2D.ArraySlice = array_slice;
    result = hardware->video_device->CreateVideoProcessorInputView(
        input_texture, enumerator, &input_description_view, &input_view);
    if (FAILED(result)) {
        set_hresult_error(error_buffer, error_buffer_size, "D3D11 decode input view creation failed", result);
        processor->Release();
        enumerator->Release();
        return -1;
    }

    D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC output_description_view = {};
    output_description_view.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D;
    output_description_view.Texture2D.MipSlice = 0;
    result = hardware->video_device->CreateVideoProcessorOutputView(
        output_texture, enumerator, &output_description_view, &output_view);
    if (FAILED(result)) {
        set_hresult_error(error_buffer, error_buffer_size, "D3D11 shared output view creation failed", result);
        input_view->Release();
        processor->Release();
        enumerator->Release();
        return -1;
    }

    D3D11_VIDEO_PROCESSOR_STREAM stream = {};
    stream.Enable = TRUE;
    stream.pInputSurface = input_view;
    if (hardware->lock) {
        hardware->lock(hardware->lock_ctx);
    }
    result = hardware->video_context->VideoProcessorBlt(processor, output_view, 0, 1, &stream);
    if (hardware->unlock) {
        hardware->unlock(hardware->lock_ctx);
    }

    output_view->Release();
    input_view->Release();
    processor->Release();
    enumerator->Release();
    if (FAILED(result)) {
        set_hresult_error(error_buffer, error_buffer_size, "D3D11 video conversion failed", result);
        return -1;
    }
    return 0;
}

extern "C" void luna_ffmpeg_d3d11_close(LunaFfmpegD3D11Decoder *decoder) {
    destroy_decoder(decoder);
}
