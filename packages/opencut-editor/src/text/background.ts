export const CORNER_RADIUS_MIN = 0;
export const CORNER_RADIUS_MAX = 100;

export interface TextBackground {
	enabled: boolean;
	color: string;
	cornerRadius?: number;
	paddingX?: number;
	paddingY?: number;
	offsetX?: number;
	offsetY?: number;
}
