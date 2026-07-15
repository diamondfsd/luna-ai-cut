#import <AVFoundation/AVFoundation.h>
#import <CoreVideo/CoreVideo.h>
#import <Metal/Metal.h>

typedef struct {
    void *handle;
    void *metal_texture;
    uint32_t width;
    uint32_t height;
    double pts_seconds;
} LunaAVFrame;

static void luna_write_error(char *buffer, size_t length, NSError *error, NSString *fallback) {
    if (buffer == NULL || length == 0) return;
    NSString *message = error.localizedDescription ?: fallback ?: @"媒体处理失败";
    snprintf(buffer, length, "%s", message.UTF8String ?: "media error");
}

@interface LunaMetalFrame : NSObject
@property(nonatomic, assign) CVPixelBufferRef pixelBuffer;
@property(nonatomic, assign) CVMetalTextureRef metalTexture;
@property(nonatomic, assign) double pts;
- (instancetype)initWithPixelBuffer:(CVPixelBufferRef)pixelBuffer
                         textureCache:(CVMetalTextureCacheRef)textureCache
                                  pts:(double)pts
                                error:(NSError **)error;
@end

@implementation LunaMetalFrame
- (instancetype)initWithPixelBuffer:(CVPixelBufferRef)pixelBuffer
                         textureCache:(CVMetalTextureCacheRef)textureCache
                                  pts:(double)pts
                                error:(NSError **)error {
    self = [super init];
    if (!self) return nil;
    _pixelBuffer = CVPixelBufferRetain(pixelBuffer);
    _pts = pts;
    const size_t width = CVPixelBufferGetWidth(pixelBuffer);
    const size_t height = CVPixelBufferGetHeight(pixelBuffer);
    CVReturn result = CVMetalTextureCacheCreateTextureFromImage(
        kCFAllocatorDefault,
        textureCache,
        pixelBuffer,
        NULL,
        MTLPixelFormatBGRA8Unorm_sRGB,
        width,
        height,
        0,
        &_metalTexture
    );
    if (result != kCVReturnSuccess || _metalTexture == NULL) {
        if (error) {
            *error = [NSError errorWithDomain:@"LunaAVBridge"
                                         code:result
                                     userInfo:@{NSLocalizedDescriptionKey: @"无法创建 GPU 视频纹理"}];
        }
        return nil;
    }
    return self;
}

- (void)dealloc {
    if (_metalTexture) CFRelease(_metalTexture);
    if (_pixelBuffer) CVPixelBufferRelease(_pixelBuffer);
}
@end

@interface LunaVideoDecoder : NSObject
@property(nonatomic, strong) NSURL *url;
@property(nonatomic, strong) AVAssetReader *reader;
@property(nonatomic, strong) AVAssetReaderTrackOutput *output;
@property(nonatomic, assign) CMSampleBufferRef currentSample;
@property(nonatomic, assign) CMSampleBufferRef nextSample;
@property(nonatomic, assign) double currentPTS;
@property(nonatomic, assign) CVMetalTextureCacheRef textureCache;
@property(nonatomic, assign) uint32_t maxEdge;
@property(nonatomic, assign) int rotationDegrees;
- (instancetype)initWithPath:(NSString *)path device:(id<MTLDevice>)device maxEdge:(uint32_t)maxEdge error:(NSError **)error;
- (BOOL)restartAt:(double)seconds error:(NSError **)error;
- (LunaMetalFrame *)frameAt:(double)seconds error:(NSError **)error;
@end

@implementation LunaVideoDecoder
- (instancetype)initWithPath:(NSString *)path device:(id<MTLDevice>)device maxEdge:(uint32_t)maxEdge error:(NSError **)error {
    self = [super init];
    if (!self) return nil;
    _url = [NSURL fileURLWithPath:path];
    _maxEdge = maxEdge;
    CVReturn result = CVMetalTextureCacheCreate(kCFAllocatorDefault, NULL, device, NULL, &_textureCache);
    if (result != kCVReturnSuccess) {
        if (error) *error = [NSError errorWithDomain:@"LunaAVBridge" code:result userInfo:@{NSLocalizedDescriptionKey: @"无法初始化 GPU 视频解码"}];
        return nil;
    }
    if (![self restartAt:0 error:error]) return nil;
    return self;
}

- (void)clearSamples {
    if (_currentSample) CFRelease(_currentSample);
    if (_nextSample) CFRelease(_nextSample);
    _currentSample = NULL;
    _nextSample = NULL;
    _currentPTS = -1;
}

- (BOOL)restartAt:(double)seconds error:(NSError **)error {
    [self clearSamples];
    [_reader cancelReading];
    AVURLAsset *asset = [AVURLAsset URLAssetWithURL:_url options:@{AVURLAssetPreferPreciseDurationAndTimingKey: @YES}];
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
#pragma clang diagnostic ignored "-Wunused-variable"
    AVAssetTrack *track = [[asset tracksWithMediaType:AVMediaTypeVideo] firstObject];
#pragma clang diagnostic pop
    if (!track) {
        if (error) *error = [NSError errorWithDomain:@"LunaAVBridge" code:-1 userInfo:@{NSLocalizedDescriptionKey: @"视频中没有可用画面"}];
        return NO;
    }
    _reader = [[AVAssetReader alloc] initWithAsset:asset error:error];
    if (!_reader) return NO;

    // ── 根据 maxEdge 和原视频宽高比计算输出尺寸 ──
    // 注意：输出尺寸使用 naturalSize（编码方向），不应用 preferredTransform 的旋转。
    // AVAssetReader 不会旋转像素内容，旋转完全由 GPU shader 通过 orientation 参数处理。
    // 如果用 displaySize（旋转后尺寸），编码为横屏的视频会被拉伸到竖屏缓冲区，导致画面变形。
    CGSize naturalSize = track.naturalSize;
    CGFloat natW = naturalSize.width;
    CGFloat natH = naturalSize.height;

    // ── 从变换矩阵中提取旋转角度（度数），供 GPU shader 使用 ──
    CGAffineTransform preferredTransform = track.preferredTransform;
    CGFloat radians = atan2(preferredTransform.b, preferredTransform.a);
    int degrees = (int)round(radians * 180.0 / M_PI);
    while (degrees < 0) degrees += 360;
    degrees = degrees % 360;
    self.rotationDegrees = (degrees % 90 == 0) ? degrees : 0;

    uint32_t outputW, outputH;
    CGFloat maxEdgeSrc = (CGFloat)MAX(natW, natH);
    if (maxEdgeSrc <= _maxEdge) {
        outputW = (uint32_t)natW;
        outputH = (uint32_t)natH;
    } else {
        CGFloat scale = (CGFloat)_maxEdge / maxEdgeSrc;
        outputW = (uint32_t)(natW * scale);
        outputH = (uint32_t)(natH * scale);
    }

    NSDictionary *settings = @{
        (id)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA),
        (id)kCVPixelBufferMetalCompatibilityKey: @YES,
        (id)kCVPixelBufferIOSurfacePropertiesKey: @{},
        (id)kCVPixelBufferWidthKey: @(outputW),
        (id)kCVPixelBufferHeightKey: @(outputH),
    };
    _output = [[AVAssetReaderTrackOutput alloc] initWithTrack:track outputSettings:settings];
    _output.alwaysCopiesSampleData = NO;
    if (![_reader canAddOutput:_output]) {
        if (error) *error = [NSError errorWithDomain:@"LunaAVBridge" code:-2 userInfo:@{NSLocalizedDescriptionKey: @"无法启动视频解码"}];
        return NO;
    }
    [_reader addOutput:_output];
    if (seconds > 0) {
        _reader.timeRange = CMTimeRangeMake(CMTimeMakeWithSeconds(seconds, 60000), kCMTimePositiveInfinity);
    }
    if (![_reader startReading]) {
        if (error) *error = _reader.error;
        return NO;
    }
    _nextSample = [_output copyNextSampleBuffer];
    return YES;
}

- (LunaMetalFrame *)frameAt:(double)seconds error:(NSError **)error {
    CFAbsoluteTime t0 = CFAbsoluteTimeGetCurrent();
    CFAbsoluteTime t_restart = 0, t_copy = 0, t_texture = 0;
    BOOL didRestart = NO;

    if (!_currentSample || seconds + 0.05 < _currentPTS) {
        if (![self restartAt:seconds error:error]) return nil;
        didRestart = YES;
    }
    t_restart = CFAbsoluteTimeGetCurrent();

    while (_nextSample) {
        double nextPTS = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(_nextSample));
        if (_currentSample && nextPTS > seconds + 0.0005) break;
        if (_currentSample) CFRelease(_currentSample);
        _currentSample = _nextSample;
        _currentPTS = isfinite(nextPTS) ? nextPTS : seconds;
        _nextSample = [_output copyNextSampleBuffer];
    }
    t_copy = CFAbsoluteTimeGetCurrent();

    if (!_currentSample) {
        if (_reader.status == AVAssetReaderStatusFailed && error) *error = _reader.error;
        return nil;
    }
    CVPixelBufferRef pixelBuffer = CMSampleBufferGetImageBuffer(_currentSample);
    if (!pixelBuffer) return nil;
    LunaMetalFrame *frame = [[LunaMetalFrame alloc] initWithPixelBuffer:pixelBuffer textureCache:_textureCache pts:_currentPTS error:error];
    t_texture = CFAbsoluteTimeGetCurrent();

    return frame;
}

- (void)dealloc {
    [_reader cancelReading];
    [self clearSamples];
    if (_textureCache) CFRelease(_textureCache);
}
@end

@interface LunaVideoWriter : NSObject
@property(nonatomic, strong) AVAssetWriter *writer;
@property(nonatomic, strong) AVAssetWriterInput *input;
@property(nonatomic, strong) AVAssetWriterInputPixelBufferAdaptor *adaptor;
@property(nonatomic, assign) CVMetalTextureCacheRef textureCache;
@property(nonatomic, assign) double fps;
- (instancetype)initWithPath:(NSString *)path device:(id<MTLDevice>)device width:(uint32_t)width height:(uint32_t)height fps:(double)fps bitrate:(NSInteger)bitrate hevc:(BOOL)hevc error:(NSError **)error;
@end

@implementation LunaVideoWriter
- (instancetype)initWithPath:(NSString *)path device:(id<MTLDevice>)device width:(uint32_t)width height:(uint32_t)height fps:(double)fps bitrate:(NSInteger)bitrate hevc:(BOOL)hevc error:(NSError **)error {
    self = [super init];
    if (!self) return nil;
    _fps = fps;
    NSURL *url = [NSURL fileURLWithPath:path];
    [[NSFileManager defaultManager] removeItemAtURL:url error:nil];
    _writer = [[AVAssetWriter alloc] initWithURL:url fileType:AVFileTypeMPEG4 error:error];
    if (!_writer) return nil;
    NSDictionary *compression = @{
        AVVideoAverageBitRateKey: @(bitrate),
        AVVideoExpectedSourceFrameRateKey: @(fps),
        AVVideoMaxKeyFrameIntervalKey: @(MAX(1, (NSInteger)llround(fps * 2.0))),
        AVVideoAllowFrameReorderingKey: @YES,
    };
    NSDictionary *settings = @{
        AVVideoCodecKey: hevc ? AVVideoCodecTypeHEVC : AVVideoCodecTypeH264,
        AVVideoWidthKey: @(width),
        AVVideoHeightKey: @(height),
        AVVideoCompressionPropertiesKey: compression,
    };
    _input = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo outputSettings:settings];
    _input.expectsMediaDataInRealTime = NO;
    NSDictionary *attributes = @{
        (id)kCVPixelBufferPixelFormatTypeKey: @(kCVPixelFormatType_32BGRA),
        (id)kCVPixelBufferWidthKey: @(width),
        (id)kCVPixelBufferHeightKey: @(height),
        (id)kCVPixelBufferMetalCompatibilityKey: @YES,
        (id)kCVPixelBufferIOSurfacePropertiesKey: @{},
    };
    _adaptor = [AVAssetWriterInputPixelBufferAdaptor assetWriterInputPixelBufferAdaptorWithAssetWriterInput:_input sourcePixelBufferAttributes:attributes];
    if (![_writer canAddInput:_input]) {
        if (error) *error = [NSError errorWithDomain:@"LunaAVBridge" code:-3 userInfo:@{NSLocalizedDescriptionKey: @"无法初始化视频编码"}];
        return nil;
    }
    [_writer addInput:_input];
    CVReturn result = CVMetalTextureCacheCreate(kCFAllocatorDefault, NULL, device, NULL, &_textureCache);
    if (result != kCVReturnSuccess) {
        if (error) *error = [NSError errorWithDomain:@"LunaAVBridge" code:result userInfo:@{NSLocalizedDescriptionKey: @"无法初始化 GPU 视频编码"}];
        return nil;
    }
    if (![_writer startWriting]) {
        if (error) *error = _writer.error;
        return nil;
    }
    [_writer startSessionAtSourceTime:kCMTimeZero];
    return self;
}

- (void)dealloc {
    if (_textureCache) CFRelease(_textureCache);
}
@end

void *luna_av_decoder_create(const char *path, void *metal_device, uint32_t max_decode_edge, char *error_buffer, size_t error_length) {
    @autoreleasepool {
        NSError *error = nil;
        LunaVideoDecoder *decoder = [[LunaVideoDecoder alloc] initWithPath:[NSString stringWithUTF8String:path] device:(__bridge id<MTLDevice>)metal_device maxEdge:max_decode_edge error:&error];
        if (!decoder) {
            luna_write_error(error_buffer, error_length, error, @"无法打开视频");
            return NULL;
        }
        return (__bridge_retained void *)decoder;
    }
}

void luna_av_decoder_destroy(void *decoder) {
    if (decoder) CFBridgingRelease(decoder);
}

int luna_av_decoder_get_rotation(void *decoder) {
    return [(__bridge LunaVideoDecoder *)decoder rotationDegrees];
}

bool luna_av_decoder_frame(void *decoder_ptr, double seconds, LunaAVFrame *out_frame, char *error_buffer, size_t error_length) {
    @autoreleasepool {
        NSError *error = nil;
        LunaMetalFrame *frame = [(__bridge LunaVideoDecoder *)decoder_ptr frameAt:seconds error:&error];
        if (!frame) {
            if (error) luna_write_error(error_buffer, error_length, error, @"视频解码失败");
            return false;
        }
        id<MTLTexture> texture = CVMetalTextureGetTexture(frame.metalTexture);
        out_frame->handle = (__bridge_retained void *)frame;
        out_frame->metal_texture = (__bridge void *)texture;
        out_frame->width = (uint32_t)CVPixelBufferGetWidth(frame.pixelBuffer);
        out_frame->height = (uint32_t)CVPixelBufferGetHeight(frame.pixelBuffer);
        out_frame->pts_seconds = frame.pts;
        return true;
    }
}

void *luna_av_writer_create(const char *path, void *metal_device, uint32_t width, uint32_t height, double fps, uint64_t bitrate, bool hevc, char *error_buffer, size_t error_length) {
    @autoreleasepool {
        NSError *error = nil;
        LunaVideoWriter *writer = [[LunaVideoWriter alloc] initWithPath:[NSString stringWithUTF8String:path] device:(__bridge id<MTLDevice>)metal_device width:width height:height fps:fps bitrate:(NSInteger)bitrate hevc:hevc error:&error];
        if (!writer) {
            luna_write_error(error_buffer, error_length, error, @"无法创建导出文件");
            return NULL;
        }
        return (__bridge_retained void *)writer;
    }
}

bool luna_av_writer_acquire_frame(void *writer_ptr, LunaAVFrame *out_frame, char *error_buffer, size_t error_length) {
    @autoreleasepool {
        LunaVideoWriter *writer = (__bridge LunaVideoWriter *)writer_ptr;
        CVPixelBufferPoolRef pool = writer.adaptor.pixelBufferPool;
        if (!pool) {
            luna_write_error(error_buffer, error_length, nil, @"编码器暂时无法提供画面缓冲区");
            return false;
        }
        CVPixelBufferRef pixelBuffer = NULL;
        CVReturn result = CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &pixelBuffer);
        if (result != kCVReturnSuccess || !pixelBuffer) {
            luna_write_error(error_buffer, error_length, nil, @"无法申请导出画面缓冲区");
            return false;
        }
        NSError *error = nil;
        LunaMetalFrame *frame = [[LunaMetalFrame alloc] initWithPixelBuffer:pixelBuffer textureCache:writer.textureCache pts:0 error:&error];
        CVPixelBufferRelease(pixelBuffer);
        if (!frame) {
            luna_write_error(error_buffer, error_length, error, @"无法创建导出画面纹理");
            return false;
        }
        id<MTLTexture> texture = CVMetalTextureGetTexture(frame.metalTexture);
        out_frame->handle = (__bridge_retained void *)frame;
        out_frame->metal_texture = (__bridge void *)texture;
        out_frame->width = (uint32_t)CVPixelBufferGetWidth(frame.pixelBuffer);
        out_frame->height = (uint32_t)CVPixelBufferGetHeight(frame.pixelBuffer);
        out_frame->pts_seconds = 0;
        return true;
    }
}

bool luna_av_writer_append_frame(void *writer_ptr, void *frame_ptr, uint64_t frame_index, char *error_buffer, size_t error_length) {
    @autoreleasepool {
        LunaVideoWriter *writer = (__bridge LunaVideoWriter *)writer_ptr;
        LunaMetalFrame *frame = (__bridge LunaMetalFrame *)frame_ptr;
        while (!writer.input.readyForMoreMediaData && writer.writer.status == AVAssetWriterStatusWriting) {
            [NSThread sleepForTimeInterval:0.001];
        }
        if (writer.writer.status != AVAssetWriterStatusWriting) {
            luna_write_error(error_buffer, error_length, writer.writer.error, @"视频编码已停止");
            return false;
        }
        CMTime time = CMTimeMakeWithSeconds((double)frame_index / writer.fps, 60000);
        if (![writer.adaptor appendPixelBuffer:frame.pixelBuffer withPresentationTime:time]) {
            luna_write_error(error_buffer, error_length, writer.writer.error, @"写入导出画面失败");
            return false;
        }
        return true;
    }
}

void luna_av_frame_destroy(void *frame) {
    if (frame) CFBridgingRelease(frame);
}

bool luna_av_writer_finish(void *writer_ptr, char *error_buffer, size_t error_length) {
    LunaVideoWriter *writer = (__bridge LunaVideoWriter *)writer_ptr;
    [writer.input markAsFinished];
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    [writer.writer finishWritingWithCompletionHandler:^{ dispatch_semaphore_signal(semaphore); }];
    dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);
    if (writer.writer.status != AVAssetWriterStatusCompleted) {
        luna_write_error(error_buffer, error_length, writer.writer.error, @"完成视频导出失败");
        return false;
    }
    return true;
}

void luna_av_writer_cancel(void *writer_ptr) {
    LunaVideoWriter *writer = (__bridge LunaVideoWriter *)writer_ptr;
    [writer.writer cancelWriting];
}

void luna_av_writer_destroy(void *writer) {
    if (writer) CFBridgingRelease(writer);
}
