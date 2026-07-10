/**
 * Luna AV Bridge — Windows Media Foundation + D3D12 Hardware Video Pipeline
 *
 * Provides hardware-accelerated video decoding (via IMFSourceReader + D3D11VA)
 * and encoding (via IMFSinkWriter + hardware encoder + D3D12 zero-copy)
 * for the luna-render-core wgpu compositor.
 *
 * Architecture v2:
 *   Decode:  IMFSourceReader (D3D11VA HW decode) → CPU readback → RGBA bytes
 *            (decode runs on GPU; readback is cheap single-copy)
 *   Encode:  wgpu D3D12 render → D3D12↔D3D11 shared texture → IMFDXGIBuffer
 *            → IMFSinkWriter (HW encoder). ZERO-COPY from compositor to encoder.
 *
 * LunaAVFrame carries a D3D12 resource handle for the writer path,
 * enabling wgpu to render directly into the encoder's output buffer.
 *
 * Interface mirrors src/macos/av_bridge.m exactly.
 */

#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <mferror.h>
#include <d3d11.h>
#include <d3d11_1.h>
#include <d3d12.h>
#include <dxgi1_2.h>
#include <dxgi1_4.h>
#include <codecapi.h>
#include <vector>
#include <string>
#include <cstdio>
#include <cstring>

#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfreadwrite.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "d3d11.lib")
#pragma comment(lib, "d3d12.lib")
#pragma comment(lib, "dxgi.lib")

// ── FFI frame struct (must match Rust side's LunaAvFrameRaw) ──
extern "C" {
    typedef struct {
        void   *handle;        // opaque: FrameHolder* (decoder) or OutputFrame* (writer)
        void   *d3d_texture;   // ID3D12Resource* — for wgpu wrapping (zero-copy writer path)
        void   *rgba_data;     // raw RGBA pixel buffer pointer (decoder path)
        uint32_t width;
        uint32_t height;
        double   pts_seconds;
    } LunaAVFrame;
}

// ═══════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════

static void luna_write_error(char *buffer, size_t length, const char *message) {
    if (buffer && length > 0) {
        snprintf(buffer, length, "%s", message ? message : "media error");
    }
}

static std::wstring utf8_to_wide(const char *str) {
    if (!str) return L"";
    int len = MultiByteToWideChar(CP_UTF8, 0, str, -1, nullptr, 0);
    if (len <= 0) return L"";
    std::wstring result(len - 1, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, str, -1, &result[0], len);
    return result;
}

// ── Global MF initialization (ref-counted) ──
static volatile LONG g_mf_init_count = 0;

static bool ensure_mf_startup(char *error_buffer, size_t error_length) {
    if (InterlockedIncrement(&g_mf_init_count) == 1) {
        HRESULT hr = MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET);
        if (FAILED(hr)) {
            InterlockedDecrement(&g_mf_init_count);
            char msg[256];
            snprintf(msg, sizeof(msg), "Media Foundation init failed: 0x%08X", (unsigned)hr);
            luna_write_error(error_buffer, error_length, msg);
            return false;
        }
    }
    return true;
}

static void mf_shutdown() {
    if (InterlockedDecrement(&g_mf_init_count) == 0) {
        MFShutdown();
    }
}

// ═══════════════════════════════════════════════════════
//  Shared D3D11 device creation for MF hardware acceleration
// ═══════════════════════════════════════════════════════

static ID3D11Device *create_d3d11_device_for_mf(char *error_buffer, size_t error_length) {
    D3D_FEATURE_LEVEL feature_levels[] = {
        D3D_FEATURE_LEVEL_11_1,
        D3D_FEATURE_LEVEL_11_0,
    };
    UINT create_flags = D3D11_CREATE_DEVICE_VIDEO_SUPPORT | D3D11_CREATE_DEVICE_BGRA_SUPPORT;

    ID3D11Device *device = nullptr;
    HRESULT hr = D3D11CreateDevice(
        nullptr,                    // default adapter
        D3D_DRIVER_TYPE_HARDWARE,
        nullptr,
        create_flags,
        feature_levels,
        ARRAYSIZE(feature_levels),
        D3D11_SDK_VERSION,
        &device,
        nullptr,                    // feature level out
        nullptr);                   // immediate context

    if (FAILED(hr)) {
        // Try without VIDEO_SUPPORT
        hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            feature_levels, ARRAYSIZE(feature_levels),
            D3D11_SDK_VERSION, &device, nullptr, nullptr);
    }

    if (FAILED(hr) || !device) {
        hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_WARP, nullptr,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            feature_levels, ARRAYSIZE(feature_levels),
            D3D11_SDK_VERSION, &device, nullptr, nullptr);
    }

    if (FAILED(hr) || !device) {
        luna_write_error(error_buffer, error_length, "Cannot create D3D11 device for Media Foundation");
        return nullptr;
    }
    return device;
}

static IMFDXGIDeviceManager *create_mf_device_manager(
    ID3D11Device *d3d11_device,
    char *error_buffer, size_t error_length)
{
    UINT reset_token = 0;
    IMFDXGIDeviceManager *mgr = nullptr;
    HRESULT hr = MFCreateDXGIDeviceManager(&reset_token, &mgr);
    if (FAILED(hr) || !mgr) {
        luna_write_error(error_buffer, error_length, "MFCreateDXGIDeviceManager failed");
        return nullptr;
    }

    IDXGIDevice *dxgi_device = nullptr;
    hr = d3d11_device->QueryInterface(IID_PPV_ARGS(&dxgi_device));
    if (FAILED(hr) || !dxgi_device) {
        mgr->Release();
        luna_write_error(error_buffer, error_length, "D3D11 device does not support DXGI");
        return nullptr;
    }

    hr = mgr->ResetDevice(dxgi_device, reset_token);
    dxgi_device->Release();

    if (FAILED(hr)) {
        mgr->Release();
        luna_write_error(error_buffer, error_length, "ResetDevice for MF device manager failed");
        return nullptr;
    }
    return mgr;
}

// ═══════════════════════════════════════════════════════
//  Frame base — polymorphic to support both decoder & writer frames
// ═══════════════════════════════════════════════════════

struct FrameBase {
    virtual ~FrameBase() = default;
};

// Decoder frame
struct FrameHolder : FrameBase {
    std::vector<uint8_t> data;
};

// Writer frame (v2 zero-copy)
struct OutputFrame : FrameBase {
    ID3D12Resource   *d3d12_texture = nullptr;
    ID3D11Texture2D  *d3d11_texture = nullptr;
    HANDLE            shared_handle = nullptr;
    IMFSample        *sample        = nullptr;
    UINT32            width  = 0;
    UINT32            height = 0;

    ~OutputFrame() override {
        if (sample)        sample->Release();
        if (d3d11_texture) d3d11_texture->Release();
        if (d3d12_texture) d3d12_texture->Release();
        if (shared_handle) CloseHandle(shared_handle);
    }
};

// ═══════════════════════════════════════════════════════
//  Video Decoder — IMFSourceReader with D3D11VA hw decode
// ═══════════════════════════════════════════════════════

struct LunaVideoDecoder {
    std::wstring         file_path;
    ID3D11Device        *d3d11_device;
    IMFDXGIDeviceManager *mf_device_manager;
    IMFSourceReader      *reader;
    UINT32                output_width;
    UINT32                output_height;
    UINT32                frame_bytes;
    double                fps;
    IMFSample            *current_sample;
    double                current_sample_pts;
    bool                  eof;
    bool                  owns_d3d11_device;

    LunaVideoDecoder()
        : d3d11_device(nullptr), mf_device_manager(nullptr), reader(nullptr)
        , output_width(0), output_height(0), frame_bytes(0)
        , fps(30.0), current_sample(nullptr), current_sample_pts(-1.0)
        , eof(false), owns_d3d11_device(false) {}

    ~LunaVideoDecoder() { close(); }

    void close() {
        if (current_sample) { current_sample->Release(); current_sample = nullptr; }
        if (reader) { reader->Release(); reader = nullptr; }
        if (mf_device_manager) { mf_device_manager->Release(); mf_device_manager = nullptr; }
        if (d3d11_device && owns_d3d11_device) {
            d3d11_device->Release();
            d3d11_device = nullptr;
            owns_d3d11_device = false;
        }
    }
};

static bool decoder_seek_to(LunaVideoDecoder *dec, double seconds,
    char *error_buffer, size_t error_length)
{
    if (!dec->reader) return false;

    if (dec->current_sample) {
        dec->current_sample->Release();
        dec->current_sample = nullptr;
    }
    dec->current_sample_pts = -1.0;
    dec->eof = false;

    PROPVARIANT pos;
    InitPropVariantFromInt64((LONGLONG)(seconds * 10000000.0));
    HRESULT hr = dec->reader->SetCurrentPosition(GUID_NULL, pos);
    PropVariantClear(&pos);
    if (FAILED(hr)) {
        char msg[256];
        snprintf(msg, sizeof(msg), "seek to %.3fs failed: 0x%08X", seconds, (unsigned)hr);
        luna_write_error(error_buffer, error_length, msg);
        dec->eof = true;
        return false;
    }
    return true;
}

static IMFSourceReader *create_source_reader(
    const wchar_t *file_path,
    IMFDXGIDeviceManager *device_manager,
    char *error_buffer, size_t error_length)
{
    IMFAttributes *attrs = nullptr;
    HRESULT hr = MFCreateAttributes(&attrs, 2);
    if (FAILED(hr)) {
        luna_write_error(error_buffer, error_length, "MFCreateAttributes failed");
        return nullptr;
    }

    if (device_manager) {
        attrs->SetUnknown(MF_SOURCE_READER_D3D_MANAGER, device_manager);
    }
    attrs->SetUINT32(MF_SOURCE_READER_ENABLE_ADVANCED_VIDEO_PROCESSING, TRUE);
    attrs->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, TRUE);

    IMFSourceReader *reader = nullptr;
    hr = MFCreateSourceReaderFromURL(file_path, attrs, &reader);
    attrs->Release();

    if (FAILED(hr)) {
        char msg[512];
        snprintf(msg, sizeof(msg), "Cannot open video: 0x%08X", (unsigned)hr);
        luna_write_error(error_buffer, error_length, msg);
        return nullptr;
    }
    return reader;
}

static bool configure_decoder_output(
    IMFSourceReader *reader,
    UINT32 *out_width, UINT32 *out_height, UINT32 *out_frame_bytes,
    double *out_fps,
    char *error_buffer, size_t error_length)
{
    IMFMediaType *native_type = nullptr;
    HRESULT hr = reader->GetNativeMediaType(
        (DWORD)MF_SOURCE_READER_FIRST_VIDEO_STREAM, 0, &native_type);
    if (FAILED(hr)) {
        luna_write_error(error_buffer, error_length, "Cannot get native video type");
        return false;
    }

    UINT32 orig_w = 0, orig_h = 0;
    MFGetAttributeSize(native_type, MF_MT_FRAME_SIZE, &orig_w, &orig_h);

    UINT32 num = 0, den = 0;
    MFGetAttributeRatio(native_type, MF_MT_FRAME_RATE, &num, &den);
    native_type->Release();

    IMFMediaType *output_type = nullptr;
    hr = MFCreateMediaType(&output_type);
    if (FAILED(hr)) {
        luna_write_error(error_buffer, error_length, "MFCreateMediaType failed");
        return false;
    }

    output_type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    output_type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_ARGB32);
    output_type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
    output_type->SetUINT32(MF_MT_ALL_SAMPLES_INDEPENDENT, TRUE);
    MFSetAttributeSize(output_type, MF_MT_FRAME_SIZE, orig_w, orig_h);
    MFSetAttributeRatio(output_type, MF_MT_FRAME_RATE, num, den);
    MFSetAttributeRatio(output_type, MF_MT_PIXEL_ASPECT_RATIO, 1, 1);

    hr = reader->SetCurrentMediaType(
        (DWORD)MF_SOURCE_READER_FIRST_VIDEO_STREAM, nullptr, output_type);
    if (FAILED(hr)) {
        output_type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_RGB32);
        hr = reader->SetCurrentMediaType(
            (DWORD)MF_SOURCE_READER_FIRST_VIDEO_STREAM, nullptr, output_type);
    }
    output_type->Release();

    if (FAILED(hr)) {
        char msg[256];
        snprintf(msg, sizeof(msg), "Cannot set decoder output format: 0x%08X", (unsigned)hr);
        luna_write_error(error_buffer, error_length, msg);
        return false;
    }

    *out_width  = orig_w;
    *out_height = orig_h;
    *out_frame_bytes = orig_w * orig_h * 4;
    *out_fps = (den > 0) ? (double)num / (double)den : 30.0;
    return true;
}

static std::vector<uint8_t> read_frame_rgba(
    LunaVideoDecoder *dec, double target_time,
    char *error_buffer, size_t error_length)
{
    if (!dec->reader || dec->eof) return {};

    DWORD stream_index = 0, flags = 0;
    LONGLONG timestamp = 0;
    IMFSample *sample = nullptr;
    const double epsilon = 0.001;
    const int max_attempts = 300;

    if (dec->current_sample_pts < 0.0 ||
        target_time + 0.05 < dec->current_sample_pts) {
        if (target_time < dec->current_sample_pts - 0.5) {
            if (!decoder_seek_to(dec, target_time, error_buffer, error_length)) {
                return {};
            }
        }
    }

    for (int attempt = 0; attempt < max_attempts; attempt++) {
        HRESULT hr = dec->reader->ReadSample(
            (DWORD)MF_SOURCE_READER_FIRST_VIDEO_STREAM,
            0, &stream_index, &flags, &timestamp, &sample);

        if (FAILED(hr)) {
            char msg[256];
            snprintf(msg, sizeof(msg), "ReadSample failed: 0x%08X", (unsigned)hr);
            luna_write_error(error_buffer, error_length, msg);
            return {};
        }

        if (flags & MF_SOURCE_READERF_ENDOFSTREAM) {
            dec->eof = true;
            if (sample) { sample->Release(); sample = nullptr; }
            return {};
        }

        if (!sample) continue;

        double pts = (double)timestamp / 10000000.0;
        if (pts >= target_time - epsilon) {
            if (dec->current_sample) dec->current_sample->Release();
            dec->current_sample = sample;
            dec->current_sample_pts = pts;

            IMFMediaBuffer *buffer = nullptr;
            hr = sample->ConvertToContiguousBuffer(&buffer);
            if (FAILED(hr)) {
                hr = sample->GetBufferByIndex(0, &buffer);
            }
            if (FAILED(hr) || !buffer) {
                if (buffer) buffer->Release();
                luna_write_error(error_buffer, error_length, "Cannot get frame buffer");
                return {};
            }

            BYTE *data = nullptr;
            DWORD max_len = 0, cur_len = 0;
            hr = buffer->Lock(&data, &max_len, &cur_len);
            if (FAILED(hr) || !data) {
                buffer->Release();
                luna_write_error(error_buffer, error_length, "Cannot lock frame buffer");
                return {};
            }

            std::vector<uint8_t> result(dec->frame_bytes);
            size_t copy_len = cur_len < dec->frame_bytes ? cur_len : dec->frame_bytes;
            memcpy(result.data(), data, copy_len);
            if (cur_len < dec->frame_bytes) {
                memset(result.data() + cur_len, 0, dec->frame_bytes - cur_len);
            }

            buffer->Unlock();
            buffer->Release();
            return result;
        } else {
            if (sample) sample->Release();
            sample = nullptr;
        }
    }

    dec->eof = true;
    return {};
}

// ═══════════════════════════════════════════════════════
//  Video Writer v2 — IMFSinkWriter + D3D12↔D3D11 zero-copy
// ═══════════════════════════════════════════════════════

struct LunaVideoWriter {
    std::wstring         file_path;
    ID3D12Device        *d3d12_device;       // from wgpu (borrowed, not owned)
    ID3D11Device        *d3d11_device;       // separate device for MF
    IMFDXGIDeviceManager *mf_device_manager;
    IMFSinkWriter       *writer;
    DWORD                stream_index;
    UINT32               width;
    UINT32               height;
    double               fps;
    UINT64               frame_count;
    bool                 finished;
    bool                 owns_d3d11_device;

    LunaVideoWriter()
        : d3d12_device(nullptr), d3d11_device(nullptr)
        , mf_device_manager(nullptr), writer(nullptr)
        , stream_index(0), width(0), height(0)
        , fps(30.0), frame_count(0), finished(false)
        , owns_d3d11_device(false) {}

    ~LunaVideoWriter() { close(); }

    void close() {
        // Release writer first (references D3D11 device via mf_device_manager)
        if (writer) { writer->Release(); writer = nullptr; }
        if (mf_device_manager) { mf_device_manager->Release(); mf_device_manager = nullptr; }
        if (d3d11_device && owns_d3d11_device) {
            d3d11_device->Release();
            d3d11_device = nullptr;
            owns_d3d11_device = false;
        }
        // d3d12_device is borrowed from wgpu — don't release
        d3d12_device = nullptr;
    }

    /// Create a D3D12 render-target texture with cross-API sharing enabled.
    ID3D12Resource *create_shared_output_texture(
        char *error_buffer, size_t error_length)
    {
        D3D12_HEAP_PROPERTIES heap_props = {};
        heap_props.Type = D3D12_HEAP_TYPE_DEFAULT;
        heap_props.CPUPageProperty = D3D12_CPU_PAGE_PROPERTY_UNKNOWN;
        heap_props.MemoryPoolPreference = D3D12_MEMORY_POOL_UNKNOWN;

        D3D12_RESOURCE_DESC desc = {};
        desc.Dimension = D3D12_RESOURCE_DIMENSION_TEXTURE2D;
        desc.Alignment = 0;
        desc.Width = width;
        desc.Height = height;
        desc.DepthOrArraySize = 1;
        desc.MipLevels = 1;
        // B8G8R8A8_UNORM_SRGB matches wgpu::TextureFormat::Bgra8UnormSrgb
        // which is the format our compositor pipeline_bgra renders into.
        desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM_SRGB;
        desc.SampleDesc.Count = 1;
        desc.SampleDesc.Quality = 0;
        desc.Layout = D3D12_TEXTURE_LAYOUT_UNKNOWN;
        desc.Flags = D3D12_RESOURCE_FLAG_ALLOW_RENDER_TARGET
                   | D3D12_RESOURCE_FLAG_ALLOW_SIMULTANEOUS_ACCESS;

        D3D12_CLEAR_VALUE clear_value = {};
        clear_value.Format = DXGI_FORMAT_B8G8R8A8_UNORM_SRGB;

        ID3D12Resource *resource = nullptr;
        HRESULT hr = d3d12_device->CreateCommittedResource(
            &heap_props,
            D3D12_HEAP_FLAG_SHARED,
            &desc,
            D3D12_RESOURCE_STATE_RENDER_TARGET,
            &clear_value,
            IID_PPV_ARGS(&resource));

        if (FAILED(hr) || !resource) {
            // Try without clear value (some drivers don't support it)
            hr = d3d12_device->CreateCommittedResource(
                &heap_props,
                D3D12_HEAP_FLAG_SHARED,
                &desc,
                D3D12_RESOURCE_STATE_COMMON,
                nullptr,
                IID_PPV_ARGS(&resource));
        }

        if (FAILED(hr) || !resource) {
            char msg[256];
            snprintf(msg, sizeof(msg),
                "Cannot create shared D3D12 texture: 0x%08X", (unsigned)hr);
            luna_write_error(error_buffer, error_length, msg);
            return nullptr;
        }
        return resource;
    }

    /// Open the D3D12 shared resource on the D3D11 device.
    ID3D11Texture2D *open_shared_on_d3d11(
        HANDLE shared_handle,
        char *error_buffer, size_t error_length)
    {
        ID3D11Device1 *d3d11_device1 = nullptr;
        HRESULT hr = d3d11_device->QueryInterface(IID_PPV_ARGS(&d3d11_device1));
        if (FAILED(hr) || !d3d11_device1) {
            luna_write_error(error_buffer, error_length,
                "D3D11 device does not support OpenSharedResource1");
            return nullptr;
        }

        ID3D11Texture2D *texture = nullptr;
        hr = d3d11_device1->OpenSharedResource1(shared_handle,
            IID_PPV_ARGS(&texture));
        d3d11_device1->Release();

        if (FAILED(hr) || !texture) {
            char msg[256];
            snprintf(msg, sizeof(msg),
                "Cannot open shared D3D11 texture: 0x%08X", (unsigned)hr);
            luna_write_error(error_buffer, error_length, msg);
            return nullptr;
        }
        return texture;
    }

    /// Build an IMFSample with a DXGI buffer wrapping the D3D11 texture.
    IMFSample *build_mf_sample(
        ID3D11Texture2D *d3d11_texture,
        char *error_buffer, size_t error_length)
    {
        // Create DXGI surface buffer
        IMFMediaBuffer *media_buffer = nullptr;
        HRESULT hr = MFCreateDXGISurfaceBuffer(
            __uuidof(ID3D11Texture2D),
            d3d11_texture,
            0,   // subresource index
            FALSE,
            &media_buffer);

        if (FAILED(hr) || !media_buffer) {
            char msg[256];
            snprintf(msg, sizeof(msg),
                "MFCreateDXGISurfaceBuffer failed: 0x%08X", (unsigned)hr);
            luna_write_error(error_buffer, error_length, msg);
            return nullptr;
        }

        IMFSample *sample = nullptr;
        hr = MFCreateSample(&sample);
        if (FAILED(hr) || !sample) {
            media_buffer->Release();
            luna_write_error(error_buffer, error_length, "MFCreateSample failed");
            return nullptr;
        }

        hr = sample->AddBuffer(media_buffer);
        media_buffer->Release();

        if (FAILED(hr)) {
            sample->Release();
            luna_write_error(error_buffer, error_length, "AddBuffer to sample failed");
            return nullptr;
        }
        return sample;
    }
};

static IMFSinkWriter *create_sink_writer(
    const wchar_t *file_path,
    IMFDXGIDeviceManager *device_manager,
    UINT32 width, UINT32 height,
    double fps, uint64_t bitrate,
    DWORD *out_stream_index,
    char *error_buffer, size_t error_length)
{
    DeleteFileW(file_path);

    IMFAttributes *attrs = nullptr;
    HRESULT hr = MFCreateAttributes(&attrs, 2);
    if (FAILED(hr)) {
        luna_write_error(error_buffer, error_length, "MFCreateAttributes for writer failed");
        return nullptr;
    }

    if (device_manager) {
        attrs->SetUnknown(MF_SINK_WRITER_D3D_MANAGER, device_manager);
    }
    attrs->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, TRUE);
    attrs->SetUINT32(MF_SINK_WRITER_DISABLE_THROTTLING, TRUE);

    IMFSinkWriter *writer = nullptr;
    hr = MFCreateSinkWriterFromURL(file_path, nullptr, attrs, &writer);
    attrs->Release();

    if (FAILED(hr)) {
        char msg[512];
        snprintf(msg, sizeof(msg), "Cannot create video writer: 0x%08X", (unsigned)hr);
        luna_write_error(error_buffer, error_length, msg);
        return nullptr;
    }

    // Create input media type (BGRA)
    IMFMediaType *input_type = nullptr;
    hr = MFCreateMediaType(&input_type);
    if (FAILED(hr)) {
        writer->Release();
        luna_write_error(error_buffer, error_length, "MFCreateMediaType failed");
        return nullptr;
    }

    input_type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    input_type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_ARGB32);
    MFSetAttributeSize(input_type, MF_MT_FRAME_SIZE, width, height);
    MFSetAttributeRatio(input_type, MF_MT_FRAME_RATE, (UINT32)fps, 1);
    MFSetAttributeRatio(input_type, MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    input_type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
    input_type->SetUINT32(MF_MT_ALL_SAMPLES_INDEPENDENT, TRUE);
    input_type->SetUINT32(MF_MT_AVG_BITRATE, (UINT32)bitrate);

    DWORD stream_index = 0;
    hr = writer->AddStream(input_type, &stream_index);
    input_type->Release();

    if (FAILED(hr)) {
        writer->Release();
        char msg[256];
        snprintf(msg, sizeof(msg), "AddStream failed: 0x%08X", (unsigned)hr);
        luna_write_error(error_buffer, error_length, msg);
        return nullptr;
    }
    *out_stream_index = stream_index;

    // Try H.264 output configuration
    IMFMediaType *output_type = nullptr;
    if (SUCCEEDED(MFCreateMediaType(&output_type))) {
        output_type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
        output_type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
        MFSetAttributeSize(output_type, MF_MT_FRAME_SIZE, width, height);
        MFSetAttributeRatio(output_type, MF_MT_FRAME_RATE, (UINT32)fps, 1);
        MFSetAttributeRatio(output_type, MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
        output_type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
        output_type->SetUINT32(MF_MT_AVG_BITRATE, (UINT32)bitrate);
        writer->SetOutputType(stream_index, output_type, 0);
        output_type->Release();
    }

    return writer;
}

// ═══════════════════════════════════════════════════════
//  C FFI — Exported Functions
// ═══════════════════════════════════════════════════════

extern "C" {

// ── Decoder ──

void *luna_av_decoder_create(
    const char *path,
    void * /*d3d12_device — unused for decoder*/,
    char *error_buffer, size_t error_length)
{
    if (!ensure_mf_startup(error_buffer, error_length)) return nullptr;

    std::wstring wpath = utf8_to_wide(path);
    LunaVideoDecoder *dec = new LunaVideoDecoder();
    dec->file_path = wpath;

    // Create D3D11 device for MF hardware decode
    dec->d3d11_device = create_d3d11_device_for_mf(error_buffer, error_length);
    dec->owns_d3d11_device = (dec->d3d11_device != nullptr);

    if (dec->d3d11_device) {
        dec->mf_device_manager = create_mf_device_manager(
            dec->d3d11_device, error_buffer, error_length);
    }

    dec->reader = create_source_reader(wpath.c_str(),
        dec->mf_device_manager, error_buffer, error_length);
    if (!dec->reader) {
        delete dec;
        return nullptr;
    }

    if (!configure_decoder_output(dec->reader,
            &dec->output_width, &dec->output_height, &dec->frame_bytes,
            &dec->fps, error_buffer, error_length)) {
        delete dec;
        return nullptr;
    }

    // Prime the decoder with first frame
    read_frame_rgba(dec, 0.0, error_buffer, error_length);
    return dec;
}

void luna_av_decoder_destroy(void *decoder_ptr) {
    if (!decoder_ptr) return;
    delete static_cast<LunaVideoDecoder *>(decoder_ptr);
    mf_shutdown();
}

bool luna_av_decoder_frame(
    void *decoder_ptr, double seconds,
    LunaAVFrame *out_frame,
    char *error_buffer, size_t error_length)
{
    if (!decoder_ptr || !out_frame) return false;
    LunaVideoDecoder *dec = static_cast<LunaVideoDecoder *>(decoder_ptr);

    auto rgba = read_frame_rgba(dec, seconds, error_buffer, error_length);
    if (rgba.empty()) {
        if (dec->eof && error_buffer) error_buffer[0] = '\0';
        return false;
    }

    FrameHolder *holder = new FrameHolder();
    holder->data = std::move(rgba);

    out_frame->handle      = holder;
    out_frame->d3d_texture = nullptr;   // decoder path: no GPU texture
    out_frame->rgba_data   = holder->data.data();
    out_frame->width       = dec->output_width;
    out_frame->height      = dec->output_height;
    out_frame->pts_seconds = seconds;
    return true;
}

// ── Writer (v2 zero-copy via D3D12↔D3D11 shared textures) ──

void *luna_av_writer_create(
    const char *path,
    void *d3d12_device_ptr,
    uint32_t width, uint32_t height,
    double fps, uint64_t bitrate,
    bool /*hevc*/,
    char *error_buffer, size_t error_length)
{
    if (!ensure_mf_startup(error_buffer, error_length)) return nullptr;

    std::wstring wpath = utf8_to_wide(path);

    LunaVideoWriter *writer = new LunaVideoWriter();
    writer->file_path = wpath;
    writer->width  = width;
    writer->height = height;
    writer->fps    = fps;

    // Cast wgpu's D3D12 device (borrowed — do NOT AddRef/Release)
    writer->d3d12_device = static_cast<ID3D12Device *>(d3d12_device_ptr);
    if (!writer->d3d12_device) {
        delete writer;
        luna_write_error(error_buffer, error_length, "No D3D12 device from wgpu");
        return nullptr;
    }

    // Create a separate D3D11 device for MF (NOT D3D11On12)
    // Shared NT handles bridge D3D12↔D3D11
    writer->d3d11_device = create_d3d11_device_for_mf(error_buffer, error_length);
    writer->owns_d3d11_device = (writer->d3d11_device != nullptr);

    if (writer->d3d11_device) {
        writer->mf_device_manager = create_mf_device_manager(
            writer->d3d11_device, error_buffer, error_length);
    }

    DWORD stream_index = 0;
    writer->writer = create_sink_writer(
        wpath.c_str(),
        writer->mf_device_manager,
        width, height, fps, bitrate,
        &stream_index,
        error_buffer, error_length);
    writer->stream_index = stream_index;

    if (!writer->writer) {
        delete writer;
        return nullptr;
    }

    return writer;
}

bool luna_av_writer_acquire_frame(
    void *writer_ptr,
    LunaAVFrame *out_frame,
    char *error_buffer, size_t error_length)
{
    LunaVideoWriter *writer = static_cast<LunaVideoWriter *>(writer_ptr);
    if (!writer || !out_frame) return false;

    // 1. Create D3D12 render-target texture with sharing enabled
    ID3D12Resource *d3d12_tex = writer->create_shared_output_texture(
        error_buffer, error_length);
    if (!d3d12_tex) return false;

    // 2. Export as NT handle
    HANDLE shared_handle = nullptr;
    HRESULT hr = writer->d3d12_device->CreateSharedHandle(
        d3d12_tex, nullptr, GENERIC_ALL, nullptr, &shared_handle);
    if (FAILED(hr) || !shared_handle) {
        d3d12_tex->Release();
        char msg[256];
        snprintf(msg, sizeof(msg),
            "CreateSharedHandle failed: 0x%08X", (unsigned)hr);
        luna_write_error(error_buffer, error_length, msg);
        return false;
    }

    // 3. Open shared resource on D3D11 device
    ID3D11Texture2D *d3d11_tex = writer->open_shared_on_d3d11(
        shared_handle, error_buffer, error_length);
    if (!d3d11_tex) {
        CloseHandle(shared_handle);
        d3d12_tex->Release();
        return false;
    }

    // 4. Build IMF sample with DXGI buffer wrapping the D3D11 texture
    IMFSample *sample = writer->build_mf_sample(
        d3d11_tex, error_buffer, error_length);
    if (!sample) {
        d3d11_tex->Release();
        CloseHandle(shared_handle);
        d3d12_tex->Release();
        return false;
    }

    // 5. Store everything in OutputFrame, return D3D12 resource to Rust
    OutputFrame *frame = new OutputFrame();
    frame->d3d12_texture = d3d12_tex;
    frame->d3d11_texture = d3d11_tex;
    frame->shared_handle = shared_handle;
    frame->sample         = sample;
    frame->width          = writer->width;
    frame->height         = writer->height;

    out_frame->handle      = frame;
    out_frame->d3d_texture = d3d12_tex;  // ← wgpu renders into this!
    out_frame->rgba_data   = nullptr;    // not used in writer path
    out_frame->width       = writer->width;
    out_frame->height      = writer->height;
    out_frame->pts_seconds = 0.0;
    return true;
}

bool luna_av_writer_append_frame(
    void *writer_ptr,
    void *frame_ptr,
    uint64_t frame_index,
    char *error_buffer, size_t error_length)
{
    LunaVideoWriter *writer = static_cast<LunaVideoWriter *>(writer_ptr);
    OutputFrame *frame = static_cast<OutputFrame *>(frame_ptr);
    if (!writer || !frame) return false;

    // The Rust side has finished rendering into frame->d3d12_texture.
    // The shared NT handle ensures D3D11 sees the rendered content.
    // (Synchronization: Rust called device.poll(Wait) before calling this.)

    // Set timestamp and submit to SinkWriter
    LONGLONG sample_time = (LONGLONG)(
        (double)frame_index / writer->fps * 10000000.0);
    LONGLONG sample_duration = (LONGLONG)(10000000.0 / writer->fps);

    frame->sample->SetSampleTime(sample_time);
    frame->sample->SetSampleDuration(sample_duration);

    HRESULT hr = writer->writer->WriteSample(
        writer->stream_index, frame->sample);

    if (FAILED(hr)) {
        char msg[256];
        snprintf(msg, sizeof(msg),
            "WriteSample failed: 0x%08X", (unsigned)hr);
        luna_write_error(error_buffer, error_length, msg);
        return false;
    }

    writer->frame_count = frame_index + 1;
    return true;
}

void luna_av_frame_destroy(void *frame_ptr) {
    if (!frame_ptr) return;
    // Polymorphic delete — virtual destructor handles FrameHolder/OutputFrame correctly
    delete static_cast<FrameBase *>(frame_ptr);
}

// Legacy: direct RGBA write for fallback path (kept for backwards compat)
bool luna_av_writer_write_frame_rgba(
    void *writer_ptr,
    const uint8_t *rgba_data,
    uint32_t width, uint32_t height,
    uint32_t data_size,
    uint64_t frame_index,
    char *error_buffer, size_t error_length)
{
    LunaVideoWriter *writer = static_cast<LunaVideoWriter *>(writer_ptr);
    if (!writer || !writer->writer || !rgba_data) {
        luna_write_error(error_buffer, error_length, "Invalid writer or data");
        return false;
    }

    UINT32 expected = width * height * 4;
    UINT32 actual = (data_size > 0) ? data_size : expected;

    IMFMediaBuffer *buffer = nullptr;
    HRESULT hr = MFCreateMemoryBuffer(actual, &buffer);
    if (FAILED(hr)) return false;

    BYTE *dst = nullptr;
    hr = buffer->Lock(&dst, nullptr, nullptr);
    if (FAILED(hr)) { buffer->Release(); return false; }

    // Swizzle RGBA(wgpu) → BGRA(MF)
    for (UINT32 i = 0; i < actual; i += 4) {
        dst[i]     = rgba_data[i + 2];
        dst[i + 1] = rgba_data[i + 1];
        dst[i + 2] = rgba_data[i];
        dst[i + 3] = rgba_data[i + 3];
    }
    buffer->SetCurrentLength(actual);
    buffer->Unlock();

    IMFSample *sample = nullptr;
    MFCreateSample(&sample);
    sample->AddBuffer(buffer);
    buffer->Release();

    LONGLONG sample_time = (LONGLONG)(
        (double)frame_index / writer->fps * 10000000.0);
    LONGLONG sample_duration = (LONGLONG)(10000000.0 / writer->fps);
    sample->SetSampleTime(sample_time);
    sample->SetSampleDuration(sample_duration);

    hr = writer->writer->WriteSample(writer->stream_index, sample);
    sample->Release();

    if (FAILED(hr)) {
        char msg[256];
        snprintf(msg, sizeof(msg), "WriteSample failed: 0x%08X", (unsigned)hr);
        luna_write_error(error_buffer, error_length, msg);
        return false;
    }
    return true;
}

bool luna_av_writer_finish(
    void *writer_ptr,
    char *error_buffer, size_t error_length)
{
    LunaVideoWriter *writer = static_cast<LunaVideoWriter *>(writer_ptr);
    if (!writer || !writer->writer) {
        luna_write_error(error_buffer, error_length, "writer not initialized");
        return false;
    }

    HRESULT hr = writer->writer->Finalize();
    if (FAILED(hr)) {
        char msg[256];
        snprintf(msg, sizeof(msg), "Finalize failed: 0x%08X", (unsigned)hr);
        luna_write_error(error_buffer, error_length, msg);
        return false;
    }

    writer->finished = true;
    writer->close();
    return true;
}

void luna_av_writer_cancel(void *writer_ptr) {
    if (!writer_ptr) return;
    LunaVideoWriter *writer = static_cast<LunaVideoWriter *>(writer_ptr);
    writer->close();
}

void luna_av_writer_destroy(void *writer_ptr) {
    if (!writer_ptr) return;
    LunaVideoWriter *writer = static_cast<LunaVideoWriter *>(writer_ptr);
    delete writer;
    mf_shutdown();
}

} // extern "C"
