import {
  PhotoEngine,
  getPhotoEngine,
  RetouchingEngine,
  getRetouchingEngine,
  type PhotoProject,
  type PhotoLayer,
  type PhotoBlendMode,
  type LayerTransform,
  type CreateLayerOptions,
  type BrushStroke,
  type BrushPoint,
  type CloneSource,
} from "@openreel/core";

/**
 * Result of photo operations
 */
export interface PhotoOperationResult {
  success: boolean;
  projectId?: string;
  layerId?: string;
  error?: string;
}

/**
 * Options for creating a new layer
 */
export interface AddLayerOptions {
  name?: string;
  type?: "image" | "adjustment" | "text" | "shape" | "smart";
  content?: ImageBitmap;
  opacity?: number;
  blendMode?: PhotoBlendMode;
  insertAt?: number;
}

/**
 * Options for retouching operations
 */
export interface RetouchingOptions {
  brushSize?: number;
  brushHardness?: number;
  brushOpacity?: number;
}

/**
 * Brush configuration for retouching tools
 */
export interface BrushConfig {
  size: number;
  hardness: number;
  opacity: number;
  flow: number;
  spacing: number;
}

/**
 * PhotoBridge class for connecting UI to photo editing functionality
 *
 * - 18.1: Create base layer with image content when importing photo
 * - 18.2: Insert new layers above current layer
 * - 18.3: Update composite order when layers are reordered
 * - 18.4: Blend layers at specified alpha
 * - 18.5: Include or exclude layers from composite based on visibility
 * - 19.1: Spot healing samples surrounding pixels and blends
 * - 19.2: Clone stamp copies pixels from source to target
 * - 19.3: Red-eye removal detects and desaturates red pixels
 */
export class PhotoBridge {
  private photoEngine: PhotoEngine | null = null;
  private retouchingEngine: RetouchingEngine | null = null;
  private initialized = false;

  // Store projects locally for management
  private projects: Map<string, PhotoProject> = new Map();
  private activeProjectId: string | null = null;

  /**
   * Initialize the photo bridge
   * Connects to PhotoEngine and RetouchingEngine
   */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    try {
      this.photoEngine = getPhotoEngine();
      this.retouchingEngine = getRetouchingEngine();
      this.initialized = true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown initialization error";
      throw new Error(`PhotoBridge initialization failed: ${errorMessage}`);
    }
  }

  /**
   * Check if the bridge is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the PhotoEngine instance
   */
  getPhotoEngine(): PhotoEngine | null {
    return this.photoEngine;
  }

  /**
   * Get the RetouchingEngine instance
   */
  getRetouchingEngine(): RetouchingEngine | null {
    return this.retouchingEngine;
  }

  // ============================================
  // Project Management Methods
  // ============================================

  /**
   * Create a new photo project
   *
   * @param width - Canvas width
   * @param height - Canvas height
   * @param name - Project name
   * @returns The created project
   */
  createProject(
    width: number = 1920,
    height: number = 1080,
    name: string = "Untitled",
  ): PhotoProject | null {
    if (!this.initialized || !this.photoEngine) {
      console.error("PhotoBridge not initialized");
      return null;
    }

    try {
      const project = this.photoEngine.createProject(width, height, name);
      this.projects.set(project.id, project);
      this.activeProjectId = project.id;
      return project;
    } catch (error) {
      console.error("Failed to create project:", error);
      return null;
    }
  }

  /**
   * Import a photo and create a base layer
   *
   * Create base layer with image content
   *
   * @param image - Image to import
   * @param name - Layer name
   * @returns The updated project
   */
  importPhoto(
    image: ImageBitmap,
    name: string = "Background",
  ): PhotoProject | null {
    if (!this.initialized || !this.photoEngine) {
      console.error("PhotoBridge not initialized");
      return null;
    }

    try {
      // Create a new project if none exists
      let project = this.getActiveProject();
      if (!project) {
        project = this.createProject(image.width, image.height);
        if (!project) {
          return null;
        }
      }

      const updatedProject = this.photoEngine.importPhoto(project, image, name);
      this.projects.set(updatedProject.id, updatedProject);
      return updatedProject;
    } catch (error) {
      console.error("Failed to import photo:", error);
      return null;
    }
  }

  /**
   * Get the active project
   */
  getActiveProject(): PhotoProject | null {
    if (!this.activeProjectId) {
      return null;
    }
    return this.projects.get(this.activeProjectId) ?? null;
  }

  /**
   * Set the active project
   */
  setActiveProject(projectId: string): boolean {
    if (!this.projects.has(projectId)) {
      return false;
    }
    this.activeProjectId = projectId;
    return true;
  }

  /**
   * Get a project by ID
   */
  getProject(projectId: string): PhotoProject | null {
    return this.projects.get(projectId) ?? null;
  }

  /**
   * Get all projects
   */
  getAllProjects(): PhotoProject[] {
    return Array.from(this.projects.values());
  }

  // ============================================
  // Layer Management Methods
  // ============================================

  /**
   * Add a new layer to the active project
   *
   * Insert layer above current layer
   *
   * @param options - Layer creation options
   * @returns The updated project
   */
  addLayer(options: AddLayerOptions = {}): PhotoProject | null {
    if (!this.initialized || !this.photoEngine) {
      console.error("PhotoBridge not initialized");
      return null;
    }

    const project = this.getActiveProject();
    if (!project) {
      console.error("No active project");
      return null;
    }

    try {
      const createOptions: CreateLayerOptions = {
        name: options.name,
        type: options.type,
        content: options.content,
        opacity: options.opacity,
        blendMode: options.blendMode,
        insertAt: options.insertAt,
      };

      const updatedProject = this.photoEngine.addLayer(project, createOptions);
      this.projects.set(updatedProject.id, updatedProject);
      return updatedProject;
    } catch (error) {
      console.error("Failed to add layer:", error);
      return null;
    }
  }

  /**
   * Remove a layer from the active project
   *
   * @param layerId - ID of layer to remove
   * @returns The updated project
   */
  removeLayer(layerId: string): PhotoProject | null {
    if (!this.initialized || !this.photoEngine) {
      console.error("PhotoBridge not initialized");
      return null;
    }

    const project = this.getActiveProject();
    if (!project) {
      console.error("No active project");
      return null;
    }

    try {
      const updatedProject = this.photoEngine.removeLayer(project, layerId);
      this.projects.set(updatedProject.id, updatedProject);
      return updatedProject;
    } catch (error) {
      console.error("Failed to remove layer:", error);
      return null;
    }
  }

  /**
   * Reorder layers in the active project
   *
   * Update composite order when layers are reordered
   *
   * @param fromIndex - Source index
   * @param toIndex - Destination index
   * @returns The updated project
   */
  reorderLayers(fromIndex: number, toIndex: number): PhotoProject | null {
    if (!this.initialized || !this.photoEngine) {
      console.error("PhotoBridge not initialized");
      return null;
    }

    const project = this.getActiveProject();
    if (!project) {
      console.error("No active project");
      return null;
    }

    try {
      const result = this.photoEngine.reorderLayers(
        project,
        fromIndex,
        toIndex,
      );
      if (!result.success) {
        console.error("Failed to reorder layers:", result.error);
        return null;
      }

      const updatedProject: PhotoProject = {
        ...project,
        layers: result.layers,
      };
      this.projects.set(updatedProject.id, updatedProject);
      return updatedProject;
    } catch (error) {
      console.error("Failed to reorder layers:", error);
      return null;
    }
  }

  /**
   * Set layer opacity
   *
   * Blend layer at specified alpha
   *
   * @param layerId - Layer ID
   * @param opacity - New opacity (0-1)
   * @returns The updated project
   */
  setLayerOpacity(layerId: string, opacity: number): PhotoProject | null {
    if (!this.initialized || !this.photoEngine) {
      console.error("PhotoBridge not initialized");
      return null;
    }

    const project = this.getActiveProject();
    if (!project) {
      console.error("No active project");
      return null;
    }

    try {
      const updatedProject = this.photoEngine.setLayerOpacity(
        project,
        layerId,
        opacity,
      );
      this.projects.set(updatedProject.id, updatedProject);
      return updatedProject;
    } catch (error) {
      console.error("Failed to set layer opacity:", error);
      return null;
    }
  }

  /**
   * Toggle layer visibility
   *
   * Include or exclude layer from composite
   *
   * @param layerId - Layer ID
   * @param visible - Visibility state (optional, toggles if not provided)
   * @returns The updated project
   */
  setLayerVisibility(layerId: string, visible?: boolean): PhotoProject | null {
    if (!this.initialized || !this.photoEngine) {
      console.error("PhotoBridge not initialized");
      return null;
    }

    const project = this.getActiveProject();
    if (!project) {
      console.error("No active project");
      return null;
    }

    try {
      const updatedProject = this.photoEngine.setLayerVisibility(
        project,
        layerId,
        visible,
      );
      this.projects.set(updatedProject.id, updatedProject);
      return updatedProject;
    } catch (error) {
      console.error("Failed to set layer visibility:", error);
      return null;
    }
  }

  /**
   * Set layer blend mode
   *
   * @param layerId - Layer ID
   * @param blendMode - New blend mode
   * @returns The updated project
   */
  setLayerBlendMode(
    layerId: string,
    blendMode: PhotoBlendMode,
  ): PhotoProject | null {
    if (!this.initialized || !this.photoEngine) {
      console.error("PhotoBridge not initialized");
      return null;
    }

    const project = this.getActiveProject();
    if (!project) {
      console.error("No active project");
      return null;
    }

    try {
      const updatedProject = this.photoEngine.setLayerBlendMode(
        project,
        layerId,
        blendMode,
      );
      this.projects.set(updatedProject.id, updatedProject);
      return updatedProject;
    } catch (error) {
      console.error("Failed to set layer blend mode:", error);
      return null;
    }
  }

  /**
   * Update layer transform
   *
   * @param layerId - Layer ID
   * @param transform - Partial transform update
   * @returns The updated project
   */
  setLayerTransform(
    layerId: string,
    transform: Partial<LayerTransform>,
  ): PhotoProject | null {
    if (!this.initialized || !this.photoEngine) {
      console.error("PhotoBridge not initialized");
      return null;
    }

    const project = this.getActiveProject();
    if (!project) {
      console.error("No active project");
      return null;
    }

    try {
      const updatedProject = this.photoEngine.setLayerTransform(
        project,
        layerId,
        transform,
      );
      this.projects.set(updatedProject.id, updatedProject);
      return updatedProject;
    } catch (error) {
      console.error("Failed to set layer transform:", error);
      return null;
    }
  }

  /**
   * Lock or unlock a layer
   *
   * @param layerId - Layer ID
   * @param locked - Lock state
   * @returns The updated project
   */
  setLayerLocked(layerId: string, locked: boolean): PhotoProject | null {
    if (!this.initialized || !this.photoEngine) {
      console.error("PhotoBridge not initialized");
      return null;
    }

    const project = this.getActiveProject();
    if (!project) {
      console.error("No active project");
      return null;
    }

    try {
      const updatedProject = this.photoEngine.setLayerLocked(
        project,
        layerId,
        locked,
      );
      this.projects.set(updatedProject.id, updatedProject);
      return updatedProject;
    } catch (error) {
      console.error("Failed to set layer locked:", error);
      return null;
    }
  }

  /**
   * Rename a layer
   *
   * @param layerId - Layer ID
   * @param name - New name
   * @returns The updated project
   */
  renameLayer(layerId: string, name: string): PhotoProject | null {
    if (!this.initialized || !this.photoEngine) {
      console.error("PhotoBridge not initialized");
      return null;
    }

    const project = this.getActiveProject();
    if (!project) {
      console.error("No active project");
      return null;
    }

    try {
      const updatedProject = this.photoEngine.renameLayer(
        project,
        layerId,
        name,
      );
      this.projects.set(updatedProject.id, updatedProject);
      return updatedProject;
    } catch (error) {
      console.error("Failed to rename layer:", error);
      return null;
    }
  }

  /**
   * Duplicate a layer
   *
   * @param layerId - Layer ID to duplicate
   * @returns The updated project
   */
  duplicateLayer(layerId: string): PhotoProject | null {
    if (!this.initialized || !this.photoEngine) {
      console.error("PhotoBridge not initialized");
      return null;
    }

    const project = this.getActiveProject();
    if (!project) {
      console.error("No active project");
      return null;
    }

    try {
      const updatedProject = this.photoEngine.duplicateLayer(project, layerId);
      this.projects.set(updatedProject.id, updatedProject);
      return updatedProject;
    } catch (error) {
      console.error("Failed to duplicate layer:", error);
      return null;
    }
  }

  /**
   * Select a layer
   *
   * @param layerId - Layer ID to select
   * @returns The updated project
   */
  selectLayer(layerId: string): PhotoProject | null {
    if (!this.initialized || !this.photoEngine) {
      console.error("PhotoBridge not initialized");
      return null;
    }

    const project = this.getActiveProject();
    if (!project) {
      console.error("No active project");
      return null;
    }

    try {
      const updatedProject = this.photoEngine.selectLayer(project, layerId);
      this.projects.set(updatedProject.id, updatedProject);
      return updatedProject;
    } catch (error) {
      console.error("Failed to select layer:", error);
      return null;
    }
  }

  /**
   * Get the currently selected layer
   *
   * @returns Selected layer or null
   */
  getSelectedLayer(): PhotoLayer | null {
    if (!this.initialized || !this.photoEngine) {
      return null;
    }

    const project = this.getActiveProject();
    if (!project) {
      return null;
    }

    return this.photoEngine.getSelectedLayer(project);
  }

  /**
   * Get a layer by ID
   *
   * @param layerId - Layer ID
   * @returns Layer or null
   */
  getLayer(layerId: string): PhotoLayer | null {
    if (!this.initialized || !this.photoEngine) {
      return null;
    }

    const project = this.getActiveProject();
    if (!project) {
      return null;
    }

    return this.photoEngine.getLayer(project, layerId);
  }

  /**
   * Get visible layers
   *
   * @returns Array of visible layers
   */
  getVisibleLayers(): PhotoLayer[] {
    if (!this.initialized || !this.photoEngine) {
      return [];
    }

    const project = this.getActiveProject();
    if (!project) {
      return [];
    }

    return this.photoEngine.getVisibleLayers(project);
  }

  /**
   * Get layer count
   *
   * @returns Number of layers
   */
  getLayerCount(): number {
    if (!this.initialized || !this.photoEngine) {
      return 0;
    }

    const project = this.getActiveProject();
    if (!project) {
      return 0;
    }

    return this.photoEngine.getLayerCount(project);
  }

  // ============================================
  // Composite Rendering Methods
  // ============================================

  /**
   * Render the composite of all visible layers
   *
   * @param options - Composite options
   * @returns Composited image
   */
  async renderComposite(options?: {
    width?: number;
    height?: number;
    includeHidden?: boolean;
    backgroundColor?: string;
  }): Promise<ImageBitmap | null> {
    if (!this.initialized || !this.photoEngine) {
      console.error("PhotoBridge not initialized");
      return null;
    }

    const project = this.getActiveProject();
    if (!project) {
      console.error("No active project");
      return null;
    }

    try {
      return await this.photoEngine.renderComposite(project, options);
    } catch (error) {
      console.error("Failed to render composite:", error);
      return null;
    }
  }

  /**
   * Flatten all layers into a single layer
   *
   * @returns The updated project
   */
  async flattenLayers(): Promise<PhotoProject | null> {
    if (!this.initialized || !this.photoEngine) {
      console.error("PhotoBridge not initialized");
      return null;
    }

    const project = this.getActiveProject();
    if (!project) {
      console.error("No active project");
      return null;
    }

    try {
      const updatedProject = await this.photoEngine.flattenLayers(project);
      this.projects.set(updatedProject.id, updatedProject);
      return updatedProject;
    } catch (error) {
      console.error("Failed to flatten layers:", error);
      return null;
    }
  }

  /**
   * Merge a layer down into the layer below it
   *
   * @param layerId - Layer ID to merge down
   * @returns The updated project
   */
  async mergeLayerDown(layerId: string): Promise<PhotoProject | null> {
    if (!this.initialized || !this.photoEngine) {
      console.error("PhotoBridge not initialized");
      return null;
    }

    const project = this.getActiveProject();
    if (!project) {
      console.error("No active project");
      return null;
    }

    try {
      const updatedProject = await this.photoEngine.mergeLayerDown(
        project,
        layerId,
      );
      this.projects.set(updatedProject.id, updatedProject);
      return updatedProject;
    } catch (error) {
      console.error("Failed to merge layer down:", error);
      return null;
    }
  }

  // ============================================
  // Retouching Tool Methods
  // ============================================

  /**
   * Set brush configuration
   *
   * Update brush size and hardness
   *
   * @param config - Partial brush configuration
   */
  setBrushConfig(config: Partial<BrushConfig>): void {
    if (!this.initialized || !this.retouchingEngine) {
      console.error("PhotoBridge not initialized");
      return;
    }

    this.retouchingEngine.setBrushConfig(config);
  }

  /**
   * Get current brush configuration
   */
  getBrushConfig(): BrushConfig | null {
    if (!this.initialized || !this.retouchingEngine) {
      return null;
    }

    return this.retouchingEngine.getBrushConfig();
  }

  /**
   * Set brush size
   *
   * Update tool's area of effect
   *
   * @param size - Brush size in pixels
   */
  setBrushSize(size: number): void {
    if (!this.initialized || !this.retouchingEngine) {
      console.error("PhotoBridge not initialized");
      return;
    }

    this.retouchingEngine.setBrushSize(size);
  }

  /**
   * Set brush hardness
   *
   * Modify edge falloff of brush stroke
   *
   * @param hardness - Hardness value (0-1)
   */
  setBrushHardness(hardness: number): void {
    if (!this.initialized || !this.retouchingEngine) {
      console.error("PhotoBridge not initialized");
      return;
    }

    this.retouchingEngine.setBrushHardness(hardness);
  }

  /**
   * Set clone stamp source point
   *
   * @param x - Source X position
   * @param y - Source Y position
   * @param layerId - Optional layer ID
   */
  setCloneSource(x: number, y: number, layerId: string | null = null): void {
    if (!this.initialized || !this.retouchingEngine) {
      console.error("PhotoBridge not initialized");
      return;
    }

    this.retouchingEngine.setCloneSource(x, y, layerId);
  }

  /**
   * Get clone stamp source
   */
  getCloneSource(): CloneSource | null {
    if (!this.initialized || !this.retouchingEngine) {
      return null;
    }

    return this.retouchingEngine.getCloneSource();
  }

  /**
   * Apply spot healing at a point
   *
   * Sample surrounding pixels and blend over target area
   *
   * @param image - Source image
   * @param x - Target X position
   * @param y - Target Y position
   * @param radius - Healing radius (defaults to brush size / 2)
   * @returns Healed image
   */
  async spotHeal(
    image: ImageBitmap,
    x: number,
    y: number,
    radius?: number,
  ): Promise<ImageBitmap | null> {
    if (!this.initialized || !this.retouchingEngine) {
      console.error("PhotoBridge not initialized");
      return null;
    }

    try {
      return await this.retouchingEngine.spotHeal(image, x, y, radius);
    } catch (error) {
      console.error("Failed to apply spot healing:", error);
      return null;
    }
  }

  /**
   * Apply spot healing along a stroke
   *
   * @param image - Source image
   * @param stroke - Brush stroke
   * @returns Healed image
   */
  async spotHealStroke(
    image: ImageBitmap,
    stroke: BrushStroke,
  ): Promise<ImageBitmap | null> {
    if (!this.initialized || !this.retouchingEngine) {
      console.error("PhotoBridge not initialized");
      return null;
    }

    try {
      return await this.retouchingEngine.spotHealStroke(image, stroke);
    } catch (error) {
      console.error("Failed to apply spot healing stroke:", error);
      return null;
    }
  }

  /**
   * Apply clone stamp at a point
   *
   * Copy pixels from source point to target point
   *
   * @param image - Source image
   * @param targetX - Target X position
   * @param targetY - Target Y position
   * @param radius - Clone radius (defaults to brush size / 2)
   * @returns Cloned image
   */
  async cloneStamp(
    image: ImageBitmap,
    targetX: number,
    targetY: number,
    radius?: number,
  ): Promise<ImageBitmap | null> {
    if (!this.initialized || !this.retouchingEngine) {
      console.error("PhotoBridge not initialized");
      return null;
    }

    try {
      return await this.retouchingEngine.cloneStamp(
        image,
        targetX,
        targetY,
        radius,
      );
    } catch (error) {
      console.error("Failed to apply clone stamp:", error);
      return null;
    }
  }

  /**
   * Apply clone stamp along a stroke
   *
   * @param image - Source image
   * @param stroke - Brush stroke
   * @returns Cloned image
   */
  async cloneStampStroke(
    image: ImageBitmap,
    stroke: BrushStroke,
  ): Promise<ImageBitmap | null> {
    if (!this.initialized || !this.retouchingEngine) {
      console.error("PhotoBridge not initialized");
      return null;
    }

    try {
      return await this.retouchingEngine.cloneStampStroke(image, stroke);
    } catch (error) {
      console.error("Failed to apply clone stamp stroke:", error);
      return null;
    }
  }

  /**
   * Apply red-eye removal
   *
   * Detect and desaturate red pixels in selected eye region
   *
   * @param image - Source image
   * @param x - Center X of eye region
   * @param y - Center Y of eye region
   * @param radius - Eye region radius
   * @returns Image with red-eye removed
   */
  async removeRedEye(
    image: ImageBitmap,
    x: number,
    y: number,
    radius: number,
  ): Promise<ImageBitmap | null> {
    if (!this.initialized || !this.retouchingEngine) {
      console.error("PhotoBridge not initialized");
      return null;
    }

    try {
      return await this.retouchingEngine.removeRedEye(image, x, y, radius);
    } catch (error) {
      console.error("Failed to remove red-eye:", error);
      return null;
    }
  }

  /**
   * Create a brush stroke from points
   *
   * @param points - Array of brush points
   * @returns Brush stroke
   */
  createStroke(points: BrushPoint[]): BrushStroke | null {
    if (!this.initialized || !this.retouchingEngine) {
      console.error("PhotoBridge not initialized");
      return null;
    }

    return this.retouchingEngine.createStroke(points);
  }

  /**
   * Generate brush mask for preview
   *
   * @param size - Brush size
   * @param hardness - Brush hardness
   * @returns Canvas with brush mask
   */
  generateBrushMask(size?: number, hardness?: number): OffscreenCanvas | null {
    if (!this.initialized || !this.retouchingEngine) {
      console.error("PhotoBridge not initialized");
      return null;
    }

    return this.retouchingEngine.generateBrushMask(size, hardness);
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Clear all projects
   */
  clear(): void {
    this.projects.clear();
    this.activeProjectId = null;
  }

  /**
   * Delete a project
   */
  deleteProject(projectId: string): boolean {
    const deleted = this.projects.delete(projectId);
    if (deleted && this.activeProjectId === projectId) {
      const remaining = Array.from(this.projects.keys());
      this.activeProjectId = remaining.length > 0 ? remaining[0] : null;
    }
    return deleted;
  }

  /**
   * Dispose of the photo bridge and clean up resources
   */
  dispose(): void {
    this.clear();

    if (this.photoEngine) {
      this.photoEngine.dispose();
    }

    if (this.retouchingEngine) {
      this.retouchingEngine.dispose();
    }

    this.photoEngine = null;
    this.retouchingEngine = null;
    this.initialized = false;
  }
}

// Singleton instance
let photoBridgeInstance: PhotoBridge | null = null;

/**
 * Get the shared PhotoBridge instance
 */
export function getPhotoBridge(): PhotoBridge {
  if (!photoBridgeInstance) {
    photoBridgeInstance = new PhotoBridge();
  }
  return photoBridgeInstance;
}

/**
 * Initialize the shared PhotoBridge
 */
export function initializePhotoBridge(): PhotoBridge {
  const bridge = getPhotoBridge();
  bridge.initialize();
  return bridge;
}

/**
 * Dispose of the shared PhotoBridge
 */
export function disposePhotoBridge(): void {
  if (photoBridgeInstance) {
    photoBridgeInstance.dispose();
    photoBridgeInstance = null;
  }
}
