use windows::core::{w, IUnknown, Interface};
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Direct3D12::{ID3D12CommandQueue, ID3D12Resource};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_ALPHA_MODE_IGNORE, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC,
};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory2, IDXGIFactory2, IDXGISwapChain1, IDXGISwapChain3, DXGI_CREATE_FACTORY_FLAGS,
    DXGI_SCALING_STRETCH, DXGI_SWAP_CHAIN_DESC1, DXGI_SWAP_EFFECT_FLIP_DISCARD,
    DXGI_USAGE_RENDER_TARGET_OUTPUT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, DispatchMessageW, PeekMessageW, SetWindowPos, ShowWindow,
    TranslateMessage, HWND_TOP, MSG, PM_REMOVE, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER,
    SWP_NOSIZE, SWP_SHOWWINDOW, SW_HIDE, WINDOW_EX_STYLE, WS_CHILD, WS_CLIPSIBLINGS, WS_DISABLED,
};

use crate::compositor::Compositor;

#[derive(Debug, Clone, Copy)]
pub(crate) struct PreviewBounds {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) scale_factor: f64,
}

pub(crate) struct PreviewSurface {
    hwnd: HWND,
    swap_chain: IDXGISwapChain3,
    pub(crate) width: u32,
    pub(crate) height: u32,
}

impl PreviewSurface {
    pub(crate) fn new(
        parent: HWND,
        queue: &ID3D12CommandQueue,
        bounds: PreviewBounds,
    ) -> Result<Self, String> {
        let (x, y, width, height) = pixel_bounds(bounds);
        let hwnd = unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE::default(),
                w!("STATIC"),
                w!(""),
                WS_CHILD | WS_CLIPSIBLINGS | WS_DISABLED,
                x,
                y,
                width as i32,
                height as i32,
                Some(parent),
                None,
                None,
                None,
            )
        }
        .map_err(|error| format!("无法创建 Windows 原生预览窗口: {error}"))?;
        let result = Self::create_swap_chain(hwnd, queue, width, height);
        match result {
            Ok(swap_chain) => Ok(Self {
                hwnd,
                swap_chain,
                width,
                height,
            }),
            Err(error) => {
                let _ = unsafe { DestroyWindow(hwnd) };
                Err(error)
            }
        }
    }

    fn create_swap_chain(
        hwnd: HWND,
        queue: &ID3D12CommandQueue,
        width: u32,
        height: u32,
    ) -> Result<IDXGISwapChain3, String> {
        let factory: IDXGIFactory2 =
            unsafe { CreateDXGIFactory2(DXGI_CREATE_FACTORY_FLAGS::default()) }
                .map_err(|error| format!("无法创建预览交换链工厂: {error}"))?;
        let desc = DXGI_SWAP_CHAIN_DESC1 {
            Width: width,
            Height: height,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            Stereo: false.into(),
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT,
            BufferCount: 2,
            Scaling: DXGI_SCALING_STRETCH,
            SwapEffect: DXGI_SWAP_EFFECT_FLIP_DISCARD,
            AlphaMode: DXGI_ALPHA_MODE_IGNORE,
            ..Default::default()
        };
        let device: IUnknown = queue
            .cast()
            .map_err(|error| format!("无法连接预览图形队列: {error}"))?;
        let chain: IDXGISwapChain1 =
            unsafe { factory.CreateSwapChainForHwnd(&device, hwnd, &desc, None, None) }
                .map_err(|error| format!("无法创建预览交换链: {error}"))?;
        chain
            .cast()
            .map_err(|error| format!("预览交换链版本不受支持: {error}"))
    }

    pub(crate) fn set_bounds(
        &mut self,
        compositor: &Compositor,
        bounds: PreviewBounds,
    ) -> Result<(), String> {
        let (x, y, width, height) = pixel_bounds(bounds);
        unsafe {
            SetWindowPos(
                self.hwnd,
                None,
                x,
                y,
                width as i32,
                height as i32,
                SWP_NOACTIVATE | SWP_NOOWNERZORDER,
            )
        }
        .map_err(|error| format!("无法调整原生预览区域: {error}"))?;
        if width != self.width || height != self.height {
            compositor.wait_for_gpu()?;
            unsafe {
                self.swap_chain.ResizeBuffers(
                    2,
                    width,
                    height,
                    DXGI_FORMAT_B8G8R8A8_UNORM,
                    Default::default(),
                )
            }
            .map_err(|error| format!("无法调整预览交换链: {error}"))?;
            self.width = width;
            self.height = height;
        }
        Ok(())
    }

    pub(crate) fn set_visible(&self, visible: bool) {
        if visible {
            // Chromium's render host is a sibling child window. Explicitly put the preview above
            // it so the first successful Present is visible even before any resize occurs.
            let _ = unsafe {
                SetWindowPos(
                    self.hwnd,
                    Some(HWND_TOP),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_SHOWWINDOW,
                )
            };
        } else {
            let _ = unsafe { ShowWindow(self.hwnd, SW_HIDE) };
        }
    }

    pub(crate) fn acquire(&self) -> Result<ID3D12Resource, String> {
        let index = unsafe { self.swap_chain.GetCurrentBackBufferIndex() };
        unsafe { self.swap_chain.GetBuffer(index) }
            .map_err(|error| format!("无法取得预览画面缓冲区: {error}"))
    }

    pub(crate) fn present(&self) -> Result<(), String> {
        unsafe { self.swap_chain.Present(1, Default::default()) }
            .ok()
            .map_err(|error| format!("无法显示原生预览画面: {error}"))
    }

    pub(crate) fn pump_messages(&self) {
        let mut message = MSG::default();
        while unsafe { PeekMessageW(&mut message, Some(self.hwnd), 0, 0, PM_REMOVE) }.as_bool() {
            let _ = unsafe { TranslateMessage(&message) };
            unsafe { DispatchMessageW(&message) };
        }
    }
}

impl Drop for PreviewSurface {
    fn drop(&mut self) {
        let _ = unsafe { DestroyWindow(self.hwnd) };
    }
}

fn pixel_bounds(bounds: PreviewBounds) -> (i32, i32, u32, u32) {
    // DOM bounds are expressed in CSS pixels (DIPs), while a child HWND owned by a
    // per-monitor-DPI-aware Electron window is positioned and sized in physical pixels.
    let scale = if bounds.scale_factor.is_finite() {
        bounds.scale_factor.clamp(0.5, 8.0)
    } else {
        1.0
    };
    (
        (bounds.x * scale).round() as i32,
        (bounds.y * scale).round() as i32,
        (bounds.width * scale).round().max(1.0) as u32,
        (bounds.height * scale).round().max(1.0) as u32,
    )
}

#[cfg(test)]
mod tests {
    use super::{pixel_bounds, PreviewBounds};

    #[test]
    fn scales_css_bounds_for_200_percent_windows_dpi() {
        assert_eq!(
            pixel_bounds(PreviewBounds {
                x: 120.0,
                y: 80.0,
                width: 640.0,
                height: 360.0,
                scale_factor: 2.0,
            }),
            (240, 160, 1280, 720),
        );
    }
}
