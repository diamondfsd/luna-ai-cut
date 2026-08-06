import {
	GridTableIcon,
	LayoutThreeColumnIcon,
	LayoutThreeRowIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { NumberField } from "@/components/ui/number-field";
import {
	GRID_MIN,
	GRID_MAX,
	DEFAULT_GRID_CONFIG,
} from "@/guides/grid";
import { usePreviewStore } from "@/preview/preview-store";
import { clampRound } from "@/utils/math";
import { cn } from "@/utils/ui";
import type { GuideDefinition } from "@/guides/types";

function GridLines({
	rows,
	cols,
	color,
}: {
	rows: number;
	cols: number;
	color: string;
}) {
	const verticals = Array.from(
		{ length: cols - 1 },
		(_, i) => ((i + 1) / cols) * 100,
	);
	const horizontals = Array.from(
		{ length: rows - 1 },
		(_, i) => ((i + 1) / rows) * 100,
	);

	return (
		<>
			{verticals.map((pct) => (
				<div
					key={`v-${pct}`}
					className={cn("absolute top-0 bottom-0 w-px", color)}
					style={{ left: `${pct}%` }}
				/>
			))}
			{horizontals.map((pct) => (
				<div
					key={`h-${pct}`}
					className={cn("absolute left-0 right-0 h-px", color)}
					style={{ top: `${pct}%` }}
				/>
			))}
		</>
	);
}

function GridGuidePreview() {
	return (
		<div className="relative aspect-video w-full">
			<GridLines rows={3} cols={4} color="bg-foreground/15" />
		</div>
	);
}

function GridGuideOverlay() {
	const { rows, cols } = usePreviewStore((s) => s.gridConfig);

	return (
		<div className="absolute inset-0">
			<GridLines rows={rows} cols={cols} color="bg-white/35" />
		</div>
	);
}

function GridGuideOptions() {
	const rows = usePreviewStore((s) => s.gridConfig.rows);
	const cols = usePreviewStore((s) => s.gridConfig.cols);
	const setGridConfig = usePreviewStore((s) => s.setGridConfig);

	const clampGridValue = (value: number) =>
		clampRound({ value, min: GRID_MIN, max: GRID_MAX });

	return (
		<div className="flex gap-2">
			<NumberField
				icon={<HugeiconsIcon icon={LayoutThreeRowIcon} />}
				value={rows}
				min={GRID_MIN}
				max={GRID_MAX}
				isDefault={rows === DEFAULT_GRID_CONFIG.rows}
				onReset={() => setGridConfig({ rows: DEFAULT_GRID_CONFIG.rows })}
				onScrub={(value) => setGridConfig({ rows: clampGridValue(value) })}
				onChange={(event) => {
					const parsed = Number.parseInt(event.target.value, 10);
					if (!Number.isNaN(parsed))
						setGridConfig({ rows: clampGridValue(parsed) });
				}}
				className="flex-1"
			/>
			<NumberField
				icon={<HugeiconsIcon icon={LayoutThreeColumnIcon} />}
				value={cols}
				min={GRID_MIN}
				max={GRID_MAX}
				isDefault={cols === DEFAULT_GRID_CONFIG.cols}
				onReset={() => setGridConfig({ cols: DEFAULT_GRID_CONFIG.cols })}
				onScrub={(value) => setGridConfig({ cols: clampGridValue(value) })}
				onChange={(event) => {
					const parsed = Number.parseInt(event.target.value, 10);
					if (!Number.isNaN(parsed))
						setGridConfig({ cols: clampGridValue(parsed) });
				}}
				className="flex-1"
			/>
		</div>
	);
}

export const gridGuide = {
	id: "grid",
	label: "Grid",
	renderPreview: () => <GridGuidePreview />,
	renderTriggerIcon: () => <HugeiconsIcon icon={GridTableIcon} />,
	renderOverlay: () => <GridGuideOverlay />,
	renderOptions: () => <GridGuideOptions />,
} as const satisfies GuideDefinition;
