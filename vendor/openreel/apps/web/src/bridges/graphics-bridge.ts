import {
  GraphicsEngine,
  StickerLibrary,
  type ShapeClip,
  type SVGClip,
  type StickerClip,
  type ShapeStyle,
  type ShapeType,
  type FillStyle,
  type StrokeStyle,
  type ShadowStyle,
  type Transform,
  type StickerItem,
  type EmojiItem,
  DEFAULT_SHAPE_STYLE,
} from "@openreel/core";

export interface GraphicsOperationResult {
  success: boolean;
  clipId?: string;
  error?: string;
}

export interface CreateShapeOptions {
  trackId: string;
  startTime: number;
  shapeType: ShapeType;
  width?: number;
  height?: number;
  duration?: number;
  style?: Partial<ShapeStyle>;
  transform?: Partial<Transform>;
}

/**
 * Options for updating shape style
 */
export interface UpdateShapeStyleOptions {
  fill?: Partial<FillStyle>;
  stroke?: Partial<StrokeStyle>;
  shadow?: Partial<ShadowStyle>;
  cornerRadius?: number;
  points?: number;
  innerRadius?: number;
}

/**
 * Options for importing SVG
 */
export interface ImportSVGOptions {
  trackId: string;
  startTime: number;
  svgContent: string;
  duration?: number;
  transform?: Partial<Transform>;
}

/**
 * Options for adding a sticker
 */
export interface AddStickerOptions {
  trackId: string;
  startTime: number;
  stickerId: string;
  duration?: number;
  transform?: Partial<Transform>;
}

/**
 * Options for adding an emoji
 */
export interface AddEmojiOptions {
  trackId: string;
  startTime: number;
  emoji: string;
  duration?: number;
  transform?: Partial<Transform>;
}

/**
 * GraphicsBridge class for connecting UI to graphics functionality
 *
 * - 17.1: Create shapes (rectangle, circle, ellipse, triangle, arrow, star, polygon)
 * - 17.2: Update shape style (fill, stroke, corner radius, shadow)
 * - 17.3: Import and render SVG content
 * - 17.4: Add stickers and emojis from library
 */
export class GraphicsBridge {
  private graphicsEngine: GraphicsEngine | null = null;
  private stickerLibrary: StickerLibrary | null = null;
  private initialized = false;

  // Store clips locally for management
  private shapeClips: Map<string, ShapeClip> = new Map();
  private svgClips: Map<string, SVGClip> = new Map();
  private stickerClips: Map<string, StickerClip> = new Map();

  /**
   * Initialize the graphics bridge
   * Connects to GraphicsEngine and StickerLibrary
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    try {
      this.graphicsEngine = new GraphicsEngine();
      this.stickerLibrary = new StickerLibrary();
      this.initialized = true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown initialization error";
      throw new Error(`GraphicsBridge initialization failed: ${errorMessage}`);
    }
  }

  /**
   * Check if the bridge is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the GraphicsEngine instance
   */
  getGraphicsEngine(): GraphicsEngine | null {
    return this.graphicsEngine;
  }

  /**
   * Get the StickerLibrary instance
   */
  getStickerLibrary(): StickerLibrary | null {
    return this.stickerLibrary;
  }

  // ============================================
  // Shape Creation Methods
  // ============================================

  /**
   * Create a new shape clip
   *
   * Create shapes
   *
   * @param options - Options for creating the shape clip
   * @returns The created shape clip or null on failure
   */
  createShape(options: CreateShapeOptions): ShapeClip | null {
    if (!this.initialized || !this.graphicsEngine) {
      console.error("GraphicsBridge not initialized");
      return null;
    }

    try {
      const shapeClip = this.graphicsEngine.createShape(
        {
          shapeType: options.shapeType,
          width: options.width ?? 200,
          height: options.height ?? 200,
          style: options.style,
        },
        options.trackId,
        options.startTime,
        options.duration ?? 5,
      );

      // Apply custom transform if provided
      if (options.transform) {
        const updatedClip = this.graphicsEngine.updateTransform(
          shapeClip,
          options.transform,
        ) as ShapeClip;
        this.shapeClips.set(updatedClip.id, updatedClip);
        return updatedClip;
      }

      this.shapeClips.set(shapeClip.id, shapeClip);
      return shapeClip;
    } catch (error) {
      console.error("Failed to create shape:", error);
      return null;
    }
  }

  /**
   * Create a rectangle shape
   */
  createRectangle(
    trackId: string,
    startTime: number,
    width: number,
    height: number,
    style?: Partial<ShapeStyle>,
    duration?: number,
  ): ShapeClip | null {
    return this.createShape({
      trackId,
      startTime,
      shapeType: "rectangle",
      width,
      height,
      style,
      duration,
    });
  }

  /**
   * Create a circle shape
   */
  createCircle(
    trackId: string,
    startTime: number,
    radius: number,
    style?: Partial<ShapeStyle>,
    duration?: number,
  ): ShapeClip | null {
    return this.createShape({
      trackId,
      startTime,
      shapeType: "circle",
      width: radius * 2,
      height: radius * 2,
      style,
      duration,
    });
  }

  /**
   * Create a triangle shape
   */
  createTriangle(
    trackId: string,
    startTime: number,
    width: number,
    height: number,
    style?: Partial<ShapeStyle>,
    duration?: number,
  ): ShapeClip | null {
    return this.createShape({
      trackId,
      startTime,
      shapeType: "triangle",
      width,
      height,
      style,
      duration,
    });
  }

  /**
   * Create a star shape
   */
  createStar(
    trackId: string,
    startTime: number,
    size: number,
    points: number = 5,
    innerRadius: number = 0.5,
    style?: Partial<ShapeStyle>,
    duration?: number,
  ): ShapeClip | null {
    return this.createShape({
      trackId,
      startTime,
      shapeType: "star",
      width: size,
      height: size,
      style: { ...style, points, innerRadius },
      duration,
    });
  }

  /**
   * Create an arrow shape
   */
  createArrow(
    trackId: string,
    startTime: number,
    width: number,
    height: number,
    style?: Partial<ShapeStyle>,
    duration?: number,
  ): ShapeClip | null {
    return this.createShape({
      trackId,
      startTime,
      shapeType: "arrow",
      width,
      height,
      style,
      duration,
    });
  }

  // ============================================
  // Shape Style Methods
  // ============================================

  /**
   * Update shape style
   *
   * Update fill color, stroke, corner radius, shadow
   *
   * @param clipId - The clip ID
   * @param style - Style updates to apply
   * @returns The updated shape clip or null
   */
  updateShapeStyle(
    clipId: string,
    style: UpdateShapeStyleOptions,
  ): ShapeClip | null {
    if (!this.initialized || !this.graphicsEngine) {
      console.error("GraphicsBridge not initialized");
      return null;
    }

    const clip = this.shapeClips.get(clipId);
    if (!clip) {
      console.error("Shape clip not found:", clipId);
      return null;
    }

    try {
      // Build style update object - use type assertion to handle readonly properties
      const styleUpdate = {} as {
        fill?: FillStyle;
        stroke?: StrokeStyle;
        shadow?: ShadowStyle;
        cornerRadius?: number;
        points?: number;
        innerRadius?: number;
      };

      if (style.fill) {
        styleUpdate.fill = { ...clip.style.fill, ...style.fill } as FillStyle;
      }
      if (style.stroke) {
        styleUpdate.stroke = {
          ...clip.style.stroke,
          ...style.stroke,
        } as StrokeStyle;
      }
      if (style.shadow) {
        styleUpdate.shadow = {
          ...clip.style.shadow,
          ...style.shadow,
        } as ShadowStyle;
      }
      if (style.cornerRadius !== undefined) {
        styleUpdate.cornerRadius = style.cornerRadius;
      }
      if (style.points !== undefined) {
        styleUpdate.points = style.points;
      }
      if (style.innerRadius !== undefined) {
        styleUpdate.innerRadius = style.innerRadius;
      }

      const updatedClip = this.graphicsEngine.updateShapeStyle(
        clip,
        styleUpdate as Partial<ShapeStyle>,
      );
      this.shapeClips.set(updatedClip.id, updatedClip);
      return updatedClip;
    } catch (error) {
      console.error("Failed to update shape style:", error);
      return null;
    }
  }

  /**
   * Update shape fill
   */
  updateFill(clipId: string, fill: Partial<FillStyle>): ShapeClip | null {
    return this.updateShapeStyle(clipId, { fill });
  }

  /**
   * Update shape stroke
   */
  updateStroke(clipId: string, stroke: Partial<StrokeStyle>): ShapeClip | null {
    return this.updateShapeStyle(clipId, { stroke });
  }

  /**
   * Update shape shadow
   */
  updateShadow(clipId: string, shadow: Partial<ShadowStyle>): ShapeClip | null {
    return this.updateShapeStyle(clipId, { shadow });
  }

  /**
   * Update corner radius (for rectangles)
   */
  updateCornerRadius(clipId: string, cornerRadius: number): ShapeClip | null {
    return this.updateShapeStyle(clipId, { cornerRadius });
  }

  /**
   * Reset shape style to defaults
   */
  resetShapeStyle(clipId: string): ShapeClip | null {
    if (!this.initialized || !this.graphicsEngine) {
      console.error("GraphicsBridge not initialized");
      return null;
    }

    const clip = this.shapeClips.get(clipId);
    if (!clip) {
      return null;
    }

    const updatedClip = this.graphicsEngine.updateShapeStyle(
      clip,
      DEFAULT_SHAPE_STYLE,
    );
    this.shapeClips.set(updatedClip.id, updatedClip);
    return updatedClip;
  }

  // ============================================
  // Shape Transform Methods
  // ============================================

  /**
   * Update shape transform
   */
  updateShapeTransform(
    clipId: string,
    transform: Partial<Transform>,
  ): ShapeClip | null {
    if (!this.initialized || !this.graphicsEngine) {
      console.error("GraphicsBridge not initialized");
      return null;
    }

    const clip = this.shapeClips.get(clipId);
    if (!clip) {
      return null;
    }

    const updatedClip = this.graphicsEngine.updateTransform(
      clip,
      transform,
    ) as ShapeClip;
    this.shapeClips.set(updatedClip.id, updatedClip);
    return updatedClip;
  }

  // ============================================
  // SVG Import Methods
  // ============================================

  /**
   * Import SVG content
   *
   * Parse and render SVG content
   *
   * @param options - Options for importing SVG
   * @returns The created SVG clip or null on failure
   */
  importSVG(options: ImportSVGOptions): SVGClip | null {
    if (!this.initialized || !this.graphicsEngine) {
      console.error("GraphicsBridge not initialized");
      return null;
    }

    try {
      const svgClip = this.graphicsEngine.importSVG(
        options.svgContent,
        options.trackId,
        options.startTime,
        options.duration ?? 5,
      );

      // Apply custom transform if provided
      if (options.transform) {
        const updatedClip = this.graphicsEngine.updateTransform(
          svgClip,
          options.transform,
        ) as SVGClip;
        this.svgClips.set(updatedClip.id, updatedClip);
        return updatedClip;
      }

      this.svgClips.set(svgClip.id, svgClip);
      return svgClip;
    } catch (error) {
      console.error("Failed to import SVG:", error);
      return null;
    }
  }

  /**
   * Validate SVG content
   *
   * @param svgContent - SVG content to validate
   * @returns Validation result
   */
  validateSVG(svgContent: string): { valid: boolean; error?: string } {
    if (!this.initialized || !this.graphicsEngine) {
      return { valid: false, error: "GraphicsBridge not initialized" };
    }

    try {
      this.graphicsEngine.parseSVG(svgContent);
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Invalid SVG content",
      };
    }
  }

  /**
   * Update SVG transform
   */
  updateSVGTransform(
    clipId: string,
    transform: Partial<Transform>,
  ): SVGClip | null {
    if (!this.initialized || !this.graphicsEngine) {
      console.error("GraphicsBridge not initialized");
      return null;
    }

    const clip = this.svgClips.get(clipId);
    if (!clip) {
      return null;
    }

    const updatedClip = this.graphicsEngine.updateTransform(
      clip,
      transform,
    ) as SVGClip;
    this.svgClips.set(updatedClip.id, updatedClip);
    return updatedClip;
  }

  // ============================================
  // Sticker Methods
  // ============================================

  /**
   * Add a sticker from the library
   *
   * Add stickers from library
   *
   * @param options - Options for adding sticker
   * @returns The created sticker clip or null on failure
   */
  addSticker(options: AddStickerOptions): StickerClip | null {
    if (!this.initialized || !this.stickerLibrary) {
      console.error("GraphicsBridge not initialized");
      return null;
    }

    try {
      const sticker = this.stickerLibrary.getSticker(options.stickerId);
      if (!sticker) {
        console.error("Sticker not found:", options.stickerId);
        return null;
      }

      const stickerClip = this.stickerLibrary.createStickerClip(
        sticker,
        options.trackId,
        options.startTime,
        options.duration ?? 5,
      );

      // Apply custom transform if provided
      if (options.transform && this.graphicsEngine) {
        const updatedClip = this.graphicsEngine.updateTransform(
          stickerClip,
          options.transform,
        ) as StickerClip;
        this.stickerClips.set(updatedClip.id, updatedClip);
        return updatedClip;
      }

      this.stickerClips.set(stickerClip.id, stickerClip);
      return stickerClip;
    } catch (error) {
      console.error("Failed to add sticker:", error);
      return null;
    }
  }

  /**
   * Add an emoji
   *
   * Add emojis
   *
   * @param options - Options for adding emoji
   * @returns The created emoji clip or null on failure
   */
  addEmoji(options: AddEmojiOptions): StickerClip | null {
    if (!this.initialized || !this.stickerLibrary) {
      console.error("GraphicsBridge not initialized");
      return null;
    }

    try {
      // Find emoji by character or ID
      const allEmojis = this.stickerLibrary.getAllEmojis();
      const emoji = allEmojis.find(
        (e) => e.emoji === options.emoji || e.id === options.emoji,
      );

      if (!emoji) {
        // Create a custom emoji item if not found in library
        const customEmoji: EmojiItem = {
          id: `custom_${Date.now()}`,
          emoji: options.emoji,
          name: options.emoji,
          category: "custom",
        };

        const emojiClip = this.stickerLibrary.createEmojiClip(
          customEmoji,
          options.trackId,
          options.startTime,
          options.duration ?? 5,
        );

        this.stickerClips.set(emojiClip.id, emojiClip);
        return emojiClip;
      }

      const emojiClip = this.stickerLibrary.createEmojiClip(
        emoji,
        options.trackId,
        options.startTime,
        options.duration ?? 5,
      );

      // Apply custom transform if provided
      if (options.transform && this.graphicsEngine) {
        const updatedClip = this.graphicsEngine.updateTransform(
          emojiClip,
          options.transform,
        ) as StickerClip;
        this.stickerClips.set(updatedClip.id, updatedClip);
        return updatedClip;
      }

      this.stickerClips.set(emojiClip.id, emojiClip);
      return emojiClip;
    } catch (error) {
      console.error("Failed to add emoji:", error);
      return null;
    }
  }

  /**
   * Update sticker/emoji transform
   */
  updateStickerTransform(
    clipId: string,
    transform: Partial<Transform>,
  ): StickerClip | null {
    if (!this.initialized || !this.graphicsEngine) {
      console.error("GraphicsBridge not initialized");
      return null;
    }

    const clip = this.stickerClips.get(clipId);
    if (!clip) {
      return null;
    }

    const updatedClip = this.graphicsEngine.updateTransform(
      clip,
      transform,
    ) as StickerClip;
    this.stickerClips.set(updatedClip.id, updatedClip);
    return updatedClip;
  }

  // ============================================
  // Library Access Methods
  // ============================================

  /**
   * Get all sticker categories
   */
  getStickerCategories() {
    if (!this.stickerLibrary) {
      return [];
    }
    return this.stickerLibrary.getCategories();
  }

  /**
   * Get stickers by category
   */
  getStickersByCategory(categoryId: string): StickerItem[] {
    if (!this.stickerLibrary) {
      return [];
    }
    return this.stickerLibrary.getStickersByCategory(categoryId);
  }

  /**
   * Search stickers
   */
  searchStickers(query: string): StickerItem[] {
    if (!this.stickerLibrary) {
      return [];
    }
    return this.stickerLibrary.searchStickers(query);
  }

  /**
   * Get all emoji categories
   */
  getEmojiCategories() {
    if (!this.stickerLibrary) {
      return [];
    }
    return this.stickerLibrary.getEmojiCategories();
  }

  /**
   * Get emojis by category
   */
  getEmojisByCategory(categoryId: string): EmojiItem[] {
    if (!this.stickerLibrary) {
      return [];
    }
    return this.stickerLibrary.getEmojisByCategory(categoryId);
  }

  /**
   * Search emojis
   */
  searchEmojis(query: string): EmojiItem[] {
    if (!this.stickerLibrary) {
      return [];
    }
    return this.stickerLibrary.searchEmojis(query);
  }

  /**
   * Import a custom sticker
   */
  async importCustomSticker(
    file: File,
    name: string,
    tags?: string[],
  ): Promise<StickerItem | null> {
    if (!this.stickerLibrary) {
      return null;
    }

    try {
      return await this.stickerLibrary.importSticker(
        file,
        name,
        "custom",
        tags,
      );
    } catch (error) {
      console.error("Failed to import custom sticker:", error);
      return null;
    }
  }

  // ============================================
  // Clip Management Methods
  // ============================================

  /**
   * Get a shape clip by ID
   */
  getShapeClip(clipId: string): ShapeClip | undefined {
    return this.shapeClips.get(clipId);
  }

  /**
   * Get an SVG clip by ID
   */
  getSVGClip(clipId: string): SVGClip | undefined {
    return this.svgClips.get(clipId);
  }

  /**
   * Get a sticker clip by ID
   */
  getStickerClip(clipId: string): StickerClip | undefined {
    return this.stickerClips.get(clipId);
  }

  /**
   * Get all shape clips
   */
  getAllShapeClips(): ShapeClip[] {
    return Array.from(this.shapeClips.values());
  }

  /**
   * Get all SVG clips
   */
  getAllSVGClips(): SVGClip[] {
    return Array.from(this.svgClips.values());
  }

  /**
   * Get all sticker clips
   */
  getAllStickerClips(): StickerClip[] {
    return Array.from(this.stickerClips.values());
  }

  /**
   * Delete a shape clip
   */
  deleteShapeClip(clipId: string): boolean {
    return this.shapeClips.delete(clipId);
  }

  /**
   * Delete an SVG clip
   */
  deleteSVGClip(clipId: string): boolean {
    return this.svgClips.delete(clipId);
  }

  /**
   * Delete a sticker clip
   */
  deleteStickerClip(clipId: string): boolean {
    return this.stickerClips.delete(clipId);
  }

  // ============================================
  // Rendering Methods
  // ============================================

  /**
   * Render a shape clip
   */
  async renderShape(
    clipId: string,
    time: number,
    width: number,
    height: number,
  ) {
    if (!this.initialized || !this.graphicsEngine) {
      return null;
    }

    const clip = this.shapeClips.get(clipId);
    if (!clip) {
      return null;
    }

    return this.graphicsEngine.renderGraphic(clip, time, width, height);
  }

  /**
   * Render an SVG clip
   */
  async renderSVG(clipId: string, time: number, width: number, height: number) {
    if (!this.initialized || !this.graphicsEngine) {
      return null;
    }

    const clip = this.svgClips.get(clipId);
    if (!clip) {
      return null;
    }

    return this.graphicsEngine.renderGraphic(clip, time, width, height);
  }

  /**
   * Render a sticker clip
   */
  async renderSticker(
    clipId: string,
    time: number,
    width: number,
    height: number,
  ) {
    if (!this.initialized || !this.graphicsEngine) {
      return null;
    }

    const clip = this.stickerClips.get(clipId);
    if (!clip) {
      return null;
    }

    return this.graphicsEngine.renderGraphic(clip, time, width, height);
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Clear all clips
   */
  clear(): void {
    this.shapeClips.clear();
    this.svgClips.clear();
    this.stickerClips.clear();

    if (this.graphicsEngine) {
      this.graphicsEngine.clearCache();
    }
  }

  /**
   * Dispose of the graphics bridge and clean up resources
   */
  dispose(): void {
    this.clear();

    if (this.graphicsEngine) {
      this.graphicsEngine.clearCache();
    }

    this.graphicsEngine = null;
    this.stickerLibrary = null;
    this.initialized = false;
  }
}

// Singleton instance
let graphicsBridgeInstance: GraphicsBridge | null = null;

/**
 * Get the shared GraphicsBridge instance
 */
export function getGraphicsBridge(): GraphicsBridge {
  if (!graphicsBridgeInstance) {
    graphicsBridgeInstance = new GraphicsBridge();
  }
  return graphicsBridgeInstance;
}

/**
 * Initialize the shared GraphicsBridge
 */
export function initializeGraphicsBridge(): GraphicsBridge {
  const bridge = getGraphicsBridge();
  bridge.initialize();
  return bridge;
}

/**
 * Dispose of the shared GraphicsBridge
 */
export function disposeGraphicsBridge(): void {
  if (graphicsBridgeInstance) {
    graphicsBridgeInstance.dispose();
    graphicsBridgeInstance = null;
  }
}
