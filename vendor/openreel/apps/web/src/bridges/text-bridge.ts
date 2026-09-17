import {
  TitleEngine,
  TextAnimationEngine,
  type TextClip,
  type TextStyle,
  type TextAnimation,
  type TextAnimationPreset,
  type TextAnimationParams,
  type Transform,
  DEFAULT_TEXT_STYLE,
  DEFAULT_TEXT_TRANSFORM,
} from "@openreel/core";

/**
 * Result of text operations
 */
export interface TextOperationResult {
  success: boolean;
  clipId?: string;
  error?: string;
}

/**
 * Options for creating a text clip
 */
export interface CreateTextClipOptions {
  trackId: string;
  startTime: number;
  text: string;
  duration?: number;
  style?: Partial<TextStyle>;
  transform?: Partial<Transform>;
}

/**
 * Options for updating text clip style
 */
export interface UpdateTextStyleOptions {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: TextStyle["fontWeight"];
  fontStyle?: "normal" | "italic";
  color?: string;
  backgroundColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  textAlign?: TextStyle["textAlign"];
  verticalAlign?: TextStyle["verticalAlign"];
  lineHeight?: number;
  letterSpacing?: number;
  textDecoration?: TextStyle["textDecoration"];
}

/**
 * Options for text animation
 */
export interface TextAnimationOptions {
  preset: TextAnimationPreset;
  inDuration?: number;
  outDuration?: number;
  params?: Partial<TextAnimationParams>;
}

/**
 * TextBridge class for connecting UI to text functionality
 *
 * - 15.1: Create text layer with default styling
 * - 15.2: Update rendered text in real-time
 * - 15.3: Apply style changes immediately
 * - 15.4: Update text transform on canvas
 * - 16.1: Apply text animation presets
 * - 16.2: Update animation in/out timing
 */
export class TextBridge {
  private titleEngine: TitleEngine | null = null;
  private textAnimationEngine: TextAnimationEngine | null = null;
  private initialized = false;

  /**
   * Initialize the text bridge
   * Connects to TitleEngine and TextAnimationEngine
   */
  initialize(width: number = 1920, height: number = 1080): void {
    if (this.initialized) {
      return;
    }

    try {
      this.titleEngine = new TitleEngine();
      this.titleEngine.initialize(width, height);

      this.textAnimationEngine = new TextAnimationEngine();

      this.initialized = true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown initialization error";
      throw new Error(`TextBridge initialization failed: ${errorMessage}`);
    }
  }

  /**
   * Check if the bridge is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the TitleEngine instance
   */
  getTitleEngine(): TitleEngine | null {
    return this.titleEngine;
  }

  /**
   * Get the TextAnimationEngine instance
   */
  getTextAnimationEngine(): TextAnimationEngine | null {
    return this.textAnimationEngine;
  }

  // ============================================
  // Text Clip Creation Methods
  // ============================================

  /**
   * Create a new text clip
   *
   * Create text layer with default styling
   *
   * @param options - Options for creating the text clip
   * @returns The created text clip or null on failure
   */
  createTextClip(options: CreateTextClipOptions): TextClip | null {
    if (!this.initialized || !this.titleEngine) {
      console.error("TextBridge not initialized");
      return null;
    }

    try {
      const textClip = this.titleEngine.createTextClip({
        trackId: options.trackId,
        startTime: options.startTime,
        text: options.text,
        duration: options.duration ?? 5,
        style: options.style,
        transform: options.transform,
      });

      return textClip;
    } catch (error) {
      console.error("Failed to create text clip:", error);
      return null;
    }
  }

  /**
   * Get a text clip by ID
   *
   * @param clipId - The clip ID
   * @returns The text clip or undefined
   */
  getTextClip(clipId: string): TextClip | undefined {
    if (!this.initialized || !this.titleEngine) {
      return undefined;
    }

    return this.titleEngine.getTextClip(clipId);
  }

  /**
   * Get all text clips
   *
   * @returns Array of all text clips
   */
  getAllTextClips(): TextClip[] {
    if (!this.initialized || !this.titleEngine) {
      return [];
    }

    return this.titleEngine.getAllTextClips();
  }

  /**
   * Get text clips for a specific track
   *
   * @param trackId - The track ID
   * @returns Array of text clips on the track
   */
  getTextClipsForTrack(trackId: string): TextClip[] {
    if (!this.initialized || !this.titleEngine) {
      return [];
    }

    return this.titleEngine.getTextClipsForTrack(trackId);
  }

  /**
   * Delete a text clip
   *
   * @param clipId - The clip ID to delete
   * @returns Operation result
   */
  deleteTextClip(clipId: string): TextOperationResult {
    if (!this.initialized || !this.titleEngine) {
      return { success: false, error: "TextBridge not initialized" };
    }

    const deleted = this.titleEngine.deleteTextClip(clipId);
    return {
      success: deleted,
      clipId,
      error: deleted ? undefined : "Text clip not found",
    };
  }

  // ============================================
  // Text Content Update Methods
  // ============================================

  /**
   * Update text content in real-time
   *
   * Update rendered text in real-time
   *
   * @param clipId - The clip ID
   * @param text - New text content
   * @returns The updated text clip or null
   */
  updateTextContent(clipId: string, text: string): TextClip | null {
    if (!this.initialized || !this.titleEngine) {
      console.error("TextBridge not initialized");
      return null;
    }

    const updatedClip = this.titleEngine.updateText(clipId, text);
    return updatedClip || null;
  }

  // ============================================
  // Text Style Methods
  // ============================================

  /**
   * Update text style
   *
   * Apply style changes immediately
   *
   * @param clipId - The clip ID
   * @param style - Style updates to apply
   * @returns The updated text clip or null
   */
  updateTextStyle(
    clipId: string,
    style: UpdateTextStyleOptions,
  ): TextClip | null {
    if (!this.initialized || !this.titleEngine) {
      console.error("TextBridge not initialized");
      return null;
    }

    const updatedClip = this.titleEngine.updateStyle(clipId, style);
    return updatedClip || null;
  }

  /**
   * Reset text style to defaults
   *
   * @param clipId - The clip ID
   * @returns The updated text clip or null
   */
  resetTextStyle(clipId: string): TextClip | null {
    if (!this.initialized || !this.titleEngine) {
      console.error("TextBridge not initialized");
      return null;
    }

    const updatedClip = this.titleEngine.updateStyle(clipId, {
      ...DEFAULT_TEXT_STYLE,
    });
    return updatedClip || null;
  }

  // ============================================
  // Text Position/Transform Methods
  // ============================================

  /**
   * Update text position
   *
   * Update text transform on canvas
   *
   * @param clipId - The clip ID
   * @param position - New position (normalized 0-1)
   * @returns The updated text clip or null
   */
  updateTextPosition(
    clipId: string,
    position: { x: number; y: number },
  ): TextClip | null {
    if (!this.initialized || !this.titleEngine) {
      console.error("TextBridge not initialized");
      return null;
    }

    const updatedClip = this.titleEngine.updatePosition(clipId, position);
    return updatedClip || null;
  }

  /**
   * Update text transform
   *
   * Update text transform on canvas
   *
   * @param clipId - The clip ID
   * @param transform - Transform updates
   * @returns The updated text clip or null
   */
  updateTextTransform(
    clipId: string,
    transform: Partial<Transform>,
  ): TextClip | null {
    if (!this.initialized || !this.titleEngine) {
      console.error("TextBridge not initialized");
      return null;
    }

    const updatedClip = this.titleEngine.updateTextClip(clipId, { transform });
    return updatedClip || null;
  }

  /**
   * Reset text transform to defaults
   *
   * @param clipId - The clip ID
   * @returns The updated text clip or null
   */
  resetTextTransform(clipId: string): TextClip | null {
    if (!this.initialized || !this.titleEngine) {
      console.error("TextBridge not initialized");
      return null;
    }

    const updatedClip = this.titleEngine.updateTextClip(clipId, {
      transform: { ...DEFAULT_TEXT_TRANSFORM },
    });
    return updatedClip || null;
  }

  // ============================================
  // Text Animation Methods
  // ============================================

  /**
   * Apply text animation preset
   *
   * Apply text animation presets
   *
   * @param clipId - The clip ID
   * @param options - Animation options
   * @returns The updated text clip or null
   */
  applyTextAnimation(
    clipId: string,
    options: TextAnimationOptions,
  ): TextClip | null {
    if (!this.initialized || !this.titleEngine || !this.textAnimationEngine) {
      console.error("TextBridge not initialized");
      return null;
    }

    // Create animation configuration using TextAnimationEngine
    const animation = this.textAnimationEngine.createAnimationPreset(
      options.preset,
      options.inDuration ?? 0.5,
      options.outDuration ?? 0.5,
      options.params,
    );

    // Update the text clip with the animation
    const updatedClip = this.titleEngine.updateTextClip(clipId, { animation });
    return updatedClip || null;
  }

  /**
   * Update animation timing
   *
   * Update animation in/out timing
   *
   * @param clipId - The clip ID
   * @param inDuration - In animation duration
   * @param outDuration - Out animation duration
   * @returns The updated text clip or null
   */
  updateAnimationTiming(
    clipId: string,
    inDuration: number,
    outDuration: number,
  ): TextClip | null {
    if (!this.initialized || !this.titleEngine) {
      console.error("TextBridge not initialized");
      return null;
    }

    const clip = this.titleEngine.getTextClip(clipId);
    if (!clip || !clip.animation) {
      return null;
    }

    const updatedAnimation: TextAnimation = {
      ...clip.animation,
      inDuration,
      outDuration,
    };

    const updatedClip = this.titleEngine.updateTextClip(clipId, {
      animation: updatedAnimation,
    });
    return updatedClip || null;
  }

  /**
   * Update animation parameters
   *
   * @param clipId - The clip ID
   * @param params - Animation parameters to update
   * @returns The updated text clip or null
   */
  updateAnimationParams(
    clipId: string,
    params: Partial<TextAnimationParams>,
  ): TextClip | null {
    if (!this.initialized || !this.titleEngine) {
      console.error("TextBridge not initialized");
      return null;
    }

    const clip = this.titleEngine.getTextClip(clipId);
    if (!clip || !clip.animation) {
      return null;
    }

    const updatedAnimation: TextAnimation = {
      ...clip.animation,
      params: {
        ...clip.animation.params,
        ...params,
      },
    };

    const updatedClip = this.titleEngine.updateTextClip(clipId, {
      animation: updatedAnimation,
    });
    return updatedClip || null;
  }

  /**
   * Remove animation from text clip
   *
   * @param clipId - The clip ID
   * @returns The updated text clip or null
   */
  removeTextAnimation(clipId: string): TextClip | null {
    if (!this.initialized || !this.titleEngine || !this.textAnimationEngine) {
      console.error("TextBridge not initialized");
      return null;
    }

    // Set animation to "none" preset
    const animation = this.textAnimationEngine.createAnimationPreset(
      "none",
      0,
      0,
    );

    const updatedClip = this.titleEngine.updateTextClip(clipId, { animation });
    return updatedClip || null;
  }

  /**
   * Get available animation presets
   *
   * @returns Array of available preset names
   */
  getAvailableAnimationPresets(): TextAnimationPreset[] {
    if (!this.textAnimationEngine) {
      return [];
    }

    return this.textAnimationEngine.getAvailablePresets();
  }

  /**
   * Get animated state at a specific time
   *
   * @param clipId - The clip ID
   * @param time - Time relative to clip start
   * @returns The animated state or null
   */
  getAnimatedState(clipId: string, time: number) {
    if (!this.initialized || !this.titleEngine || !this.textAnimationEngine) {
      return null;
    }

    const clip = this.titleEngine.getTextClip(clipId);
    if (!clip) {
      return null;
    }

    return this.textAnimationEngine.getAnimatedState(clip, time);
  }

  // ============================================
  // Text Rendering Methods
  // ============================================

  /**
   * Render text to canvas
   *
   * @param clipId - The clip ID
   * @param width - Canvas width
   * @param height - Canvas height
   * @param time - Current time for animations
   * @returns Render result or null
   */
  renderText(clipId: string, width: number, height: number, time: number = 0) {
    if (!this.initialized || !this.titleEngine) {
      return null;
    }

    const clip = this.titleEngine.getTextClip(clipId);
    if (!clip) {
      return null;
    }

    return this.titleEngine.renderText(clip, width, height, time);
  }

  /**
   * Measure text dimensions
   *
   * @param text - Text to measure
   * @param style - Text style
   * @param maxWidth - Maximum width for wrapping
   * @returns Text metrics
   */
  measureText(text: string, style: TextStyle, maxWidth?: number) {
    if (!this.initialized || !this.titleEngine) {
      return null;
    }

    return this.titleEngine.measureText(text, style, maxWidth);
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Clear all text clips
   */
  clear(): void {
    if (this.titleEngine) {
      this.titleEngine.clear();
    }
  }

  /**
   * Load text clips from an array
   *
   * @param clips - Array of text clips to load
   */
  loadTextClips(clips: TextClip[]): void {
    if (this.titleEngine) {
      this.titleEngine.loadTextClips(clips);
    }
  }

  /**
   * Export all text clips as an array
   *
   * @returns Array of text clips
   */
  exportTextClips(): TextClip[] {
    if (!this.titleEngine) {
      return [];
    }

    return this.titleEngine.exportTextClips();
  }

  /**
   * Dispose of the text bridge and clean up resources
   */
  dispose(): void {
    this.titleEngine = null;
    this.textAnimationEngine = null;
    this.initialized = false;
  }
}

// Singleton instance
let textBridgeInstance: TextBridge | null = null;

/**
 * Get the shared TextBridge instance
 */
export function getTextBridge(): TextBridge {
  if (!textBridgeInstance) {
    textBridgeInstance = new TextBridge();
  }
  return textBridgeInstance;
}

/**
 * Initialize the shared TextBridge
 */
export function initializeTextBridge(
  width: number = 1920,
  height: number = 1080,
): TextBridge {
  const bridge = getTextBridge();
  bridge.initialize(width, height);
  return bridge;
}

/**
 * Dispose of the shared TextBridge
 */
export function disposeTextBridge(): void {
  if (textBridgeInstance) {
    textBridgeInstance.dispose();
    textBridgeInstance = null;
  }
}
