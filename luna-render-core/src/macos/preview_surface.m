#import <AppKit/AppKit.h>
#import <Metal/Metal.h>
#import <QuartzCore/CAMetalLayer.h>

typedef struct {
    void *handle;
    void *metal_texture;
    uint32_t width;
    uint32_t height;
} LunaPreviewDrawable;

@interface LunaPreviewSurface : NSObject
@property(nonatomic, strong) NSView *view;
@property(nonatomic, strong) CAMetalLayer *metalLayer;
@property(nonatomic, weak) NSView *parent;
@end

@implementation LunaPreviewSurface
@end

@interface LunaPreviewDrawableHolder : NSObject
@property(nonatomic, strong) id<CAMetalDrawable> drawable;
@end

@implementation LunaPreviewDrawableHolder
@end

@interface LunaPreviewView : NSView
@end

@implementation LunaPreviewView
- (NSView *)hitTest:(NSPoint)point {
    (void)point;
    return nil;
}
@end

static void luna_preview_on_main_sync(dispatch_block_t block) {
    if ([NSThread isMainThread]) {
        block();
    } else {
        dispatch_sync(dispatch_get_main_queue(), block);
    }
}

void *luna_preview_surface_create(void *parent_view, void *metal_device) {
    if (parent_view == NULL || metal_device == NULL) return NULL;
    __block LunaPreviewSurface *surface = nil;
    luna_preview_on_main_sync(^{
        NSView *parent = (__bridge NSView *)parent_view;
        id<MTLDevice> device = (__bridge id<MTLDevice>)metal_device;
        NSView *view = [[LunaPreviewView alloc] initWithFrame:NSZeroRect];
        view.wantsLayer = YES;
        CAMetalLayer *layer = [CAMetalLayer layer];
        layer.device = device;
        layer.pixelFormat = MTLPixelFormatBGRA8Unorm_sRGB;
        layer.framebufferOnly = NO;
        layer.opaque = YES;
        layer.backgroundColor = NSColor.blackColor.CGColor;
        layer.contentsScale = parent.window.backingScaleFactor ?: NSScreen.mainScreen.backingScaleFactor;
        view.layer = layer;
        view.hidden = YES;
        [parent addSubview:view positioned:NSWindowAbove relativeTo:nil];

        surface = [LunaPreviewSurface new];
        surface.view = view;
        surface.metalLayer = layer;
        surface.parent = parent;
    });
    return surface ? (__bridge_retained void *)surface : NULL;
}

void luna_preview_surface_set_bounds(
    void *surface_ptr,
    double x,
    double y,
    double width,
    double height,
    double scale_factor
) {
    if (surface_ptr == NULL) return;
    LunaPreviewSurface *surface = (__bridge LunaPreviewSurface *)surface_ptr;
    luna_preview_on_main_sync(^{
        NSView *parent = surface.parent;
        if (!parent) return;
        CGFloat safeWidth = MAX(1.0, width);
        CGFloat safeHeight = MAX(1.0, height);
        CGFloat flippedY = NSHeight(parent.bounds) - y - safeHeight;
        surface.view.frame = NSMakeRect(x, flippedY, safeWidth, safeHeight);
        CGFloat scale = scale_factor > 0.0
            ? scale_factor
            : (parent.window.backingScaleFactor ?: 1.0);
        surface.metalLayer.contentsScale = scale;
        surface.metalLayer.drawableSize = CGSizeMake(
            MAX(1.0, round(safeWidth * scale)),
            MAX(1.0, round(safeHeight * scale))
        );
    });
}

void luna_preview_surface_set_visible(void *surface_ptr, bool visible) {
    if (surface_ptr == NULL) return;
    LunaPreviewSurface *surface = (__bridge LunaPreviewSurface *)surface_ptr;
    luna_preview_on_main_sync(^{
        surface.view.hidden = !visible;
    });
}

bool luna_preview_surface_acquire(void *surface_ptr, LunaPreviewDrawable *output) {
    if (surface_ptr == NULL || output == NULL) return false;
    LunaPreviewSurface *surface = (__bridge LunaPreviewSurface *)surface_ptr;
    id<CAMetalDrawable> drawable = [surface.metalLayer nextDrawable];
    if (!drawable) return false;
    LunaPreviewDrawableHolder *holder = [LunaPreviewDrawableHolder new];
    holder.drawable = drawable;
    output->handle = (__bridge_retained void *)holder;
    output->metal_texture = (__bridge void *)drawable.texture;
    output->width = (uint32_t)drawable.texture.width;
    output->height = (uint32_t)drawable.texture.height;
    return true;
}

void luna_preview_drawable_present(void *drawable_ptr) {
    if (drawable_ptr == NULL) return;
    LunaPreviewDrawableHolder *holder = (__bridge_transfer LunaPreviewDrawableHolder *)drawable_ptr;
    [holder.drawable present];
}

void luna_preview_drawable_discard(void *drawable_ptr) {
    if (drawable_ptr == NULL) return;
    __unused LunaPreviewDrawableHolder *holder =
        (__bridge_transfer LunaPreviewDrawableHolder *)drawable_ptr;
}

void luna_preview_surface_destroy(void *surface_ptr) {
    if (surface_ptr == NULL) return;
    LunaPreviewSurface *surface = (__bridge_transfer LunaPreviewSurface *)surface_ptr;
    luna_preview_on_main_sync(^{
        [surface.view removeFromSuperview];
        surface.view = nil;
        surface.metalLayer = nil;
    });
}
